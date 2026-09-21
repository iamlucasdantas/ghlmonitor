export type Tier = 'onboarding' | 'healthy' | 'at_risk' | 'critical';
export type Role = 'owner' | 'admin' | 'manager';
export type Resource =
  | 'billing' | 'sessions_ip' | 'users_detail' | 'export' | 'notes' | 'alerts_config';

export type SignalId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8';

/** One row of metrics_daily, as the engine needs it. */
export interface DailyMetrics {
  date: string;              // YYYY-MM-DD
  contactsNew: number;
  msgsOut: number;
  oppsCreated: number;
  oppsMoved: number;
  appointments: number;
  workflowsActive: number;
  activeS: number;
  usersTotal: number;
  usersActive: number;
}

/** Everything the score needs about one sub-account on one day. */
export interface ScoreInput {
  /** The day being scored (YYYY-MM-DD). */
  date: string;
  /** Oldest-first daily rows. The engine slices its own windows out of this. */
  metrics: DailyMetrics[];
  /** Most recent login of any user of the sub-account, or null if never. */
  lastLoginAt: Date | null;
  /** When the sub-account started producing data (locations.first_data_at). */
  firstDataAt: Date | null;
  /** Users registered on the sub-account (HighLevel users, not agency staff). */
  usersTotal: number;
  /** Distinct users with at least one counted session in the last 30 days. */
  usersActive30d: number;
  /** Phase 2 — 'ok' | 'failed' | 'cancelled' | null when unknown. */
  saasStatus?: 'ok' | 'failed' | 'cancelled' | null;
}

export interface Driver {
  signal: SignalId;
  weight: number;       // effective weight after halving / redistribution
  value: number | null;
  baseline: number | null;
  points: number;       // points lost, already normalised
  label: string;        // ready-to-render pt-BR text (RF-04.2)
}

export interface ScoreResult {
  score: number;
  /** Tier implied by today's score alone, before the 2-day confirmation rule. */
  rawTier: Tier;
  drivers: Driver[];
  /** All signals, including the ones that lost nothing — useful for the calibration panel. */
  breakdown: Driver[];
  automationModel: boolean;
  ignored: SignalId[];
}

// ------------------------------------------------------------ script events

export type ScriptEventType = 'session_start' | 'heartbeat' | 'page_view' | 'session_end';

export interface ScriptEvent {
  type: ScriptEventType;
  sessionId: string;
  locationId: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  role?: string;
  ts: number;               // epoch ms, client clock
  page?: string;
  from?: string;
  to?: string;
  userAgent?: string;
  screen?: string;
  referrer?: string;
  tz?: string;
  reason?: string;
}

export interface BuiltSession {
  sessionId: string;
  locationId: string;
  userId: string;
  startedAt: Date;
  endedAt: Date;
  durationS: number;
  activeS: number;
  heartbeats: number;
  pages: { path: string; seconds: number }[];
  endReason: string;
  /** false when the session has fewer than 2 valid heartbeats (PRD §6.1). */
  counted: boolean;
}
