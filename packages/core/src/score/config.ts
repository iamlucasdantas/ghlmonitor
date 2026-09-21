import type { SignalId } from '../types.js';

export interface SignalConfig {
  id: SignalId;
  weight: number;
  /** S8 ships in Phase 2; a disabled signal is left out of the denominator. */
  enabled: boolean;
  title: string;
}

/** Weights from PRD §9. They sum to 100. */
export const SIGNALS: SignalConfig[] = [
  { id: 'S1', weight: 25, enabled: true,  title: 'Dias desde o último login' },
  { id: 'S2', weight: 20, enabled: true,  title: 'Tempo ativo 7d vs. baseline' },
  { id: 'S3', weight: 15, enabled: true,  title: 'Mensagens enviadas 7d vs. baseline' },
  { id: 'S4', weight: 10, enabled: true,  title: 'Contatos novos 7d' },
  { id: 'S5', weight: 10, enabled: true,  title: 'Oportunidades movimentadas 7d' },
  { id: 'S6', weight: 10, enabled: true,  title: 'Usuários ativos 30d / cadastrados' },
  { id: 'S7', weight: 5,  enabled: true,  title: 'Automação viva' },
  { id: 'S8', weight: 5,  enabled: false, title: 'Pagamento SaaS' },
];

export const TIER_THRESHOLDS = { healthy: 70, atRisk: 40 } as const;

/** Days of history a sub-account needs before it can leave 'onboarding' (RF-04.4). */
export const ONBOARDING_DAYS = 14;

/** A tier only sticks after this many consecutive days (RF-04.3). */
export const TIER_CONFIRM_DAYS = 2;

/** "Modelo de automação" thresholds (PRD §9, exceções). */
export const AUTOMATION_MODEL = {
  minWorkflowsActive: 3,
  minMsgsOut30d: 100,
  /** Active time in the 7-day window below this (seconds) counts as "tempo ativo baixo". */
  lowActiveS7d: 1800,
  /** S1 and S2 weigh half for these sub-accounts. */
  weightMultiplier: 0.5,
};
