import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { ichibanKujiDraftSchema } from '@/lib/schemas'
import { fromZodError } from 'zod-validation-error'

// GET /api/ichiban-kuji - List all ichiban kuji
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const active = searchParams.get('active')
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
          )
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })

    if (active !== null) {
      query = query.eq('is_active', active === 'true')
    }

    // Apply pagination
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1
    query = query.range(from, to)

    const { data, error, count } = await query

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      data,
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize)
      }
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
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

    if (isOfficial) {
      // 官方套：成本來自使用者輸入
      totalDraws = draft.prizes.reduce((sum, p) => sum + p.quantity, 0)
      totalCost = draft.total_cost || 0
    } else {
      // 自製套：成本從各商品計算
      const productIds = draft.prizes.map(p => p.product_id).filter(Boolean) as string[]
      const { data: products } = await (supabaseServer
        .from('products') as any)
        .select('id, cost')
        .in('id', productIds)

      const productCostMap = new Map(
        (products as any[])?.map(p => [p.id, p.cost]) || []
      )

      for (const prize of draft.prizes) {
        const cost = productCostMap.get(prize.product_id) || 0
        totalDraws += prize.quantity
        totalCost += cost * prize.quantity
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
    }

    // 官方套：設定廠商、未收貨、未啟用
    if (isOfficial) {
      insertData.vendor_code = draft.vendor_code
      insertData.is_received = false
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
    const prizeInserts = draft.prizes.map(prize => ({
      kuji_id: kuji.id,
      prize_tier: prize.prize_tier,
      prize_name: prize.prize_name || null,
      product_id: isOfficial ? null : prize.product_id,
      quantity: prize.quantity,
      remaining: prize.quantity, // 初始剩餘數量等於總數量
    }))

    const { error: prizesError } = await (supabaseServer
      .from('ichiban_kuji_prizes') as any)
      .insert(prizeInserts)

    if (prizesError) {
      // Rollback: delete the kuji
      await (supabaseServer.from('ichiban_kuji') as any).delete().eq('id', kuji.id)
      return NextResponse.json(
        { ok: false, error: prizesError.message },
        { status: 500 }
      )
    }

    // 官方套：建立 AP（應付帳款）記錄
    if (isOfficial && draft.vendor_code && totalCost > 0) {
      const { error: apError } = await (supabaseServer
        .from('partner_accounts') as any)
        .insert({
          partner_type: 'vendor',
          partner_code: draft.vendor_code,
          direction: 'AP',
          ref_type: 'ichiban_kuji',
          ref_id: kuji.id,
          amount: totalCost,
          received_paid: 0,
          due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          status: 'unpaid',
        })

      if (apError) {
        console.error('[Ichiban Kuji POST] Failed to create AP record:', apError)
        // AP 建立失敗不阻斷流程，只記錄錯誤
      }
    }

    return NextResponse.json(
      { ok: true, data: kuji },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
