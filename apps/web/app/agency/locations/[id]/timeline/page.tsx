import { supabaseServer } from '@/lib/supabase/server';
import { Card, Empty } from '@/components/ui/primitives';
import { dateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const ICON: Record<string, string> = {
  tier_changed: '◆',
  user_created: '＋',
  first_login_after_gap: '↺',
  workflow_disabled: '⏻',
};

export default async function TimelineTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await supabaseServer();

  const { data } = await db
    .from('timeline_events')
    .select('id, type, title, meta, at')
    .eq('location_id', id)
    .order('at', { ascending: false })
    .limit(100);

  const events = data ?? [];

  return (
    <Card title="Timeline" hint="Eventos relevantes da subconta">
      {events.length === 0 ? (
        <Empty>Nada registrado ainda.</Empty>
      ) : (
        <ol className="relative space-y-4 border-l border-edge pl-6">
          {events.map((e) => (
            <li key={e.id as number} className="relative">
              <span className="absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full bg-panel-2 text-xs text-ink-dim ring-1 ring-edge">
                {ICON[e.type as string] ?? '•'}
              </span>
              <div className="text-sm">{e.title as string}</div>
              <div className="text-xs text-ink-dim">{dateTime(e.at as string)}</div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
