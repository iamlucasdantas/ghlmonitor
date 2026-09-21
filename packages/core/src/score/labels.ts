import type { SignalId } from '../types.js';

const pct = (n: number) => `${Math.round(n * 100)}%`;
const min = (s: number) => `${Math.round(s / 60)} min`;

export interface LabelCtx {
  value: number | null;
  baseline: number | null;
  /** Relative drop vs. baseline, 0..1. */
  drop?: number;
  days?: number;
}

/** Ready-to-render driver text (RF-04.2 / PRD §9 "Drivers"). */
export function driverLabel(signal: SignalId, c: LabelCtx): string {
  switch (signal) {
    case 'S1':
      if (c.days === null || c.days === undefined) return 'Nenhum login registrado';
      if (!Number.isFinite(c.days)) return 'Nenhum login registrado';
      return `Sem login há ${c.days} ${c.days === 1 ? 'dia' : 'dias'}`;
    case 'S2':
      if (!c.value) return 'Nenhum tempo ativo em 7 dias';
      return `Tempo ativo ${min(c.value)} em 7d, −${pct(c.drop ?? 0)} vs. média`;
    case 'S3':
      if (!c.value) return 'Nenhuma mensagem enviada em 7 dias';
      return `Mensagens enviadas −${pct(c.drop ?? 0)} vs. média`;
    case 'S4':
      if (!c.value) return 'Nenhum contato novo em 7 dias';
      return `Contatos novos ${c.value} em 7d, abaixo da metade da média (${Math.round(c.baseline ?? 0)})`;
    case 'S5':
      if (!c.value) return 'Nenhuma oportunidade movimentada em 7 dias';
      return `Oportunidades movimentadas ${c.value} em 7d, abaixo da metade da média`;
    case 'S6':
      return `Apenas ${pct(c.value ?? 0)} dos usuários acessaram nos últimos 30 dias`;
    case 'S7':
      return 'Nenhum workflow ativo nem agendamento em 30 dias';
    case 'S8':
      return 'Pagamento da assinatura com falha';
  }
}
