#!/usr/bin/env bash
# Sobe um Pulse completo com dados fictícios, sem HighLevel nenhum.
#
#   scripts/demo.sh          # sobe, popula e calcula os scores
#   scripts/demo.sh --reset  # recria o banco do zero antes
#
# Usa o Supabase local (supabase start), e não o docker-compose.yml deste repositório,
# porque o painel depende de Auth e PostgREST — um Postgres puro não serve. O
# docker-compose.yml existe para os testes.
#
# Requisitos: Docker em execução e a CLI do Supabase
#   npm i -g supabase   (ou brew install supabase/tap/supabase)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENCY_ID='0de3a8b2-1c4d-4f6e-8a90-000000000001'
DEMO_EMAIL='owner@demo.pulse'
DEMO_PASSWORD='pulse-demo-1234'

cd "$ROOT"

command -v supabase >/dev/null 2>&1 || {
  echo "A CLI do Supabase não está instalada." >&2
  echo "  npm i -g supabase   ou   brew install supabase/tap/supabase" >&2
  exit 1
}
docker info >/dev/null 2>&1 || {
  echo "O Docker precisa estar rodando — o Supabase local sobe em contêineres." >&2
  exit 1
}

[ -f supabase/config.toml ] || {
  echo "→ inicializando o projeto Supabase local"
  supabase init >/dev/null
}

echo "→ subindo o Supabase local (na primeira vez ele baixa as imagens; demora)"
supabase start >/dev/null

# `supabase status -o json` é a forma suportada de descobrir as chaves e as portas,
# que mudam conforme a versão da CLI — não dá para fixar no script.
STATUS="$(supabase status -o json)"
json() {
  printf '%s' "$STATUS" | node -e "
    let s = '';
    process.stdin.on('data', d => s += d).on('end', () => {
      const j = JSON.parse(s);
      console.log(j[process.argv[1]] ?? '');
    });" "$1"
}

API_URL="$(json API_URL)"
ANON_KEY="$(json ANON_KEY)"
SERVICE_KEY="$(json SERVICE_ROLE_KEY)"
DB_URL="$(json DB_URL)"

[ -n "$DB_URL" ] || { echo "não consegui ler a DB_URL do supabase status" >&2; exit 1; }

if [ "${1:-}" = "--reset" ]; then
  echo "→ recriando o banco"
  supabase db reset --no-seed >/dev/null 2>&1 || true
fi

echo "→ aplicando migrations"
for f in db/migrations/*.sql; do
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "→ populando dados de demonstração"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f db/seed/demo.sql

echo "→ criando os logins de demonstração"
# Os usuários de Auth precisam existir antes de serem ligados a agency_users; a API de
# admin é a rota suportada (inserir direto em auth.users quebra entre versões da CLI).
# São três para dar o que comparar: owner vê tudo, admin está sem faturamento e o
# gerente só enxerga as subcontas atribuídas a ele.
for email in "$DEMO_EMAIL" admin@demo.pulse gerente@demo.pulse; do
  curl -s -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_KEY" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$DEMO_PASSWORD\",\"email_confirm\":true}" \
    >/dev/null || true
done

psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "
  update agency_users au
     set auth_user_id = u.id, accepted_at = coalesce(au.accepted_at, now())
    from auth.users u
   where u.email = au.email;"

echo "→ compilando o worker"
npm run build -w @pulse/core >/dev/null
npm run build -w @pulse/db >/dev/null
npm run build -w @pulse/worker >/dev/null

echo "→ calculando os scores com o motor de verdade (45 dias)"
DATABASE_URL="$DB_URL" LOG_LEVEL=warn node apps/worker/dist/cli.js backfill --agency "$AGENCY_ID" --days 45

cat > apps/web/.env.local <<ENV
NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
NEXT_PUBLIC_COLLECTOR_URL=http://localhost:3001
ENV

cat <<EOF

Pronto. Subiu com 18 subcontas fictícias e os scores calculados pelo motor.

  npm run dev:web     →  http://localhost:3000

Todos os logins usam a senha: $DEMO_PASSWORD

  $DEMO_EMAIL      owner — vê tudo
  admin@demo.pulse      admin sem permissão de faturamento: MRR e receita somem
  gerente@demo.pulse    gerente — só as subcontas atribuídas a ele

Vale entrar com os três: é a forma mais rápida de ver a RLS e os toggles de permissão
mudando o que aparece na tela.

Derrubar tudo:  supabase stop
EOF
