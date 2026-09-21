# Desenvolvimento

Requisitos: Node 22+, Postgres 16+, Redis.

```bash
npm install
cp .env.example .env
```

## Banco

Aplique as migrations em ordem. Em Supabase, cole cada arquivo de `db/migrations/` no
SQL Editor, ou use a CLI:

```bash
for f in db/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```

`0004_retention.sql` agenda o purge com `pg_cron` quando a extensão existe e avisa por
`notice` quando não existe — as funções `purge_events_raw()` e `anonymize_session_ips()`
ficam criadas de todo jeito.

## Testes

```bash
npm test          # engine de score, session builder, HMAC (27 casos) + tamanho do script
scripts/test-db.sh $DATABASE_URL   # migrations + 28 asserts de RLS num banco descartável
```

`scripts/test-db.sh` cria um banco temporário, aplica todas as migrations, carrega
fixtures com duas agências e verifica os critérios de aceite do §16 — entre eles que um
manager não lê uma subconta não atribuída nem indo direto na tabela, e que desligar
`billing` para um admin apaga o faturamento de toda leitura.

Para rodar sem um Postgres à mão:

```bash
su postgres -s /bin/bash -c '
  export PGDATA=/tmp/pgtest/data
  /usr/lib/postgresql/16/bin/initdb -D $PGDATA -U postgres --auth=trust
  /usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -o "-p 55432 -k /tmp/pgtest" -l /tmp/pgtest/pg.log start
'
scripts/test-db.sh "postgres://postgres@/postgres?host=/tmp/pgtest&port=55432"
```

## Rodando

```bash
npm run dev:collector   # :3001  /collect, /webhooks/ghl, /oauth/*, /pulse.min.js
npm run dev:worker      # filas e crons
npm run dev:web         # :3000  painel
npm run build:script    # regera tracking/pulse.min.js e checa o limite de 8 KB
```

## Primeiro acesso

1. Suba o coletor com `GHL_CLIENT_ID` / `GHL_CLIENT_SECRET` preenchidos e abra
   `/oauth/install`. Instale **no nível da agência** — uma instalação de subconta é
   recusada com uma mensagem explicando isso.
2. O callback grava a agência, cria as 4 regras de alerta padrão (§11) e enfileira o
   `bootstrap-agency`, que importa subcontas e usuários.
3. Crie a linha de `agency_users` do owner ligando o login do Supabase Auth:

```sql
insert into agency_users (agency_id, auth_user_id, email, name, role)
values ('<agency id>', '<auth.users.id>', 'voce@agencia.com', 'Seu Nome', 'owner');
```

4. Entre no painel, vá em **Integração** e cole o snippet em
   *Agency Settings → Company → Custom JavaScript*.

## GeoIP

Baixe `GeoLite2-City.mmdb` da MaxMind e aponte `GEOIP_PATH` para ele. Sem o arquivo o
coletor sobe mesmo assim, avisa no log e grava as sessões sem cidade — nenhum evento é
perdido por causa disso.
