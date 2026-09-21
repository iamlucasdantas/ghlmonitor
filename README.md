# Pulse

Tracking de atividade e risco de churn para subcontas HighLevel.

> Saber quem vai cancelar 30 dias antes de o cliente saber.

Audita cada subconta em duas dimensões — **uso da plataforma** (login, sessão, IP, tempo
de tela) e **resultado de negócio** (contatos, conversas, mensagens, oportunidades,
faturamento) — e transforma isso num score de risco com drivers explicáveis, visão de
agência, visão de subconta e controle de acesso por papel.

## Onde está cada coisa

| Caminho | O que é |
| --- | --- |
| `db/migrations` | Schema, RLS, views com máscara por permissão, retenção |
| `db/test` | Fixtures e 28 asserts de RLS contra um Postgres de verdade |
| `packages/core` | Engine de score, session builder, HMAC — sem dependências |
| `packages/db` | Pool e repositórios compartilhados |
| `apps/collector` | `/collect`, `/webhooks/ghl`, OAuth, `/pulse.min.js` |
| `apps/worker` | Filas, sync noturno, score diário, alertas |
| `apps/web` | Painel Next.js |
| `tracking/pulse.js` | Script injetado no app white-label |
| `docs/` | [Arquitetura](docs/ARCHITECTURE.md) · [Desenvolvimento](docs/DEVELOPMENT.md) · [Operação](docs/OPERATIONS.md) |

## Score

Começa em 100 e perde pontos. Cada sinal com janela compara os últimos 7 dias com a
baseline da **própria** subconta — a média dos 30 dias anteriores à janela, escalada
para 7 dias, para que uma queda lenta não se esconda dentro da própria média.

| # | Sinal | Peso |
| --- | --- | --- |
| S1 | Dias desde o último login | 25 |
| S2 | Tempo ativo 7d vs. baseline | 20 |
| S3 | Mensagens enviadas 7d vs. baseline | 15 |
| S4 | Contatos novos 7d | 10 |
| S5 | Oportunidades movimentadas 7d | 10 |
| S6 | Usuários ativos 30d / cadastrados | 10 |
| S7 | Automação viva | 5 |
| S8 | Pagamento SaaS (Fase 2, desligado) | 5 |

Três regras evitam o falso positivo que derrubou a ferramenta anterior:

- **Sinal sem baseline sai da conta.** Uma subconta que nunca teve oportunidade não
  perde ponto por não ter oportunidade; o peso é redistribuído entre os outros sinais.
- **Modelo de automação.** Com 3+ workflows ativos e 100+ mensagens em 30 dias, S1 e S2
  pesam metade — automação pura não é conta morta. Essa folga **não** é redistribuída:
  cortar pela metade e escalar de volta anularia a exceção.
- **Menos de 14 dias de dados é `onboarding`**, e onboarding nunca vira risco.

Tier muda só depois de 2 dias seguidos no tier novo (`healthy ≥ 70`, `at_risk 40–69`,
`critical < 40`). Todo sinal que tirou ponto vira um driver com texto pronto:
*"Sem login há 12 dias"*, *"Mensagens enviadas −72% vs. média"*.

## Sessão

Uma sessão é uma sequência de heartbeats sem intervalo maior que 30 minutos. Um
heartbeat só é emitido com a aba **visível** e algum input nos últimos 60 segundos, e
tempo ativo é heartbeat válido × 30 s — nunca relógio de parede. Menos de 2 heartbeats
válidos é gravado com `counted = false` e não chega a painel nem ao score. É isso que
acaba com a subconta de "10 sessões, 0 min".

## Testes

```bash
npm test                  # 27 casos de score/sessão/HMAC + limite de 8 KB do script
npm run test:integration  # 10 casos no /collect real, com Postgres e Redis descartáveis
npm run test:db           # migrations + 28 asserts de RLS
```

Os testes de RLS rodam as políticas de verdade e cobrem os critérios de aceite do §16:
um manager não lê subconta não atribuída nem consultando a tabela direto, e desligar
`billing` para um admin apaga o faturamento em toda leitura. Os de integração sobem
Postgres e Redis descartáveis e batem no `/collect` de verdade, inclusive verificando
que a assinatura é conferida sobre os bytes recebidos — reserializar o corpo faz o
teste falhar.

## Status

MVP (Fase 1) do PRD implementado: instalação OAuth por agência, script de tracking,
sync + webhooks, score diário, painel de agência e de subconta, RBAC e alertas por
e-mail e webhook.

Fora desta entrega, por serem Fase 2 no PRD: Slack/WhatsApp, retorno ao HighLevel da
agência, benchmark por nicho, export CSV/PDF, status de pagamento SaaS e mapa de logins.
Um item de segurança fica em aberto e está anotado em
[docs/OPERATIONS.md](docs/OPERATIONS.md): os tokens de OAuth ainda são guardados em
texto e precisam de pgsodium antes da produção.
