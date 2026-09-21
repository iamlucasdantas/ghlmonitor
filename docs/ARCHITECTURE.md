# Arquitetura

```
[script no app HighLevel] --POST /collect------> [collector: HMAC, GeoIP, enfileira]
[webhooks HighLevel]      --POST /webhooks/ghl-> [collector: valida, enfileira]
                                                          |
                                                    [Redis / BullMQ]
                                                          |
                                                  [worker Node 22]
                                                   - session builder
                                                   - metrics aggregator
                                                   - sync noturno (02:00 TZ da agência)
                                                   - score engine (03:00)
                                                   - alert dispatcher
                                                          |
                                              [Postgres + RLS + Supabase Auth]
                                                          |
                                                 [Next.js 16 App Router]
```

## Por que o coletor não escreve no banco

O endpoint `/collect` precisa responder 204 em menos de 50 ms com 200 eventos/s por
agência (§12). Ele autentica o lote, resolve o IP para cidade com a base MaxMind local
e joga na fila. Montar sessão, criar usuário pendente e agregar métrica acontece no
worker. Perder evento de script é tolerável; perder webhook é recuperado pelo sync
noturno.

## Por que o painel lê de view, não de tabela

Autorização mora na RLS (RF-07.4). As páginas consultam views criadas com
`security_invoker = true`, então a política do usuário continua valendo dentro da view
— um manager não precisa filtrar no frontend porque o banco já não devolve o que não é
dele. As colunas sensíveis (`ip`, `city`, `plan_value`, `revenue_*`) são envolvidas em
`case when has_permission(...)`, então desligar "billing" para um admin faz o campo
sumir em todas as telas e exports de uma vez só.

Nenhuma tela consulta a tabela `sessions` para montar agregado. O painel de agência lê
`metrics_daily` e `health_scores`, que já vêm calculados — é isso que segura 157 (e 500)
subcontas abaixo de 2 s.

## O que corrige os falsos positivos do Spark Tracker

| Problema antigo | O que mudou |
| --- | --- |
| Heartbeat contado como sessão ("10 sessões, 0 min") | Heartbeat só é emitido com aba visível **e** input nos últimos 60 s. Sessão com menos de 2 heartbeats válidos é gravada com `counted = false` e nunca aparece em painel nem no score. |
| Saúde medida só por tempo de tela | Score combina 8 sinais de uso **e** de negócio, cada um comparado com a baseline da própria subconta. |
| Subconta de automação pura marcada como crítica | Exceção do §9: com 3+ workflows ativos e 100+ mensagens em 30 d, S1 e S2 pesam metade. |
| "Unknown Location" | O script resolve o `locationId` por três caminhos (URL, localStorage/JWT, DOM) e o coletor rejeita um lote cujo `locationId` não pertença à agência da chave. |

## Fila e limites

A HighLevel permite 100 requisições / 10 s **por location**. O cliente da API mantém um
limiter por `locationId`, com backoff exponencial e respeito ao `Retry-After` em 429. O
sync percorre as subcontas em ordem de pior score primeiro: se uma agência de 500
subcontas estourar o orçamento do dia, as que interessam já foram atualizadas.

## Ordem dos jobs

Um scheduler horário lê o relógio local de cada agência e dispara:

| Hora local | Job |
| --- | --- |
| 02:00 | `nightly-sync` — recalcula totais pela API e corrige divergência dos webhooks |
| 03:00 | `score-agency` — score do dia, drivers e confirmação de tier |
| 03:05 | `dispatch-alerts` — regras com cooldown de 72 h |
| Segunda 08:00 | `weekly-digest` |

O `jobId` é derivado da agência e do dia, então reiniciar o worker dentro da mesma hora
não redispara nada.
