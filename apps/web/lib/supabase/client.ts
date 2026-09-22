'use client';

import { createBrowserClient } from '@supabase/ssr';
import { requireSupabaseEnv } from './env';

export function supabaseBrowser() {
  const env = requireSupabaseEnv();
  return createBrowserClient(env.url, env.anonKey);
}
