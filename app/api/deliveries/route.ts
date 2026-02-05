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

    // 生成出貨單號
    const { count } = await supabaseServer
      .from('deliveries')
      .select('*', { count: 'exact', head: true })

    const deliveryNo = generateCode('D', count || 0)

    // 創建出貨單
    const { data: delivery, error: deliveryError } = await (supabaseServer
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

    if (deliveryError) {
      return NextResponse.json(
        { ok: false, error: deliveryError.message },
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
              memo: `出貨扣庫存 - ${deliveryNo}`,
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
