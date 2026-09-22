import { Suspense } from 'react';
import { supabaseEnv } from '@/lib/supabase/env';
import { LoginForm } from './login-form';

export default function LoginPage() {
  const configured = supabaseEnv() !== null;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold">Pulse</h1>
          <p className="mt-1 text-sm text-ink-dim">
            Saber quem vai cancelar 30 dias antes de o cliente saber.
          </p>
        </div>
        {configured ? (
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        ) : (
          <NotConfigured />
        )}
      </div>
    </main>
  );
}

/**
 * Faltar configuração é o estado normal de quem acabou de clonar o repositório, não
 * um erro do programa. Esta tela diz qual comando resolve, em vez de deixar o
 * cliente do Supabase estourar com "URL and Key are required".
 */
function NotConfigured() {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-sm">
      <p className="font-medium text-amber-300">Falta configurar o Supabase</p>
      <p className="mt-2 text-ink-dim">
        O painel não sabe onde fica o banco. Não existe{' '}
        <code className="text-ink">apps/web/.env.local</code> com{' '}
        <code className="text-ink">NEXT_PUBLIC_SUPABASE_URL</code> e{' '}
        <code className="text-ink">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
      </p>

      <p className="mt-4 text-ink-dim">Para ver a demonstração, rode antes:</p>
      <pre className="mt-2 overflow-x-auto rounded-lg border border-edge bg-panel-2 p-3 text-xs">
        <code>scripts/demo.sh</code>
      </pre>
      <p className="mt-2 text-xs text-ink-dim">
        Ele sobe o Supabase local, popula 18 subcontas fictícias, calcula os scores e
        escreve o <code>.env.local</code>. Depois, reinicie o{' '}
        <code>npm run dev:web</code>.
      </p>

      <p className="mt-4 text-xs text-ink-dim">
        Para apontar para um Supabase na nuvem, veja <code>docs/DEPLOY.md</code>.
      </p>
    </div>
  );
}
