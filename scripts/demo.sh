#!/usr/bin/env bash
# Sobe um Pulse completo com dados fictícios, sem HighLevel nenhum.
#
#   scripts/demo.sh
#
# Requisitos: Node 22+, Docker em execução e a CLI do Supabase
#   npm i -g supabase   (ou brew install supabase/tap/supabase)
#
# Não exige psql: as migrations e o seed são aplicados pela própria CLI do Supabase,
# e o que sobra de SQL roda pelo cliente Node do projeto. Usa o Supabase local em vez
# do docker-compose.yml daqui porque o painel precisa de Auth e PostgREST — um
# Postgres puro não serve. O compose existe para os testes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENCY_ID='0de3a8b2-1c4d-4f6e-8a90-000000000001'
DEMO_PASSWORD='pulse-demo-1234'
EMAILS=(owner@demo.pulse admin@demo.pulse gerente@demo.pulse)

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
  supabase init
}

# A CLI aplica o que está em supabase/migrations, em ordem de nome. As migrations
# canônicas vivem em db/migrations; aqui elas são copiadas com um prefixo de
# timestamp, que é o formato que a CLI espera. Regenerado a cada execução, para que
# db/migrations continue sendo a única fonte de verdade.
echo "→ preparando migrations para a CLI"
mkdir -p supabase/migrations
rm -f supabase/migrations/*_pulse_*.sql
i=0
for f in db/migrations/*.sql; do
  i=$((i + 1))
  printf -v stamp '2026010100%04d' "$i"
  cp "$f" "supabase/migrations/${stamp}_pulse_$(basename "$f")"
done
cp db/seed/demo.sql supabase/seed.sql

echo "→ subindo o Supabase local (na primeira vez ele baixa as imagens; demora)"
supabase start

echo "→ aplicando migrations e seed"
supabase db reset

# `supabase status -o json` é a forma suportada de descobrir chaves e portas, que
# mudam conforme a versão da CLI — não dá para fixar no script.
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

for name in API_URL ANON_KEY SERVICE_KEY DB_URL; do
  [ -n "${!name}" ] || {
    echo "não consegui ler $name de 'supabase status -o json'." >&2
    echo "Rode o comando à mão para ver o que ele devolveu." >&2
    exit 1
  }
done

echo "→ criando os logins de demonstração"
# Três papéis para dar o que comparar: owner vê tudo, admin está sem permissão de
# faturamento e o gerente só enxerga as subcontas atribuídas a ele.
for email in "${EMAILS[@]}"; do
  curl -sS -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_KEY" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$DEMO_PASSWORD\",\"email_confirm\":true}" \
    -o /dev/null || echo "  (aviso: não criei $email; talvez já exista)"
done

echo "→ compilando"
npm run build -w @pulse/core
npm run build -w @pulse/db
npm run build -w @pulse/worker

export DATABASE_URL="$DB_URL"
export LOG_LEVEL="${LOG_LEVEL:-warn}"

echo "→ ligando os logins às contas do Pulse"
node apps/worker/dist/cli.js link-auth-users

echo "→ calculando os scores com o motor de verdade (45 dias)"
node apps/worker/dist/cli.js backfill --agency "$AGENCY_ID" --days 45

cat > apps/web/.env.local <<ENV
NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
NEXT_PUBLIC_COLLECTOR_URL=http://localhost:3001
ENV

cat <<EOF

Pronto. 18 subcontas fictícias, scores calculados pelo motor.

  npm run dev:web     →  http://localhost:3000

Senha de todos os logins: $DEMO_PASSWORD

  owner@demo.pulse      vê as 18 subcontas, com plano e faturamento
  admin@demo.pulse      mesmo alcance, sem permissão de billing: receita some
  gerente@demo.pulse    só as 9 subcontas atribuídas a ele

Entre com os três: é a forma mais rápida de ver a RLS mudando o que aparece.

Derrubar tudo:  supabase stop
EOF
