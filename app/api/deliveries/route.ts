import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { generateCode } from '@/lib/utils'
import { getMaxDeliveryNumber } from '@/lib/delivery-no'

// GET /api/deliveries - 獲取出貨單列表
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status') // draft / confirmed / cancelled
    const saleId = searchParams.get('sale_id')

    let query = (supabaseServer
      .from('deliveries') as any)
      .select(`
        *,
        sales:sale_id (
          sale_no,
          customer_code,
          total,
          is_paid,
          customers:customer_code (
            customer_name
          )
        ),
        delivery_items (
          id,
          product_id,
          quantity,
          products:product_id (
            name,
            item_code,
            unit,
            stock
          )
        )
      `)
      .order('created_at', { ascending: false })

    if (status) {
      query = query.eq('status', status)
    }

    if (saleId) {
      query = query.eq('sale_id', saleId)
    }

    // 批次載入全部出貨單（避免 Supabase 1000 筆上限）
    const BATCH = 1000
    let batchFrom = 0
    const allData: any[] = []
    let fetchError: any = null

    while (true) {
      const { data: batch, error: batchError } = await query.range(batchFrom, batchFrom + BATCH - 1)
      if (batchError) { fetchError = batchError; break }
      if (!batch || batch.length === 0) break
      allData.push(...batch)
      if (batch.length < BATCH) break
      batchFrom += BATCH
    }

    if (fetchError) {
      return NextResponse.json(
        { ok: false, error: fetchError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, data: allData })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}

// POST /api/deliveries - 創建出貨單（用於補單或手動建立）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sale_id, items, method, note, auto_confirm = false } = body

    if (!sale_id || !items || items.length === 0) {
      return NextResponse.json(
        { ok: false, error: '缺少必要參數' },
        { status: 400 }
      )
    }

    // 創建出貨單（含 retry 機制，失敗後重新查詢最大編號）
    let delivery: any = null
    let deliveryError: any = null
    const maxRetries = 10

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // 每次嘗試都重新查詢最大編號
      const currentMax = await getMaxDeliveryNumber()
      const randomOffset = Math.floor(Math.random() * 3)
      const nextNumber = currentMax + 1 + randomOffset
      const deliveryNo = generateCode('D', nextNumber - 1)

      console.log(`[Deliveries API] Attempting delivery_no: ${deliveryNo} (attempt ${attempt + 1}/${maxRetries}, max=${currentMax})`)

      const { data, error } = await (supabaseServer
        .from('deliveries') as any)
        .insert({
          delivery_no: deliveryNo,
          sale_id,
          status: auto_confirm ? 'confirmed' : 'draft',
          delivery_date: auto_confirm ? new Date().toISOString() : null,
          method: method || null,
          note: note || null,
        })
        .select()
        .single()

      if (!error) {
        delivery = data
        break
      }

      deliveryError = error
      console.warn(`[Deliveries API] Insert failed:`, error.code, error.message)

      const isUniqueError = error.code === '23505' ||
        error.message?.includes('duplicate') ||
        error.message?.includes('unique')

      if (!isUniqueError) {
        break
      }

      const delay = 50 + Math.floor(Math.random() * 100)
      await new Promise(resolve => setTimeout(resolve, delay))
    }

    if (!delivery) {
      return NextResponse.json(
        { ok: false, error: deliveryError?.message || '無法生成唯一的出貨單號，請重試' },
        { status: 500 }
      )
    }

    // 創建出貨明細
    const deliveryItems = items.map((item: any) => ({
      delivery_id: delivery.id,
      product_id: item.product_id,
      quantity: item.quantity,
    }))

    const { error: itemsError } = await (supabaseServer
      .from('delivery_items') as any)
      .insert(deliveryItems)

    if (itemsError) {
      // Rollback
      await (supabaseServer.from('deliveries') as any).delete().eq('id', delivery.id)
      return NextResponse.json(
        { ok: false, error: itemsError.message },
        { status: 500 }
      )
    }

    // 如果是自動確認，執行扣庫存邏輯
    if (auto_confirm) {
      // 冪等保護：檢查是否已經扣過庫存
      const { data: existingLogs } = await (supabaseServer
        .from('inventory_logs') as any)
        .select('id')
        .eq('ref_type', 'delivery')
        .eq('ref_id', delivery.id)
        .limit(1)

      if (!existingLogs || existingLogs.length === 0) {
        // 寫入庫存日誌（trigger 會自動更新 products.stock）
        // 官方套一番賞賞品沒有對應商品（product_id 為 null），跳過
        for (const item of items) {
          if (!item.product_id) continue
          await (supabaseServer
            .from('inventory_logs') as any)
            .insert({
              product_id: item.product_id,
              ref_type: 'delivery',
              ref_id: delivery.id,
              qty_change: -item.quantity,
              memo: `出貨扣庫存 - ${delivery.delivery_no}`,
            })
        }

        // 更新 sales 的履約狀態
        await (supabaseServer
          .from('sales') as any)
          .update({ fulfillment_status: 'completed' })
          .eq('id', sale_id)
      }
    }

    return NextResponse.json(
      { ok: true, data: delivery },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
