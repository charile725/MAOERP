import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

type RouteContext = {
  params: Promise<{ id: string }>
}

// PATCH /api/deliveries/:id/confirm - 確認出貨（從 route.ts 移過來的專用端點）
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params

    // 獲取出貨單資訊
    const { data: delivery, error: fetchError } = await (supabaseServer
      .from('deliveries') as any)
      .select(`
        *,
        delivery_items (
          product_id,
          quantity
        )
      `)
      .eq('id', id)
      .single()

    if (fetchError || !delivery) {
      return NextResponse.json(
        { ok: false, error: '出貨單不存在' },
        { status: 404 }
      )
    }

    if (delivery.status === 'confirmed') {
      return NextResponse.json(
        { ok: false, error: '此出貨單已確認，無需重複操作' },
        { status: 400 }
      )
    }

    if (delivery.status === 'cancelled') {
      return NextResponse.json(
        { ok: false, error: '已取消的出貨單無法確認' },
        { status: 400 }
      )
    }

    // 🔒 冪等保護：檢查是否已經扣過庫存
    const { data: existingLogs } = await (supabaseServer
      .from('inventory_logs') as any)
      .select('id')
      .eq('ref_type', 'delivery')
      .eq('ref_id', id)
      .limit(1)

    if (existingLogs && existingLogs.length > 0) {
      return NextResponse.json(
        { ok: false, error: '此出貨單已扣過庫存，無法重複扣減' },
        { status: 400 }
      )
    }

    // 檢查庫存是否足夠（批次查詢優化）
    const productIds = delivery.delivery_items.map((item: any) => item.product_id)
    const { data: products } = await (supabaseServer
      .from('products') as any)
      .select('id, stock, allow_negative, name')
      .in('id', productIds)

    const productMap = new Map((products || []).map((p: any) => [p.id, p]))

    for (const item of delivery.delivery_items) {
      const product = productMap.get(item.product_id)

      if (!product) {
        return NextResponse.json(
          { ok: false, error: `商品不存在：${item.product_id}` },
          { status: 404 }
        )
      }

      // 不再檢查庫存，支援負庫存出貨
      // if (!product.allow_negative && product.stock < item.quantity) { ... }
    }

    // 扣庫存：批次寫入 inventory_logs（trigger 會自動更新 products.stock）
    const inventoryLogs = delivery.delivery_items.map((item: any) => ({
      product_id: item.product_id,
      ref_type: 'delivery',
      ref_id: id,
      qty_change: -item.quantity,
      memo: `出貨扣庫存 - ${delivery.delivery_no}`,
    }))

    await (supabaseServer
      .from('inventory_logs') as any)
      .insert(inventoryLogs)

    // 更新出貨單狀態
    const { data: confirmedDelivery, error: updateError } = await (supabaseServer
      .from('deliveries') as any)
      .update({
        status: 'confirmed',
        delivery_date: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 }
      )
    }

    // 更新 sales 的履約狀態（根據實際出貨情況判斷）
    const { data: allSaleItems } = await (supabaseServer
      .from('sale_items') as any)
      .select('id, quantity, store_credit_qty')
      .eq('sale_id', delivery.sale_id)

    if (allSaleItems && allSaleItems.length > 0) {
      const allItemIds = allSaleItems.map((item: any) => item.id)

      // 查詢所有已確認出貨的明細
      const { data: confirmedDeliveryItems } = await (supabaseServer
        .from('delivery_items') as any)
        .select(`
          sale_item_id,
          quantity,
          deliveries!inner (status)
        `)
        .in('sale_item_id', allItemIds)
        .eq('deliveries.status', 'confirmed')

      const deliveredQtyMap = new Map<string, number>()
      confirmedDeliveryItems?.forEach((di: any) => {
        const cur = deliveredQtyMap.get(di.sale_item_id) || 0
        deliveredQtyMap.set(di.sale_item_id, cur + di.quantity)
      })

      let fullyResolved = 0
      let partiallyResolved = 0

      for (const item of allSaleItems) {
        const deliveredQty = deliveredQtyMap.get(item.id) || 0
        const scQty = item.store_credit_qty || 0
        const resolvedQty = deliveredQty + scQty

        if (resolvedQty >= item.quantity) {
          fullyResolved++
        } else if (resolvedQty > 0) {
          partiallyResolved++
        }
      }

      let newFulfillmentStatus = 'none'
      if (fullyResolved === allSaleItems.length) {
        newFulfillmentStatus = 'completed'
      } else if (fullyResolved > 0 || partiallyResolved > 0) {
        newFulfillmentStatus = 'partial'
      }

      await (supabaseServer
        .from('sales') as any)
        .update({ fulfillment_status: newFulfillmentStatus })
        .eq('id', delivery.sale_id)
    }

    return NextResponse.json({
      ok: true,
      data: confirmedDelivery,
      message: '出貨確認成功，庫存已扣減',
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
