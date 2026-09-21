# Operação

## Deploy

| Componente | Onde | Observação |
| --- | --- | --- |
| `apps/web` | Vercel | precisa de `NEXT_PUBLIC_SUPABASE_*` e `NEXT_PUBLIC_COLLECTOR_URL` |
| `apps/collector` | Railway / Fly | precisa do `GeoLite2-City.mmdb` montado e de `tracking/pulse.min.js` no build |
| `apps/worker` | Railway / Fly | mesma imagem do coletor serve; muda o comando |
| Redis | Railway | fila BullMQ |
| Postgres | Supabase Pro | RLS, Auth e `pg_cron` |

O coletor e o worker compartilham o mesmo `npm run build`. Garanta que
`npm run build:script` roda antes do deploy do coletor — ele serve o
`/pulse.min.js` a partir do arquivo em disco e responde 503 se não achar.

## O que olhar quando algo parece errado

**Uma agência parou de mandar sessão.** `/superadmin` marca em amarelo qualquer agência
com mais de 6 h sem evento, e o worker loga `agency without script events` a cada hora.
Quase sempre é o Custom JavaScript removido do HighLevel ou uma mudança de rota no app —
o script tenta três formas de achar o `locationId` justamente por isso.

**Métricas divergindo do HighLevel.** Webhook perdido. O sync das 02:00 sobrescreve os
totais pela API; espere um ciclo antes de investigar. `events_raw` guarda 90 dias do que
chegou, então dá para reconstruir o que aconteceu.

**Sync não termina numa agência grande.** Confira `agencies.last_sync_status`: `partial`
significa que algumas subcontas falharam, e o log traz o `status` HTTP de cada uma. O
sync percorre pior score primeiro, então as subcontas em risco já estão atualizadas.

**Score parado.** O score do dia só existe depois do job das 03:00. Uma subconta com
menos de 14 dias de dados fica em `onboarding` de propósito e não entra em risco.

## Privacidade (LGPD/GDPR)

IP e localização são dados pessoais. Base legal: legítimo interesse mais cláusula no
contrato do white-label — o texto padrão vai no onboarding da agência.

- `events_raw` é purgado aos 90 dias.
- `sessions.ip` é anonimizado para /24 aos 180 dias.
- Exclusão por titular: `select forget_ghl_user('<location uuid>', '<ghl user id>')`
  anonimiza as sessões, apaga os eventos crus daquele usuário e remove o cadastro.

O script **não** coleta conteúdo de mensagem, e a API só lê metadado de conversa
(direção, canal, timestamp) — nunca o texto (§5.4).

## Segurança

- Token de OAuth guardado por agência; renovado quando falta menos de 5 min para expirar.
  Falha de refresh marca a agência como `error` em vez de repetir em silêncio.
- O token que assina o lote do script viaja dentro do snippet, então **não é segredo**.
  Ele garante integridade e escopo: um lote forjado só vale para a agência dona do token,
  e o coletor ainda confere se cada `locationId` pertence a ela. Rotacionar é trocar
  `agencies.hmac_secret` e recolar o snippet.
- Lote enviado por `sendBeacon` no `beforeunload` não tem como assinar: o coletor só
  aceita `session_end` sem assinatura, e o worker ignora um `session_end` de sessão que
  nunca viu.
- Antes de ir para produção, criptografe `oauth_access_token` / `oauth_refresh_token` em
  repouso com pgsodium (§12). O schema atual guarda em texto; é o item de segurança que
  falta fechar.
