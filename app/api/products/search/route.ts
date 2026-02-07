import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// GET /api/products/search - Quick search for POS (by barcode or name)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const barcode = searchParams.get('barcode')
    const keyword = searchParams.get('keyword')
    const activeOnly = searchParams.get('active_only') !== 'false' // Default true for POS

    if (!barcode && !keyword) {
      return NextResponse.json(
        { ok: false, error: '請輸入條碼或關鍵字' },
        { status: 400 }
      )
    }

    let query = supabaseServer
      .from('products')
      .select('id, item_code, barcode, name, unit, price, cost, stock, avg_cost, allow_negative, is_active')

    // Only filter by active status if activeOnly is true (for POS)
    // For purchases/inventory management, allow searching all products
    if (activeOnly) {
      query = query.eq('is_active', true)
    }

    if (barcode) {
      query = query.eq('barcode', barcode)
    } else if (keyword) {
      query = query.or(`name.ilike.%${keyword}%,item_code.ilike.%${keyword}%,barcode.ilike.%${keyword}%`)
      query = query.limit(10)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    // For barcode search, return single item or null
    if (barcode) {
      return NextResponse.json({
        ok: true,
        data: data && data.length > 0 ? data[0] : null
      })
    }

    return NextResponse.json({ ok: true, data })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
