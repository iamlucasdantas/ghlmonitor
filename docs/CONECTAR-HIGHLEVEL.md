# Conectar uma agência HighLevel de verdade

O `scripts/demo.sh` mostra o painel funcionando com dados fictícios. Este documento é o
outro caminho: ligar a sua agência real, receber sessões e webhooks e ver o score sair
de dados de verdade.

## Por que não dá para fazer isso só em localhost

Três coisas precisam de uma URL pública:

1. **O `redirect_uri` do OAuth** — a HighLevel redireciona o navegador para lá depois
   do "Instalar", e ela exige HTTPS.
2. **O endpoint de webhook** — a HighLevel faz POST de servidor para servidor. Ela não
   alcança o seu `localhost`.
3. **O script de tracking** — roda dentro do app white-label, no navegador dos seus
   clientes. Se apontar para `localhost`, funciona só na sua máquina.

Duas formas de resolver, e a escolha depende de quanto tempo o teste vai durar.

## Caminho A — túnel, para testar hoje

Rápido de montar, mas a URL morre quando você fecha o terminal (a menos que use um
domínio fixo do Cloudflare ou do ngrok pago). Bom para uma tarde de teste.

```bash
# uma dessas
cloudflared tunnel --url http://localhost:3001
ngrok http 3001
```

Anote a URL que aparecer — algo como `https://abc-123.trycloudflare.com`. Ela é o
**endereço do coletor**. Daqui em diante, `<COLETOR>`.

## Caminho B — deploy, para deixar de pé

| Componente | Onde | Por quê |
| --- | --- | --- |
| `apps/collector` | Railway ou Fly | precisa de URL pública e estável |
| `apps/worker` | Railway ou Fly | mesma imagem, comando diferente |
| Redis | Railway | fila do BullMQ |
| Postgres + Auth | Supabase Pro | RLS, Auth e `pg_cron` |
| `apps/web` | Vercel | painel |

Detalhes em [OPERATIONS.md](OPERATIONS.md).

## O app no Marketplace da HighLevel

Em <https://marketplace.gohighlevel.com>, crie um app **de agência**
(*Distribution Type: Agency*). É o ponto onde é mais fácil errar: um app instalado
no nível de subconta não devolve `companyId`, e o callback recusa a instalação com
uma mensagem explicando isso.

**Redirect URI**

```
<COLETOR>/oauth/callback
```

**Scopes** — exatamente estes (PRD §6.2). Faltando qualquer um, o sync daquela métrica
falha com 401 e a subconta aparece sem o dado:

```
locations.readonly
users.readonly
contacts.readonly
conversations.readonly
conversations/message.readonly
opportunities.readonly
calendars/events.readonly
workflows.readonly
saas/company.read
oauth.readonly
```

**Webhook URL**

```
<COLETOR>/webhooks/ghl
```

**Eventos para assinar** — o coletor reconhece estes e descarta o resto:

```
INSTALL              UNINSTALL
LocationCreate       LocationUpdate
UserCreate
ContactCreate        ContactDelete
InboundMessage       OutboundMessage
OpportunityCreate    OpportunityStageUpdate
OpportunityStatusUpdate                OpportunityMonetaryValueUpdate
AppointmentCreate
```

Guarde o **Client ID**, o **Client Secret** e o **segredo de webhook**.

## Variáveis

No `.env` da máquina ou do serviço onde o coletor e o worker rodam:

```bash
DATABASE_URL=...                       # Postgres do Supabase
REDIS_URL=...
GHL_CLIENT_ID=...
GHL_CLIENT_SECRET=...
GHL_REDIRECT_URI=<COLETOR>/oauth/callback
GHL_WEBHOOK_SECRET=...                 # vazio só em dev: sem ele, webhook sem assinatura passa
APP_URL=http://localhost:3000          # ou a URL do painel na Vercel
GEOIP_PATH=./GeoLite2-City.mmdb        # opcional; sem ele a sessão fica sem cidade
```

No `apps/web/.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_COLLECTOR_URL=<COLETOR>
```

## A instalação, em ordem

1. **Suba o banco.** Aplique `db/migrations/*.sql` no SQL Editor do Supabase, em ordem.
2. **Suba o coletor e o worker.** `npm run dev:collector` e `npm run dev:worker`, ou o
   deploy. Confira `<COLETOR>/ready` — ele responde 200 com `postgres: ok` e `redis: ok`.
3. **Instale o app.** Abra `<COLETOR>/oauth/install` no navegador e escolha a **agência**.
   O callback grava a agência, cria as 4 regras de alerta padrão e enfileira a
   importação das subcontas e dos usuários.
4. **Crie o seu login.** Entre no painel uma vez (magic link) para o Supabase Auth criar
   a linha em `auth.users`, e então ligue-a à agência:

   ```bash
   # descubra o id da agência
   node apps/worker/dist/cli.js agencies
   ```

   ```sql
   -- no SQL Editor do Supabase
   insert into agency_users (agency_id, email, name, role)
   values ('<id da agência>', 'voce@suaagencia.com', 'Seu Nome', 'owner');
   ```

   ```bash
   node apps/worker/dist/cli.js link-auth-users
   ```

5. **Cole o script.** No painel, em **Integração**, copie o snippet e cole em
   *Agency Settings → Company → Custom JavaScript* na HighLevel. Abra qualquer subconta
   e mexa na tela por um minuto.
6. **Confira.** Em até 10 minutos o card "Script" vira *Recebendo dados*. Se não virar,
   veja abaixo.

## O que esperar nos primeiros dias

Isto não é bug, é o desenho:

- **Toda subconta começa em `onboarding`** e fica assim por 14 dias. Sem 14 dias de
  dados não existe baseline, e sem baseline o score é chute (RF-04.4).
- **Os scores só aparecem depois do job das 03:00** no fuso da agência. Para ver antes:
  `node apps/worker/dist/cli.js score --agency <id>`.
- **O histórico de mensagens não é reconstruído.** O dia da instalação é o dia zero; os
  números acumulam a partir dali (§6.2).
- **O sync roda às 02:00.** Para forçar: reinicie o worker ou use o CLI.

## Quando não funcionar

**O card "Script" não sai de *Sem eventos*.** Abra o console do navegador dentro do app
da HighLevel. Sem nenhuma requisição para `/collect`, o script não achou o `locationId`
ou o usuário — ele tenta três caminhos (URL, localStorage/JWT, DOM) e desiste calado.
Com requisição mas resposta 401 ou 429, é assinatura ou rate limit. Lembre que
heartbeat só é emitido com a **aba visível e algum input nos últimos 60 segundos** —
deixar a aba aberta parada não gera nada, de propósito.

**Sessão aparece sem cidade.** Falta o `GeoLite2-City.mmdb`. O coletor sobe assim mesmo
e avisa no log.

**Instalação recusada.** A mensagem diz: o app foi instalado numa subconta em vez da
agência. Reinstale escolhendo a agência.

**Métrica divergindo da HighLevel.** Webhook perdido. O sync das 02:00 sobrescreve os
totais pela API — espere um ciclo. `events_raw` guarda 90 dias do que chegou.

**Agência sumiu do ar.** `/superadmin` marca em amarelo qualquer agência com mais de 6h
sem evento, e o worker loga `agency without script events` de hora em hora.

## Antes de conectar cliente de verdade

Os tokens de OAuth são gravados em texto no banco. O §12 pede pgsodium em repouso, e
isso ainda não foi feito — está anotado em [OPERATIONS.md](OPERATIONS.md). Para um teste
com a sua própria agência não muda nada; para dados de cliente, resolva antes.
