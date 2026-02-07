import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

type RouteContext = {
  params: Promise<{ id: string }>
}

// GET /api/deliveries/:id - 獲取出貨單詳情
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params

    const { data: delivery, error } = await (supabaseServer
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
          products (
            name,
            item_code,
            unit,
            stock
          )
        )
      `)
      .eq('id', id)
      .single()

    if (error) {
      return NextResponse.json(
        { ok: false, error: '找不到出貨單' },
        { status: 404 }
      )
    }

    return NextResponse.json({ ok: true, data: delivery })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}

// DELETE /api/deliveries/:id - 刪除出貨單
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params

    // 獲取出貨單資訊
    const { data: delivery, error: fetchError } = await (supabaseServer
      .from('deliveries') as any)
      .select('status, sale_id, delivery_items(product_id, quantity)')
      .eq('id', id)
      .single()

    if (fetchError || !delivery) {
      return NextResponse.json(
        { ok: false, error: '出貨單不存在' },
        { status: 404 }
      )
    }

    // 如果已確認，需要回補庫存
    if (delivery.status === 'confirmed') {
      // 檢查是否有庫存記錄
      const { data: logs } = await (supabaseServer
        .from('inventory_logs') as any)
        .select('product_id, qty_change')
        .eq('ref_type', 'delivery')
        .eq('ref_id', id)

      if (logs && logs.length > 0) {
        // 回補庫存
        for (const log of logs) {
          const { data: product } = await (supabaseServer
            .from('products') as any)
            .select('stock')
            .eq('id', log.product_id)
            .single()

          if (product) {
            await (supabaseServer
              .from('products') as any)
              .update({ stock: product.stock - log.qty_change }) // qty_change 是負數，所以用減法
              .eq('id', log.product_id)
          }
        }

        // 刪除庫存記錄
        await (supabaseServer
          .from('inventory_logs') as any)
          .delete()
          .eq('ref_type', 'delivery')
          .eq('ref_id', id)
      }

      // 更新 sales 的履約狀態（檢查是否還有其他已確認的出貨單）
      const { data: otherDeliveries } = await (supabaseServer
        .from('deliveries') as any)
        .select('id, status')
        .eq('sale_id', delivery.sale_id)
        .neq('id', id) // 排除當前正在刪除的出貨單

      const hasOtherConfirmedDeliveries = otherDeliveries?.some(
        (d: any) => d.status === 'confirmed'
      )

      // 如果還有其他已確認的出貨單，保持 fulfillment_status 不變
      // 否則設定為 'none'（因為沒有任何已確認的出貨）
      if (!hasOtherConfirmedDeliveries) {
        await (supabaseServer
          .from('sales') as any)
          .update({ fulfillment_status: 'none' })
          .eq('id', delivery.sale_id)
      } else {
        // 還有其他已確認的出貨單，需要重新計算 fulfillment_status
        // 這裡可以添加更精確的計算邏輯（partial vs completed）
        // 暫時保持原狀態不變
        console.log(`[Delete Delivery ${id}] Sale ${delivery.sale_id} still has other confirmed deliveries`)
      }
    }

    // 刪除出貨明細（cascade）
    await (supabaseServer
      .from('delivery_items') as any)
      .delete()
      .eq('delivery_id', id)

    // 刪除出貨單
    const { error: deleteError } = await (supabaseServer
      .from('deliveries') as any)
      .delete()
      .eq('id', id)

    if (deleteError) {
      return NextResponse.json(
        { ok: false, error: deleteError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      message: delivery.status === 'confirmed' ? '出貨單已刪除，庫存已回補' : '出貨單已刪除',
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
