import { currentUser, supabaseServer } from '@/lib/supabase/server';
import { Card, Stat } from '@/components/ui/primitives';
import { dateTime } from '@/lib/format';
import { Snippet } from './snippet';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const db = await supabaseServer();
  const me = await currentUser();

  const { data: agency } = await db
    .from('agencies')
    .select('id, name, install_status, last_script_event_at, last_sync_at, last_sync_status, timezone')
    .maybeSingle();

  const collectorUrl = process.env.NEXT_PUBLIC_COLLECTOR_URL ?? 'https://collect.pulse.app';
  const minutesSinceEvent = agency?.last_script_event_at
    ? (Date.now() - new Date(agency.last_script_event_at).getTime()) / 60_000
    : null;

  // RF-01.3: "recebendo dados" means an event in the last 10 minutes, nothing softer.
  const receiving = minutesSinceEvent !== null && minutesSinceEvent < 10;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="OAuth"
          value={agency?.install_status === 'active' ? 'Conectado' : 'Desconectado'}
          tone={agency?.install_status === 'active' ? 'good' : 'bad'}
          sub={agency?.name ?? ''}
        />
        <Stat
          label="Script"
          value={receiving ? 'Recebendo dados' : 'Sem eventos'}
          tone={receiving ? 'good' : 'warn'}
          sub={agency?.last_script_event_at ? `último evento ${dateTime(agency.last_script_event_at)}` : 'nenhum evento ainda'}
        />
        <Stat
          label="Sync"
          value={agency?.last_sync_status === 'ok' ? 'OK' : (agency?.last_sync_status ?? 'pendente')}
          tone={agency?.last_sync_status === 'ok' ? 'good' : 'warn'}
          sub={agency?.last_sync_at ? `rodou ${dateTime(agency.last_sync_at)}` : 'ainda não rodou'}
        />
      </div>

      <Card title="Script de tracking" hint="Agency Settings → Company → Custom JavaScript">
        <p className="mb-3 text-sm text-ink-dim">
          Cole o trecho abaixo. Ele roda dentro do app white-label em todas as subcontas
          e envia sessões para o Pulse. IP e cidade são resolvidos no servidor — o
          navegador nunca envia localização.
        </p>
        {agency
          ? <Snippet agencyId={agency.id} collectorUrl={collectorUrl} />
          : <p className="text-sm text-rose-300">Agência não encontrada.</p>}
      </Card>

      {me?.role === 'owner' && (
        <Card title="Reinstalar / reconectar">
          <p className="mb-3 text-sm text-ink-dim">
            Se o OAuth expirar ou a agência aparecer como desconectada, refaça a instalação.
          </p>
          <a
            href={`${process.env.NEXT_PUBLIC_COLLECTOR_URL ?? ''}/oauth/install`}
            className="inline-block rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            Instalar no HighLevel
          </a>
        </Card>
      )}
    </div>
  );
}
