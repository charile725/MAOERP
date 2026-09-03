import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { ichibanKujiDraftSchema } from '@/lib/schemas'
import { createIchibanKuji } from '@/lib/ichiban-kuji-service'
import { fromZodError } from 'zod-validation-error'

// GET /api/ichiban-kuji - List all ichiban kuji
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const active = searchParams.get('active')
    const all = searchParams.get('all') === 'true'
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = 20

    let query = (supabaseServer
      .from('ichiban_kuji') as any)
      .select(`
        *,
        ichiban_kuji_prizes (
          id,
          prize_tier,
          prize_name,
          product_id,
          quantity,
          remaining,
          products (
            id,
            name,
            item_code,
            barcode,
            cost,
            price,
            unit
          ),
          ichiban_kuji_prize_options (
            id,
            product_id,
            is_consumed,
            products (
              id,
              name,
              item_code,
              cost
            )
          )
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })

    if (active !== null) {
      query = query.eq('is_active', active === 'true')
    }

    const setType = searchParams.get('set_type')
    if (setType) {
      query = query.eq('set_type', setType)
    }

    // Apply pagination (unless all=true)
    if (!all) {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1
      query = query.range(from, to)
    } else {
      query = query.limit(10000)
    }

    const { data, error, count } = await query

    if (error) {
      console.error('[GET /api/ichiban-kuji] Supabase error:', error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    // 手動查詢最後賞商品（因為 last_prize_product_id 可能缺少 FK 約束）
    const lastPrizeProductIds = (data as any[])
      ?.map((k: any) => k.last_prize_product_id)
      .filter(Boolean) || []

    let lastPrizeProductMap = new Map()
    if (lastPrizeProductIds.length > 0) {
      const { data: products } = await (supabaseServer
        .from('products') as any)
        .select('id, name, item_code, cost')
        .in('id', lastPrizeProductIds)

      if (products) {
        lastPrizeProductMap = new Map(
          (products as any[]).map((p: any) => [p.id, p])
        )
      }
    }

    // 查詢已確認銷售的實際營收（已反映組合價/開套優惠後的實收價，而非原價推估）
    const kujiIds = (data as any[])?.map((k: any) => k.id) || []
    const actualRevenueMap = new Map<string, number>()
    if (kujiIds.length > 0) {
      const { data: kujiSaleItems } = await (supabaseServer
        .from('sale_items') as any)
        .select(`
          ichiban_kuji_id,
          price,
          quantity,
          sales!inner (
            status
          )
        `)
        .in('ichiban_kuji_id', kujiIds)
        .eq('sales.status', 'confirmed')

      if (kujiSaleItems) {
        for (const item of kujiSaleItems as any[]) {
          const prev = actualRevenueMap.get(item.ichiban_kuji_id) || 0
          actualRevenueMap.set(item.ichiban_kuji_id, prev + (item.price || 0) * (item.quantity || 0))
        }
      }
    }

    // 將 last_prize_product 及實際營收附加到每筆資料
    const enrichedData = (data as any[])?.map((kuji: any) => ({
      ...kuji,
      last_prize_product: kuji.last_prize_product_id
        ? lastPrizeProductMap.get(kuji.last_prize_product_id) || null
        : null,
      actual_revenue: actualRevenueMap.get(kuji.id) || 0,
    })) || []

    return NextResponse.json({
      ok: true,
      data: enrichedData,
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize)
      }
    })
  } catch (error) {
    console.error('[GET /api/ichiban-kuji] Error:', error)
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}

// POST /api/ichiban-kuji - Create new ichiban kuji
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate input
    const validation = ichibanKujiDraftSchema.safeParse(body)
    if (!validation.success) {
      const error = fromZodError(validation.error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      )
    }

    // 建立流程抽在 lib/ichiban-kuji-service.ts，「開新套」共用同一份
    const result = await createIchibanKuji(validation.data)

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status }
      )
    }

    return NextResponse.json(
      { ok: true, data: result.data },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
