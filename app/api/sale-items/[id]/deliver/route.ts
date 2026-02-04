import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

type RouteContext = {
  params: Promise<{ id: string }>
}

// POST /api/sale-items/:id/deliver - 确认出货单个商品明细
export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id: saleItemId } = await context.params

    // 1. 获取sale_item信息
    const { data: saleItem, error: fetchError } = await (supabaseServer
      .from('sale_items') as any)
      .select(`
        *,
        sales!inner (
          id,
          sale_no,
          customer_code,
          sale_date
        )
      `)
      .eq('id', saleItemId)
      .single()

    if (fetchError || !saleItem) {
      return NextResponse.json(
        { ok: false, error: '商品明細不存在' },
        { status: 404 }
      )
    }

    // 2. 检查是否已经创建过delivery
    const { data: existingDeliveries } = await (supabaseServer
      .from('deliveries') as any)
      .select(`
        id,
        status,
        delivery_items!inner (
          sale_item_id
        )
      `)
      .eq('delivery_items.sale_item_id', saleItemId)

    // 检查是否已有confirmed的delivery
    const hasConfirmedDelivery = existingDeliveries?.some(
      (d: any) => d.status === 'confirmed'
    )

    if (hasConfirmedDelivery) {
      return NextResponse.json(
        { ok: false, error: '此商品已確認出貨' },
        { status: 400 }
      )
    }

    // 檢查是否已轉購物金
    const storeCreditQty = saleItem.store_credit_qty || 0
    if (storeCreditQty >= saleItem.quantity) {
      return NextResponse.json(
        { ok: false, error: '此商品已全部轉為購物金，無法出貨' },
        { status: 400 }
      )
    }

    // 3. 生成delivery_no
    const { data: lastDeliveryArray } = await supabaseServer
      .from('deliveries')
      .select('delivery_no')
      .order('created_at', { ascending: false })
      .limit(1)

    let nextNumber = 1
    if (lastDeliveryArray && lastDeliveryArray.length > 0) {
      const lastDelivery = lastDeliveryArray[0] as { delivery_no: string }
      const match = lastDelivery.delivery_no.match(/\d+/)
      if (match) {
        nextNumber = parseInt(match[0], 10) + 1
      }
    }

    const deliveryNo = `D${String(nextNumber).padStart(4, '0')}`

    // 4. 创建delivery记录（直接设为confirmed状态）
    const { data: delivery, error: deliveryError } = await (supabaseServer
      .from('deliveries') as any)
      .insert({
        delivery_no: deliveryNo,
        sale_id: saleItem.sales.id,
        delivery_date: new Date().toISOString().split('T')[0],
        status: 'confirmed',
        note: `單品出貨 - ${saleItem.snapshot_name}`
      })
      .select()
      .single()

    if (deliveryError) {
      return NextResponse.json(
        { ok: false, error: deliveryError.message },
        { status: 500 }
      )
    }

    // 5. 创建delivery_item记录
    const { error: itemError } = await (supabaseServer
      .from('delivery_items') as any)
      .insert({
        delivery_id: delivery.id,
        sale_item_id: saleItem.id,
        product_id: saleItem.product_id,
        quantity: saleItem.quantity
      })

    if (itemError) {
      // 回滚：删除delivery
      await (supabaseServer.from('deliveries') as any).delete().eq('id', delivery.id)
      return NextResponse.json(
        { ok: false, error: itemError.message },
        { status: 500 }
      )
    }

    // 6. 寫入庫存日誌（trigger 會自動扣除庫存）
    const { error: logError } = await (supabaseServer
      .from('inventory_logs') as any)
      .insert({
        product_id: saleItem.product_id,
        ref_type: 'delivery',
        ref_id: delivery.id,
        qty_change: -saleItem.quantity,
        memo: `出貨 - ${deliveryNo} (${saleItem.snapshot_name})`
      })

    if (logError) {
      // 回滾：刪除 delivery 和 delivery_item
      await (supabaseServer.from('deliveries') as any).delete().eq('id', delivery.id)
      return NextResponse.json(
        { ok: false, error: '扣除庫存失敗：' + logError.message },
        { status: 500 }
      )
    }

    // 7. 更新sale的fulfillment_status（考慮出貨和購物金轉換）
    const { data: allSaleItems } = await (supabaseServer
      .from('sale_items') as any)
      .select('id, quantity, store_credit_qty')
      .eq('sale_id', saleItem.sales.id)

    const allItemIds = allSaleItems?.map((item: any) => item.id) || []

    // 查询所有confirmed的delivery_items
    const { data: confirmedDeliveryItems } = await (supabaseServer
      .from('delivery_items') as any)
      .select(`
        sale_item_id,
        quantity,
        deliveries!inner (
          status
        )
      `)
      .in('sale_item_id', allItemIds)
      .eq('deliveries.status', 'confirmed')

    const deliveredQuantityMap = new Map<string, number>()
    confirmedDeliveryItems?.forEach((di: any) => {
      const currentQty = deliveredQuantityMap.get(di.sale_item_id) || 0
      deliveredQuantityMap.set(di.sale_item_id, currentQty + di.quantity)
    })

    let fullyResolvedCount = 0
    let partiallyResolvedCount = 0

    for (const si of (allSaleItems || [])) {
      const deliveredQty = deliveredQuantityMap.get(si.id) || 0
      const scQty = si.store_credit_qty || 0
      const resolvedQty = deliveredQty + scQty

      if (resolvedQty >= si.quantity) {
        fullyResolvedCount++
      } else if (resolvedQty > 0) {
        partiallyResolvedCount++
      }
    }

    let newFulfillmentStatus = 'none'
    if (fullyResolvedCount === allItemIds.length) {
      newFulfillmentStatus = 'completed'
    } else if (fullyResolvedCount > 0 || partiallyResolvedCount > 0) {
      newFulfillmentStatus = 'partial'
    }

    await (supabaseServer
      .from('sales') as any)
      .update({ fulfillment_status: newFulfillmentStatus })
      .eq('id', saleItem.sales.id)

    return NextResponse.json({
      ok: true,
      data: {
        delivery,
        fulfillment_status: newFulfillmentStatus
      }
    })
  } catch (err) {
    console.error('Deliver sale item error:', err)
    return NextResponse.json(
      { ok: false, error: '確認出貨失敗' },
      { status: 500 }
    )
  }
}
