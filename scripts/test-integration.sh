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
COMPOSE_UP=0

cleanup() {
  [ "$STARTED_REDIS" = 1 ] && redis-cli -p 56379 shutdown nosave >/dev/null 2>&1 || true
  if [ "$STARTED_PG" = 1 ]; then
    su postgres -s /bin/bash -c "/usr/lib/postgresql/*/bin/pg_ctl -D $TMP/pg stop -m immediate" >/dev/null 2>&1 || true
  fi
  [ "$COMPOSE_UP" = 1 ] && docker compose -f "$ROOT/docker-compose.yml" down -v >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

# Três formas de conseguir Postgres e Redis, na ordem: o que você passou por
# variável, o docker compose do repositório, ou binários nativos com root (que é o
# caso do CI Linux). No macOS sem Docker não há terceira opção, e o script diz isso
# em vez de falhar com um erro de caminho.

start_compose() {
  if ! docker compose version >/dev/null 2>&1; then return 1; fi
  echo "→ subindo Postgres e Redis via docker compose"
  docker compose -f "$ROOT/docker-compose.yml" up -d --wait >/dev/null || return 1
  COMPOSE_UP=1
  export DATABASE_URL="postgres://postgres:pulse@localhost:55432/postgres"
  export REDIS_URL="redis://localhost:56379"
  return 0
}

start_native() {
  [ "$(id -u)" = "0" ] || return 1
  command -v redis-server >/dev/null 2>&1 || return 1
  ls /usr/lib/postgresql/*/bin/initdb >/dev/null 2>&1 || return 1

  mkdir -p "$TMP/pg"
  redis-server --port 56379 --daemonize yes --save '' --dir "$TMP" >/dev/null
  STARTED_REDIS=1
  export REDIS_URL="redis://127.0.0.1:56379"

  # initdb recusa rodar como root e quer ser dono do data directory.
  chown -R postgres "$TMP" 2>/dev/null || return 1
  PGBIN="$(dirname "$(ls /usr/lib/postgresql/*/bin/initdb | head -1)")"
  su postgres -s /bin/bash -c "$PGBIN/initdb -D $TMP/pg -U postgres --auth=trust" >/dev/null
  su postgres -s /bin/bash -c "$PGBIN/pg_ctl -D $TMP/pg -o '-p 56432 -k $TMP' -l $TMP/pg.log start" >/dev/null
  STARTED_PG=1
  sleep 1
  export DATABASE_URL="postgres://postgres@/postgres?host=$TMP&port=56432"
  return 0
}

if [ -n "${DATABASE_URL:-}" ] && [ -n "${REDIS_URL:-}" ]; then
  echo "→ usando DATABASE_URL e REDIS_URL do ambiente"
else
  mkdir -p "$TMP"
  start_compose || start_native || {
    echo "Não consegui subir Postgres e Redis automaticamente." >&2
    echo "Instale o Docker e rode \`docker compose up -d\`, ou exporte DATABASE_URL e REDIS_URL." >&2
    exit 1
  }
fi

echo "→ aplicando migrations"
# Postgres puro não tem auth.uid(); o shim faz o papel do Supabase.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/db/test/00_auth_shim.sql"
for f in "$ROOT"/db/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "→ build"
npm run build:script --prefix "$ROOT" >/dev/null
npx --prefix "$ROOT" tsc -b "$ROOT/packages/core" "$ROOT/packages/db" "$ROOT/apps/collector"

echo "→ testes de integração do coletor"
export LOG_LEVEL="${LOG_LEVEL:-silent}"
node --test "$ROOT"/apps/collector/dist/test/*.test.js
