import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pulse — risco de churn por subconta',
  description: 'Uso da plataforma e resultado de negócio de cada subconta HighLevel, em um score.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-surface text-ink antialiased">{children}</body>
    </html>
  );
}
