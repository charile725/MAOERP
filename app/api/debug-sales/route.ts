import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

export async function GET() {
  try {
    const { data: sales } = await (supabaseServer
      .from('sales') as any)
      .select(`
        sale_no,
        source,
        total,
        status,
        is_paid,
        created_at,
        sale_items (
          id,
          quantity,
          price,
          subtotal,
          snapshot_name
        )
      `)
      .eq('source', 'live')
      .order('created_at', { ascending: false })
      .limit(5)

    return NextResponse.json({ ok: true, data: sales })
  } catch (error) {
    return NextResponse.json({ ok: false, error: '系統錯誤' }, { status: 500 })
  }
}
