/*!
 * Pulse tracking script — paste into Agency Settings > Company > Custom JavaScript.
 * Runs inside the white-label app on every sub-account. PRD §6.1.
 *
 * Deliberately NOT collected here: the IP and the city. Those are resolved server-side
 * from the request, so the browser never has to be trusted with them.
 */
(function () {
  'use strict';
  var CFG = window.__PULSE__ || {};
  var ENDPOINT = CFG.endpoint || 'https://collect.pulse.app/collect';
  var KEY = CFG.key || '';                 // agency id, used to look the agency up
  var TOKEN = CFG.token || '';             // signing key (public: it ships in the page)
  if (!KEY || !TOKEN || window.__pulseLoaded) return;
  window.__pulseLoaded = true;

  var HEARTBEAT_MS = 30000;
  var IDLE_MS = 60000;                     // no input for this long = not active
  var HIDDEN_END_MS = 5 * 60000;
  var STALE_MS = 30 * 60000;
  var FLUSH_MS = 15000;
  var MAX_QUEUE = 100;

  var queue = [];
  var sessionId = null;
  var lastInput = Date.now();
  var hiddenSince = null;
  var lastBeat = 0;
  var lastPath = null;
  var ctx = null;

  // ---------------------------------------------------------------- context

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  /* Three ways to find the sub-account, because HighLevel has moved this before
     and a missing locationId is what produced "Unknown Location" in the old tool. */
  function locationId() {
    var m = /\/(?:v2\/)?location\/([0-9a-zA-Z]+)/.exec(location.pathname);
    if (m) return m[1];
    try {
      var keys = ['currentLocationId', 'locationId', 'location_id'];
      for (var i = 0; i < keys.length; i++) {
        var v = localStorage.getItem(keys[i]);
        if (v) return v.replace(/"/g, '');
      }
      var raw = localStorage.getItem('ghl_user') || localStorage.getItem('user');
      if (raw) {
        var p = JSON.parse(raw);
        if (p && (p.locationId || p.location_id)) return p.locationId || p.location_id;
      }
    } catch (e) { /* storage blocked */ }
    var el = document.querySelector('[data-location-id],[location-id]');
    if (el) return el.getAttribute('data-location-id') || el.getAttribute('location-id');
    return null;
  }

  function user() {
    var out = { id: null, email: null, name: null, role: null };
    try {
      var raw = localStorage.getItem('ghl_user') || localStorage.getItem('user')
        || localStorage.getItem('userData');
      if (raw) {
        var p = JSON.parse(raw);
        out.id = p.id || p.userId || p._id || null;
        out.email = p.email || null;
        out.name = p.name || [p.firstName, p.lastName].filter(Boolean).join(' ') || null;
        out.role = p.role || p.type || null;
      }
      if (!out.id) {
        var t = localStorage.getItem('ghl_token') || localStorage.getItem('token');
        if (t && t.split('.').length === 3) {
          var c = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
          out.id = c.user_id || c.userId || c.sub || out.id;
          out.email = out.email || c.email || null;
          out.role = out.role || c.role || null;
        }
      }
    } catch (e) { /* not logged in yet */ }
    return out;
  }

  function resolve() {
    var loc = locationId();
    var u = user();
    if (!loc || !u.id) return null;
    return {
      locationId: loc, userId: u.id, userEmail: u.email, userName: u.name, role: u.role,
    };
  }

  function path() {
    return location.pathname + (location.search ? '' : '');
  }

  // ------------------------------------------------------------------ queue

  function push(type, extra) {
    if (!ctx || !sessionId) return;
    var e = {
      type: type, sessionId: sessionId, ts: Date.now(),
      locationId: ctx.locationId, userId: ctx.userId,
    };
    if (extra) for (var k in extra) if (extra[k] != null) e[k] = extra[k];
    queue.push(e);
    if (queue.length >= MAX_QUEUE) flush(false);
  }

  /* HMAC over the batch (PRD §6.1), signed with TOKEN. That token travels to the
     browser inside the snippet, so this is integrity, not secrecy: it stops a stray
     script or a bored user from POSTing hand-written batches, and it scopes anything
     forged to the one agency it belongs to. The collector still checks that every
     locationId in the batch belongs to that agency, and rate-limits by IP. */
  var keyPromise = null;
  function cryptoKey() {
    if (!keyPromise) {
      if (!window.crypto || !crypto.subtle || !window.TextEncoder) return null;
      keyPromise = crypto.subtle.importKey(
        'raw', new TextEncoder().encode(TOKEN),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      );
    }
    return keyPromise;
  }

  function hex(buf) {
    var b = new Uint8Array(buf), out = '';
    for (var i = 0; i < b.length; i++) out += (b[i] >>> 4).toString(16) + (b[i] & 15).toString(16);
    return out;
  }

  function post(body, header) {
    var headers = { 'content-type': 'application/json' };
    if (header) headers['x-pulse-signature'] = header;
    return fetch(ENDPOINT, {
      method: 'POST', body: body, keepalive: true, mode: 'cors', credentials: 'omit',
      headers: headers,
    });
  }

  function flush(useBeacon) {
    if (queue.length === 0) return;
    var batch = queue.splice(0, queue.length);
    var body = JSON.stringify({ key: KEY, sentAt: Date.now(), events: batch });

    /* beforeunload cannot await the signing promise, so it goes out unsigned via
       sendBeacon. The collector only accepts unsigned batches of session_end events
       for sessions it has already seen signed — an unsigned batch can end a session
       a second early, and nothing else. */
    if (useBeacon && navigator.sendBeacon) {
      try {
        var blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(ENDPOINT, blob)) return;
      } catch (e) { /* fall through to fetch */ }
    }

    var k = cryptoKey();
    if (!k) { try { post(body, null)['catch'](noop); } catch (e) { requeue(batch); } return; }

    var t = Math.floor(Date.now() / 1000);
    k.then(function (key) {
      return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + body));
    }).then(function (sig) {
      return post(body, 't=' + t + ',v1=' + hex(sig));
    })['catch'](function () { requeue(batch); });
  }

  function noop() {}

  function requeue(batch) {
    // Dropping events is acceptable (§12); unbounded memory growth is not.
    if (queue.length + batch.length <= MAX_QUEUE * 3) queue = batch.concat(queue);
  }

  // ---------------------------------------------------------------- session

  function start() {
    ctx = resolve();
    if (!ctx) return false;
    sessionId = uuid();
    lastPath = path();
    push('session_start', {
      page: lastPath,
      userEmail: ctx.userEmail, userName: ctx.userName, role: ctx.role,
      userAgent: navigator.userAgent,
      screen: screen.width + 'x' + screen.height,
      referrer: document.referrer || null,
      tz: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || null,
    });
    return true;
  }

  function end(reason) {
    if (!sessionId) return;
    push('session_end', { reason: reason });
    flush(reason === 'beforeunload');
    sessionId = null;
  }

  /* A heartbeat is the unit of "active time", so it only fires when the tab is
     visible AND the user touched something in the last minute. An idle tab left
     open overnight contributes nothing. */
  function beat() {
    if (!sessionId) { if (!start()) return; }
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastInput > IDLE_MS) return;
    var now = Date.now();
    if (now - lastBeat < HEARTBEAT_MS * 0.8) return;
    lastBeat = now;
    push('heartbeat', { page: path() });
  }

  function route() {
    var p = path();
    if (p === lastPath) return;
    if (!sessionId && !start()) return;
    push('page_view', { from: lastPath, to: p });
    lastPath = p;
  }

  // ----------------------------------------------------------------- wiring

  ['mousedown', 'keydown', 'scroll', 'touchstart', 'pointerdown'].forEach(function (t) {
    addEventListener(t, function () { lastInput = Date.now(); }, { passive: true, capture: true });
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      hiddenSince = Date.now();
      flush(false);
    } else {
      if (hiddenSince && Date.now() - hiddenSince > HIDDEN_END_MS) end('hidden');
      hiddenSince = null;
      lastInput = Date.now();
    }
  });

  addEventListener('beforeunload', function () { end('beforeunload'); });

  // The app is a SPA: patch history and listen to popstate to see route changes.
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    history[m] = function () {
      var r = orig.apply(this, arguments);
      setTimeout(route, 0);
      return r;
    };
  });
  addEventListener('popstate', route);

  setInterval(beat, HEARTBEAT_MS / 2);
  setInterval(function () { flush(false); }, FLUSH_MS);
  setInterval(function () {
    if (sessionId && lastBeat && Date.now() - lastBeat > STALE_MS) end('stale');
    if (hiddenSince && Date.now() - hiddenSince > HIDDEN_END_MS) { end('hidden'); hiddenSince = null; }
  }, 60000);

  // The user object appears a moment after the app boots; retry for a while.
  var tries = 0;
  var boot = setInterval(function () {
    if (sessionId || start() || ++tries > 60) clearInterval(boot);
  }, 1000);
  start();
})();
