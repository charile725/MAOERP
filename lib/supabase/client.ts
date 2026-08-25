import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

let client: SupabaseClient<Database> | null = null;

// 延遲建立：build 期收集 page data 時不會因為缺環境變數而整個 build 掛掉
function getClient(): SupabaseClient<Database> {
  if (!client) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'Supabase 環境變數缺失：需要 NEXT_PUBLIC_SUPABASE_URL 與 NEXT_PUBLIC_SUPABASE_ANON_KEY'
      );
    }
    client = createClient<Database>(supabaseUrl, supabaseAnonKey);
  }
  return client;
}

export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    const instance = getClient() as unknown as Record<string | symbol, unknown>;
    const value = instance[prop];
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});
