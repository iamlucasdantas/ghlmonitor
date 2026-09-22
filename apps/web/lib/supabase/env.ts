/**
 * As variáveis do Supabase eram lidas com `!`, o que é uma mentira: quando faltavam,
 * o app quebrava lá dentro do cliente do Supabase com "Your project's URL and Key are
 * required", sem dizer o que fazer. Isso acontece exatamente no caso mais comum —
 * rodar `npm run dev:web` antes de `scripts/demo.sh`, que é quem escreve o
 * .env.local. Aqui a ausência é um estado previsto, e as telas explicam o conserto.
 */
export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

export function supabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function requireSupabaseEnv(): SupabaseEnv {
  const env = supabaseEnv();
  if (!env) {
    throw new Error(
      'Faltam NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Rode scripts/demo.sh (ele escreve apps/web/.env.local) ou defina as duas ' +
        'variáveis no ambiente — veja docs/DEPLOY.md.',
    );
  }
  return env;
}
