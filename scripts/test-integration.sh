#!/usr/bin/env bash
# Integration tests for the collector: real Postgres, real Redis, real HTTP routing.
#
#   scripts/test-integration.sh                 # boots throwaway Postgres + Redis
#   DATABASE_URL=… REDIS_URL=… scripts/test-integration.sh   # uses what you give it
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="${TMPDIR:-/tmp}/pulse-it-$$"
STARTED_PG=0
STARTED_REDIS=0

cleanup() {
  [ "$STARTED_REDIS" = 1 ] && redis-cli -p 56379 shutdown nosave >/dev/null 2>&1 || true
  if [ "$STARTED_PG" = 1 ]; then
    su postgres -s /bin/bash -c "/usr/lib/postgresql/*/bin/pg_ctl -D $TMP/pg stop -m immediate" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

if [ -z "${REDIS_URL:-}" ]; then
  mkdir -p "$TMP"
  redis-server --port 56379 --daemonize yes --save '' --dir "$TMP" >/dev/null
  STARTED_REDIS=1
  export REDIS_URL="redis://127.0.0.1:56379"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  mkdir -p "$TMP/pg"
  # initdb refuses to run as root and wants to own its data directory.
  chown -R postgres "$TMP" 2>/dev/null || {
    echo "não foi possível preparar um Postgres descartável; passe DATABASE_URL" >&2
    exit 1
  }
  PGBIN="$(dirname "$(ls /usr/lib/postgresql/*/bin/initdb | head -1)")"
  su postgres -s /bin/bash -c "$PGBIN/initdb -D $TMP/pg -U postgres --auth=trust" >/dev/null
  su postgres -s /bin/bash -c "$PGBIN/pg_ctl -D $TMP/pg -o '-p 56432 -k $TMP' -l $TMP/pg.log start" >/dev/null
  STARTED_PG=1
  sleep 1
  export DATABASE_URL="postgres://postgres@/postgres?host=$TMP&port=56432"
  echo "→ aplicando migrations"
  # Vanilla Postgres has no auth.uid(); the shim stands in for Supabase's.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/db/test/00_auth_shim.sql"
  for f in "$ROOT"/db/migrations/*.sql; do
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
  done
fi

echo "→ build"
npm run build:script --prefix "$ROOT" >/dev/null
npx --prefix "$ROOT" tsc -b "$ROOT/packages/core" "$ROOT/packages/db" "$ROOT/apps/collector"

echo "→ testes de integração do coletor"
export LOG_LEVEL="${LOG_LEVEL:-silent}"
node --test "$ROOT"/apps/collector/dist/test/*.test.js
