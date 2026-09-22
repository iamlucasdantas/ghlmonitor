'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

/**
 * O produto autentica por magic link e Google (PRD §13). Senha existe só no modo de
 * demonstração: o ambiente de demo cria três logins prontos, e um magic link ali
 * significaria caçar o e-mail num mail catcher local só para ver o painel. A flag é
 * de build, então numa instalação real o campo não existe — não é um formulário
 * escondido atrás de um if em runtime.
 */
const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === '1';

export function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const next = params.get('next') ?? '/agency';
  const [email, setEmail] = useState(DEMO ? 'owner@demo.pulse' : '');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setState('error');
      setMessage(error.message);
      return;
    }
    router.push(next as never);
    router.refresh();
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) {
      setState('error');
      setMessage(error.message);
      return;
    }
    setState('sent');
  }

  async function signInWithGoogle() {
    const supabase = supabaseBrowser();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
  }

  if (state === 'sent') {
    return (
      <div className="rounded-xl border border-edge bg-panel p-6 text-center text-sm">
        <p className="font-medium">Link enviado</p>
        <p className="mt-1 text-ink-dim">Abra o e-mail em {email} para entrar.</p>
      </div>
    );
  }

  const inputClass =
    'w-full rounded-lg border border-edge bg-panel-2 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/50';

  return (
    <div className="rounded-xl border border-edge bg-panel p-6">
      <form onSubmit={DEMO ? signInWithPassword : sendMagicLink} className="space-y-3">
        <label className="block text-sm text-ink-dim" htmlFor="email">E-mail</label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          placeholder="voce@agencia.com"
        />

        {DEMO && (
          <>
            <label className="block text-sm text-ink-dim" htmlFor="password">Senha</label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder="pulse-demo-1234"
            />
          </>
        )}

        <button
          type="submit"
          disabled={state === 'sending'}
          className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60"
        >
          {state === 'sending' ? 'Entrando…' : DEMO ? 'Entrar' : 'Entrar com link mágico'}
        </button>
      </form>

      {DEMO && (
        <p className="mt-3 text-xs text-ink-dim">
          Ambiente de demonstração. Logins: <code>owner@demo.pulse</code>,{' '}
          <code>admin@demo.pulse</code>, <code>gerente@demo.pulse</code> — senha{' '}
          <code>pulse-demo-1234</code>.
        </p>
      )}

      <div className="my-4 flex items-center gap-3 text-xs text-ink-dim">
        <span className="h-px flex-1 bg-edge" /> ou <span className="h-px flex-1 bg-edge" />
      </div>

      <button
        onClick={signInWithGoogle}
        className="w-full rounded-lg border border-edge bg-panel-2 px-3 py-2 text-sm hover:bg-edge"
      >
        Entrar com Google
      </button>

      {state === 'error' && <p className="mt-3 text-sm text-rose-300">{message}</p>}
    </div>
  );
}
