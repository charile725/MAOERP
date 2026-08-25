import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

let client: SupabaseClient<Database> | null = null;

// 延遲建立：build 期收集 page data 時不會因為缺環境變數而整個 build 掛掉
function getClient(): SupabaseClient<Database> {
  if (!client) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error(
        'Supabase 環境變數缺失：需要 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY'
      );
    }
    client = createClient<Database>(supabaseUrl, supabaseServiceKey);
  }
  return client;
}

export const supabaseServer = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    const instance = getClient() as unknown as Record<string | symbol, unknown>;
    const value = instance[prop];
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});
