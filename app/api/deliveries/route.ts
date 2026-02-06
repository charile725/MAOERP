import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { generateCode } from '@/lib/utils'

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

    const { data, error } = await query

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, data })
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

    // Helper: 取得目前最大的 delivery number
    const getMaxDeliveryNumber = async (): Promise<number> => {
      const { data: allDeliveries } = await (supabaseServer
        .from('deliveries') as any)
        .select('delivery_no')

      let maxNumber = 0
      if (allDeliveries && allDeliveries.length > 0) {
        for (const d of allDeliveries) {
          const match = d.delivery_no?.match(/\d+/)
          if (match) {
            const num = parseInt(match[0], 10)
            if (num > maxNumber) maxNumber = num
          }
        }
      }
      return maxNumber
    }

    // 創建出貨單（含 retry 機制，每次 retry 遞增編號）
    let delivery: any = null
    let deliveryError: any = null
    const maxRetries = 10

    // 先查詢一次最大編號
    let currentNumber = await getMaxDeliveryNumber()
    console.log(`[Deliveries API] Current max delivery number: ${currentNumber}`)

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // 每次嘗試遞增編號
      currentNumber++
      const deliveryNo = generateCode('D', currentNumber - 1)

      console.log(`[Deliveries API] Attempting delivery_no: ${deliveryNo} (attempt ${attempt + 1}/${maxRetries})`)

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

      // 如果是 unique constraint error，繼續 retry（編號已遞增）
      const isUniqueError = error.code === '23505' ||
        error.message?.includes('duplicate') ||
        error.message?.includes('unique')

      if (!isUniqueError) {
        break
      }

      await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)))
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
        // 扣庫存
        for (const item of items) {
          // 更新庫存
          const { data: product } = await (supabaseServer
            .from('products') as any)
            .select('stock')
            .eq('id', item.product_id)
            .single()

          if (product) {
            await (supabaseServer
              .from('products') as any)
              .update({ stock: product.stock - item.quantity })
              .eq('id', item.product_id)
          }

          // 寫入庫存日誌
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
