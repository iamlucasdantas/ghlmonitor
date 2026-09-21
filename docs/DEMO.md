# Ambiente de demonstração

Sobe um Pulse completo com 18 subcontas fictícias e scores calculados pelo motor de
verdade — sem agência HighLevel, sem OAuth, sem esperar 14 dias de dados.

```bash
scripts/demo.sh
npm run dev:web        # http://localhost:3000
```

Requisitos: Node 22+, Docker rodando e a CLI do Supabase (`npm i -g supabase`). **Não
precisa de `psql`** — as migrations e o seed são aplicados pela própria CLI do Supabase. O painel depende
de Auth e PostgREST, então a demo usa o Supabase local — não o `docker-compose.yml`
deste repositório, que serve aos testes.

## Os três logins

Senha `pulse-demo-1234` para todos. Vale entrar com os três: é a forma mais rápida de
ver a RLS e os toggles de permissão mudando o que aparece na tela.

| Login | O que muda |
| --- | --- |
| `owner@demo.pulse` | vê as 18 subcontas, com plano e faturamento |
| `admin@demo.pulse` | mesmo alcance, mas sem permissão de `billing`: MRR em risco e receita somem |
| `gerente@demo.pulse` | só as 9 subcontas atribuídas a ele, e só as sessões delas |

## O que os dados demonstram

O seed grava apenas dados **brutos** — métricas diárias, usuários e sessões. Os scores
não são escritos à mão: quem os calcula é `pulse backfill`, rodando o mesmo motor que
roda em produção. Um seed que escrevesse os tiers demonstraria o seed, não o produto.

Os 18 perfis existem para exercitar as regras do §9:

| Perfil | Para quê |
| --- | --- |
| 5 estáveis, 2 crescendo | score 100; crescimento nunca tira ponto |
| 3 em queda suave | atravessam o limiar de `at_risk` em dias diferentes |
| 2 em queda forte | `critical`, com "sem login há N dias" como driver principal |
| 2 de automação pura | 5 workflows, 60 msgs/dia, quase nenhum tempo de tela e ~30 dias sem login — **continuam `healthy`** pela exceção do §9 |
| 2 recém-instaladas | `onboarding`; nunca viram risco, mesmo sem dados |
| 1 nunca acessada | score 0 |
| 1 sem funil | nunca teve oportunidade, então S5 sai da conta em vez de penalizar |

Duas coisas que parecem bug e não são:

- **`Autoescola Direção` tem score 55 e ainda aparece como `healthy`.** É a confirmação
  de tier em 2 dias (RF-04.3): o `raw_tier` virou `at_risk` hoje, e o tier confirmado só
  muda depois de dois dias seguidos. `Buffet Encanto`, com o mesmo score 55, já
  confirmou porque cruzou ontem. Os dois lado a lado são o exemplo.
- **As subcontas de automação estão `healthy` com quase um mês sem login.** É a exceção
  do §9: com 3+ workflows ativos e 100+ mensagens em 30 dias, S1 e S2 pesam metade.
  Sem ela, as duas seriam `critical` — que é exatamente o falso positivo que derrubou a
  ferramenta anterior.

A distribuição fica em 28% entre risco e crítico, abaixo da meta de ≤30% do §3.

## Recalcular

```bash
export DATABASE_URL="$(supabase status -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).DB_URL))')"
AG=0de3a8b2-1c4d-4f6e-8a90-000000000001

node apps/worker/dist/cli.js agencies
node apps/worker/dist/cli.js score    --agency $AG
node apps/worker/dist/cli.js backfill --agency $AG --days 45
node apps/worker/dist/cli.js alerts   --agency $AG
```

O backfill roda do dia mais antigo para o mais novo de propósito: a confirmação de tier
depende do tier do dia anterior, então rodar fora de ordem produz um histórico errado.

## Derrubar

```bash
supabase stop
```
