import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { ichibanKujiDraftSchema } from '@/lib/schemas'
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

    const draft = validation.data
    const isOfficial = draft.set_type === 'official'

    // 官方套必須選擇廠商
    if (isOfficial && !draft.vendor_code) {
      return NextResponse.json(
        { ok: false, error: '官方套必須選擇廠商' },
        { status: 400 }
      )
    }

    // Calculate total draws and average cost
    let totalDraws = 0
    let totalCost = 0
    let lastPrizeCost = 0

    if (isOfficial) {
      // 官方套：成本來自使用者輸入
      totalDraws = draft.prizes.reduce((sum, p) => sum + p.quantity, 0)
      totalCost = draft.total_cost || 0
      // 官方套的最後賞成本已包含在 total_cost 中，不需額外計算
    } else {
      // 自製套：成本從各商品計算
      // 蒐集所有 product IDs（含複選獎選項）
      const productIds = draft.prizes.map(p => p.product_id).filter(Boolean) as string[]
      for (const prize of draft.prizes) {
        if (prize.selection_product_ids && prize.selection_product_ids.length > 0) {
          productIds.push(...prize.selection_product_ids)
        }
      }

      // 加入最後賞商品ID（如果有）
      if (draft.last_prize_product_id) {
        productIds.push(draft.last_prize_product_id)
      }

      const uniqueProductIds = [...new Set(productIds)]
      const { data: products } = await (supabaseServer
        .from('products') as any)
        .select('id, cost')
        .in('id', uniqueProductIds)

      const productCostMap = new Map(
        (products as any[])?.map(p => [p.id, p.cost]) || []
      )

      for (const prize of draft.prizes) {
        if (prize.selection_product_ids && prize.selection_product_ids.length > 0) {
          // 複選獎：平均選項成本 × 數量
          const optionCosts = prize.selection_product_ids.map(pid => productCostMap.get(pid) || 0)
          const avgOptionCost = optionCosts.reduce((a, b) => a + b, 0) / optionCosts.length
          totalDraws += prize.quantity
          totalCost += avgOptionCost * prize.quantity
        } else {
          // 普通獎
          const cost = productCostMap.get(prize.product_id) || 0
          totalDraws += prize.quantity
          totalCost += cost * prize.quantity
        }
      }

      // 加入最後賞成本（不計入抽數）
      if (draft.last_prize_product_id) {
        lastPrizeCost = productCostMap.get(draft.last_prize_product_id) || 0
        totalCost += lastPrizeCost
      }
    }

    const avgCost = totalDraws > 0 ? totalCost / totalDraws : 0

    // Create ichiban kuji
    const insertData: any = {
      name: draft.name,
      barcode: draft.barcode || null,
      price: draft.price,
      total_draws: totalDraws,
      avg_cost: avgCost,
      set_type: draft.set_type || 'custom',
      total_cost: totalCost,
      combo_prices: draft.combo_prices || [],
      opening_combo_prices: draft.opening_combo_prices || [],
      // 最後賞
      last_prize_name: draft.last_prize_name || null,
      last_prize_product_id: isOfficial ? null : (draft.last_prize_product_id || null),
    }

    // 官方套：設定廠商、未啟用（沒有收貨流程，建立時就當作已到貨）
    if (isOfficial) {
      insertData.vendor_code = draft.vendor_code
      insertData.is_received = true
      insertData.is_active = false
    }

    const { data: kuji, error: kujiError } = await (supabaseServer
      .from('ichiban_kuji') as any)
      .insert(insertData)
      .select()
      .single()

    if (kujiError) {
      return NextResponse.json(
        { ok: false, error: kujiError.message },
        { status: 500 }
      )
    }

    // Insert prizes
    const prizeInserts = draft.prizes.map(prize => {
      const isSelection = !isOfficial && prize.selection_product_ids && prize.selection_product_ids.length > 0
      return {
        kuji_id: kuji.id,
        prize_tier: prize.prize_tier,
        prize_name: prize.prize_name || null,
        product_id: isOfficial ? null : (isSelection ? null : prize.product_id),
        quantity: prize.quantity,
        remaining: prize.quantity,
      }
    })

    const { data: insertedPrizes, error: prizesError } = await (supabaseServer
      .from('ichiban_kuji_prizes') as any)
      .insert(prizeInserts)
      .select('id, prize_tier')

    if (prizesError) {
      // Rollback: delete the kuji
      await (supabaseServer.from('ichiban_kuji') as any).delete().eq('id', kuji.id)
      return NextResponse.json(
        { ok: false, error: prizesError.message },
        { status: 500 }
      )
    }

    // Insert prize options for selection prizes
    const optionInserts: any[] = []
    for (let i = 0; i < draft.prizes.length; i++) {
      const prize = draft.prizes[i]
      if (!isOfficial && prize.selection_product_ids && prize.selection_product_ids.length > 0) {
        const insertedPrize = insertedPrizes[i]
        for (const productId of prize.selection_product_ids) {
          optionInserts.push({
            prize_id: insertedPrize.id,
            product_id: productId,
          })
        }
      }
    }

    if (optionInserts.length > 0) {
      const { error: optionsError } = await (supabaseServer
        .from('ichiban_kuji_prize_options') as any)
        .insert(optionInserts)

      if (optionsError) {
        // Rollback
        await (supabaseServer.from('ichiban_kuji_prizes') as any).delete().eq('kuji_id', kuji.id)
        await (supabaseServer.from('ichiban_kuji') as any).delete().eq('id', kuji.id)
        return NextResponse.json(
          { ok: false, error: optionsError.message },
          { status: 500 }
        )
      }
    }

    // 進貨一律不建應付帳款，帳務由老板自己管

    return NextResponse.json(
      { ok: true, data: kuji },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
