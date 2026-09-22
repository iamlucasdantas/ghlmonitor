import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseEnv } from '@/lib/supabase/env';

/**
 * Refreshes the Supabase session cookie and keeps unauthenticated visitors out of the
 * app shell. This is convenience, not security — the data itself is protected by RLS,
 * so a bypassed redirect still returns nothing.
 */
export async function proxy(req: NextRequest) {
  const res = NextResponse.next({ request: req });

  /* Sem configuração, manda todo mundo para /login, que explica o que falta. O
     redirect precisa acontecer aqui: layout e página renderizam em paralelo, então
     um `redirect()` dentro do layout de /agency não impede a página de rodar e
     estourar no cliente do Supabase — que era o erro em tela. */
  const env = supabaseEnv();
  if (!env) {
    if (req.nextUrl.pathname.startsWith('/login')) return res;
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  const supabase = createServerClient(
    env.url,
    env.anonKey,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
          for (const { name, value, options } of list) res.cookies.set(name, value, options);
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;
  const isPublic = path.startsWith('/login') || path.startsWith('/auth');

  if (!data.user && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }
  if (data.user && path === '/login') {
    const url = req.nextUrl.clone();
    url.pathname = '/agency';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
};
