import { Suspense } from 'react';
import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold">Pulse</h1>
          <p className="mt-1 text-sm text-ink-dim">
            Saber quem vai cancelar 30 dias antes de o cliente saber.
          </p>
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
