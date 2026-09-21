import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

/** Exchanges the magic-link / OAuth code for a session cookie. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const next = req.nextUrl.searchParams.get('next') ?? '/agency';

  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL('/login?error=auth', req.nextUrl.origin));
    }
  }
  // `next` is attacker-influenceable, so only same-origin paths are honoured.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/agency';
  return NextResponse.redirect(new URL(safeNext, req.nextUrl.origin));
}
