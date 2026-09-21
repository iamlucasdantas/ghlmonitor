#!/usr/bin/env bash
# Applies every migration to a throwaway database and runs the RLS assertions.
# Usage: scripts/test-db.sh [PGURL]
#   PGURL defaults to a local socket; see docs/DEVELOPMENT.md for a one-liner
#   that starts a scratch Postgres.
set -euo pipefail

PGURL="${1:-${DATABASE_URL:-postgres://postgres@localhost:5432/postgres}}"
DB="pulse_test_$$"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

psql "$PGURL" -v ON_ERROR_STOP=1 -qc "create database $DB" >/dev/null
trap 'psql "$PGURL" -qc "drop database if exists $DB" >/dev/null' EXIT

# Swap only the dbname component, leaving any query string (host=, sslmode=, …) intact.
if [[ "$PGURL" == *\?* ]]; then
  BASE="${PGURL%%\?*}"; QS="?${PGURL#*\?}"
else
  BASE="$PGURL"; QS=""
fi
TARGET="${BASE%/*}/$DB$QS"
echo "→ aplicando migrations em $DB"
psql "$TARGET" -v ON_ERROR_STOP=1 -q -f "$ROOT/db/test/00_auth_shim.sql"
for f in "$ROOT"/db/migrations/*.sql; do
  echo "  $(basename "$f")"
  psql "$TARGET" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "→ fixtures"
psql "$TARGET" -v ON_ERROR_STOP=1 -q -f "$ROOT/db/test/10_fixtures.sql"

echo "→ RLS"
psql "$TARGET" -v ON_ERROR_STOP=1 -q -f "$ROOT/db/test/20_rls_test.sql"
