# PRD — Pulse

O documento de produto que originou este repositório vive fora do código. Os requisitos
são referenciados ao longo do código pelo identificador (RF-04.3, §9, §16.6) para que
cada regra de negócio possa ser rastreada até a sua origem.

Mapa rápido de onde cada requisito foi implementado:

| Requisito | Onde |
| --- | --- |
| RF-01 Onboarding de agência | `apps/collector/src/routes/oauth.ts`, `apps/worker/src/processors/sync.ts`, `apps/web/app/agency/setup` |
| RF-02 Coleta de sessões | `tracking/pulse.js`, `apps/collector/src/routes/collect.ts`, `packages/core/src/sessions`, `apps/worker/src/processors/sessions.ts` |
| RF-03 Sync de negócio | `apps/worker/src/processors/webhooks.ts`, `apps/worker/src/processors/sync.ts` |
| RF-04 Score de churn | `packages/core/src/score`, `apps/worker/src/processors/score.ts` |
| RF-05 Painel de agência | `apps/web/app/agency/page.tsx`, `db/migrations/0003_views.sql` |
| RF-06 Painel de subconta | `apps/web/app/agency/locations/[id]` |
| RF-07 Controle de acesso | `db/migrations/0002_rls.sql`, `db/migrations/0003_views.sql`, `apps/web/app/agency/team` |
| RF-08 Alertas | `apps/worker/src/processors/alerts.ts`, `apps/web/app/agency/alerts` |
| RF-09 Super-admin | `apps/web/app/superadmin` |
| §12 Retenção / LGPD | `db/migrations/0004_retention.sql` |
