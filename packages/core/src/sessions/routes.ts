/**
 * HighLevel app routes carry ids all over the path. Normalising them keeps the
 * "páginas mais usadas" list readable and stops one sub-account from producing
 * thousands of distinct "pages".
 */
const ID_LIKE = /^[0-9a-zA-Z_-]{16,}$/;
const NUMERIC = /^\d+$/;

export function normalizeRoute(pathname: string): string {
  if (!pathname) return '/';
  let p = pathname.split('?')[0]!.split('#')[0]!;
  if (!p.startsWith('/')) p = `/${p}`;

  const parts = p.split('/').filter(Boolean);

  // /v2/location/{id}/conversations/... -> /conversations/...
  if (parts[0] === 'v2' && parts[1] === 'location') parts.splice(0, 3);
  else if (parts[0] === 'location') parts.splice(0, 2);

  const cleaned = parts.map((seg) =>
    ID_LIKE.test(seg) || NUMERIC.test(seg) ? ':id' : seg.toLowerCase(),
  );
  return `/${cleaned.join('/')}` === '/' ? '/' : `/${cleaned.join('/')}`;
}

/** The locationId as it appears in a HighLevel app URL, or null. */
export function locationIdFromUrl(url: string): string | null {
  const m = /\/(?:v2\/)?location\/([0-9a-zA-Z]+)/.exec(url);
  return m ? m[1]! : null;
}
