# Colocar no ar, com URL pública

Duas etapas independentes. A primeira põe o painel na internet com os dados de
demonstração e custa nada. A segunda liga a HighLevel de verdade, e só ela precisa do
coletor, do worker e do Redis.

Faça a primeira sozinha se o objetivo é só ver a ferramenta e mostrar para alguém.

---

# Etapa 1 — painel público com dados de demonstração

Supabase (banco e Auth) + Vercel (painel). Plano gratuito nos dois. ~20 minutos.

O coletor, o worker e o Redis **não entram aqui**: sem HighLevel conectada não há
sessão para coletar nem sync para rodar, e os scores já vêm calculados pelo backfill.

## 1. Criar o projeto no Supabase

Em <https://supabase.com/dashboard>, **New project**. Guarde a senha do banco — ela
não é mostrada de novo. Espere ficar verde (~2 min).

Em **Project Settings → API**, anote:

- `Project URL` → vira `NEXT_PUBLIC_SUPABASE_URL`
- `anon public` → vira `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` → usada só aqui no terminal, **nunca** no painel

Em **Project Settings → Database → Connection string → URI**, copie a string e troque
`[YOUR-PASSWORD]` pela senha do projeto. Essa é a `DATABASE_URL`.

## 2. Aplicar as migrations

Na sua máquina, dentro do repositório:

```bash
supabase login
supabase link --project-ref <ref do projeto>   # o ref está na URL do dashboard
supabase db push
```

O `db push` aplica `supabase/migrations`. Se a pasta não existir ainda, gere-a a
partir da fonte de verdade:

```bash
mkdir -p supabase/migrations && i=0
for f in db/migrations/*.sql; do
  i=$((i+1)); printf -v s '2026010100%04d' "$i"
  cp "$f" "supabase/migrations/${s}_pulse_$(basename "$f")"
done
```

## 3. Popular os dados de demonstração

```bash
npm install
npm run build -w @pulse/core && npm run build -w @pulse/db && npm run build -w @pulse/worker

export DATABASE_URL='<a URI do passo 1, com a senha>'
node apps/worker/dist/cli.js seed-demo
```

`supabase db push` aplica migrations mas **não** o seed — `seed.sql` só roda na stack
local. Por isso o seed vai pelo `seed-demo`, que usa o mesmo cliente Postgres do
worker e não exige psql.

## 4. Criar os três logins

```bash
export SUPABASE_URL='<Project URL>'
export SERVICE_KEY='<service_role>'

for email in owner@demo.pulse admin@demo.pulse gerente@demo.pulse; do
  curl -sS -X POST "$SUPABASE_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"pulse-demo-1234\",\"email_confirm\":true}" \
    -o /dev/null
done

node apps/worker/dist/cli.js link-auth-users
node apps/worker/dist/cli.js backfill --agency 0de3a8b2-1c4d-4f6e-8a90-000000000001 --days 45
```

O `backfill` é o que calcula os scores, com o mesmo motor que roda em produção.

## 5. Publicar o painel na Vercel

Em <https://vercel.com/new>, importe o repositório `ghlmonitor`.

| Campo | Valor |
| --- | --- |
| Root Directory | `apps/web` |
| Framework | Next.js (detecta sozinho) |
| Branch | a que você quer publicar |

Em **Environment Variables**, só duas:

```
NEXT_PUBLIC_SUPABASE_URL      = <Project URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY = <anon public>
```

**Deploy.** Sai uma URL tipo `https://ghlmonitor.vercel.app`.

## 6. Autorizar a URL no Supabase

Em **Authentication → URL Configuration**, ponha a URL da Vercel em `Site URL` e
adicione `https://<sua-url>/auth/callback` em `Redirect URLs`. Sem isso o login falha.

## Pronto

Abra a URL e entre com `owner@demo.pulse` / `pulse-demo-1234`. Os outros dois logins
(`admin@` sem faturamento, `gerente@` com 9 subcontas) mostram a RLS e as permissões
mudando a tela.

**Isto é um ambiente de demonstração público.** Os três logins e a senha estão neste
documento, então qualquer pessoa com a URL entra. Não coloque dado de cliente aqui.

---

# Etapa 2 — conectar a HighLevel de verdade

Só agora entram o coletor, o worker e o Redis: o coletor precisa de URL pública para
receber o redirect do OAuth e os webhooks, e o worker precisa de fila.

| Componente | Onde | Custo aproximado |
| --- | --- | --- |
| `apps/collector` | Railway ou Fly | US$ 5/mês |
| `apps/worker` | Railway ou Fly | US$ 5/mês |
| Redis | Railway | US$ 5/mês |
| Supabase | o mesmo projeto, talvez Pro | US$ 0–25/mês |
| `apps/web` | a mesma Vercel | US$ 0 |

Nos dois serviços, o build é `npm install && npm run build`. O comando muda:

- coletor: `node apps/collector/dist/src/server.js`
- worker: `node apps/worker/dist/index.js`

As variáveis, os scopes do Marketplace, os eventos de webhook e a ordem da instalação
estão em [CONECTAR-HIGHLEVEL.md](CONECTAR-HIGHLEVEL.md).

**Antes de conectar dado de cliente:** os tokens de OAuth ainda são gravados em texto
no banco. O §12 pede pgsodium em repouso e isso não foi feito — veja
[OPERATIONS.md](OPERATIONS.md). Para a sua própria agência num teste não muda nada.
