import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'

// GET /api/ichiban-kuji/official-purchases - 官方套進貨紀錄（純檢視，不含帳務）
export async function GET(request: NextRequest) {
  try {
    await requireRole('admin')

    // 查詢所有官方套
    const { data: kujis, error } = await (supabaseServer
      .from('ichiban_kuji') as any)
      .select('id, name, total_cost, vendor_code, is_active, created_at, total_draws')
      .eq('set_type', 'official')
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    if (!kujis || kujis.length === 0) {
      return NextResponse.json({ ok: true, data: [] })
    }

    // 查詢廠商名稱
    const vendorCodes = [...new Set(kujis.map((k: any) => k.vendor_code).filter(Boolean))]
    const vendorMap = new Map<string, string>()
    if (vendorCodes.length > 0) {
      const { data: vendors } = await (supabaseServer
        .from('vendors') as any)
        .select('vendor_code, vendor_name')
        .in('vendor_code', vendorCodes)

      for (const v of vendors || []) {
        vendorMap.set(v.vendor_code, v.vendor_name)
      }
    }

    const result = kujis.map((k: any) => ({
      id: k.id,
      name: k.name,
      total_cost: k.total_cost || 0,
      vendor_code: k.vendor_code || '',
      vendor_name: vendorMap.get(k.vendor_code) || k.vendor_code || '-',
      is_active: k.is_active,
      created_at: k.created_at,
      total_draws: k.total_draws || 0,
    }))

    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    return NextResponse.json({ ok: false, error: '系統錯誤' }, { status: 500 })
  }
}
