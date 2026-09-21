import { revalidatePath } from 'next/cache';
import { currentUser, supabaseServer } from '@/lib/supabase/server';
import { Card, Empty } from '@/components/ui/primitives';
import { dateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function NotesTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await supabaseServer();
  const me = await currentUser();
  const canWrite = me?.permissions.notes !== false;

  const { data } = await db
    .from('location_notes')
    .select('id, body, created_at, author_id, agency_users(name, email)')
    .eq('location_id', id)
    .order('created_at', { ascending: false });

  async function addNote(formData: FormData) {
    'use server';
    const body = String(formData.get('body') ?? '').trim();
    if (!body) return;

    const supabase = await supabaseServer();
    const author = await currentUser();
    if (!author) return;

    // RLS also enforces the 'notes' permission, so a forged POST fails at the database.
    await supabase.from('location_notes').insert({
      location_id: id, author_id: author.agencyUserId, body,
    });
    revalidatePath(`/agency/locations/${id}/notes`);
  }

  const notes = data ?? [];

  return (
    <div className="space-y-5">
      {canWrite && (
        <Card title="Nova nota">
          <form action={addNote} className="space-y-2">
            <textarea
              name="body"
              rows={3}
              required
              placeholder="O que está acontecendo com esta conta?"
              className="w-full rounded-lg border border-edge bg-panel-2 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/40"
            />
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
            >
              Salvar nota
            </button>
          </form>
        </Card>
      )}

      <Card title="Histórico de notas">
        {notes.length === 0 ? (
          <Empty>{canWrite ? 'Nenhuma nota ainda.' : 'Você não tem acesso às notas desta agência.'}</Empty>
        ) : (
          <ul className="divide-y divide-edge">
            {notes.map((n) => {
              const author = n.agency_users as unknown as { name: string | null; email: string } | null;
              return (
                <li key={n.id as string} className="py-3">
                  <p className="whitespace-pre-wrap text-sm">{n.body as string}</p>
                  <p className="mt-1 text-xs text-ink-dim">
                    {author?.name ?? author?.email ?? 'alguém'} · {dateTime(n.created_at as string)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
