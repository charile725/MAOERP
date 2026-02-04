import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// POST /api/sale-items/[id]/undo-deliver - 撤銷出貨
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: saleItemId } = await params
    const body = await request.json()
    const { quantity } = body // 要撤銷的數量

    if (!quantity || quantity <= 0) {
      return NextResponse.json(
        { ok: false, error: '請提供有效的撤銷數量' },
        { status: 400 }
      )
    }

    // 1. 獲取 sale_item 信息
    const { data: saleItem, error: siError } = await (supabaseServer
      .from('sale_items') as any)
      .select(`
        *,
        sales!inner (
          id,
          sale_no
        ),
        products (
          id,
          item_code,
          name,
          stock
        )
      `)
      .eq('id', saleItemId)
      .single()

    if (siError || !saleItem) {
      return NextResponse.json(
        { ok: false, error: '找不到指定的商品明細' },
        { status: 404 }
      )
    }

    // 2. 獲取該 sale_item 的所有出貨記錄
    const { data: allDeliveryItems, error: diError } = await (supabaseServer
      .from('delivery_items') as any)
      .select(`
        id,
        quantity,
        delivery_id,
        deliveries (
          id,
          delivery_no,
          status
        )
      `)
      .eq('sale_item_id', saleItemId)

    if (diError) {
      console.error('Query delivery_items error:', diError)
      return NextResponse.json(
        { ok: false, error: '查詢出貨記錄失敗: ' + diError.message },
        { status: 500 }
      )
    }

    // 過濾只保留已確認的出貨記錄
    const deliveryItems = (allDeliveryItems || []).filter(
      (di: any) => di.deliveries?.status === 'confirmed'
    )

    // 計算已出貨總量
    const totalDelivered = deliveryItems?.reduce((sum: number, di: any) => sum + di.quantity, 0) || 0

    if (totalDelivered === 0) {
      return NextResponse.json(
        { ok: false, error: '此商品沒有出貨記錄可以撤銷' },
        { status: 400 }
      )
    }

    if (quantity > totalDelivered) {
      return NextResponse.json(
        { ok: false, error: `撤銷數量 (${quantity}) 超過已出貨數量 (${totalDelivered})` },
        { status: 400 }
      )
    }

    // 3. 從最新的出貨記錄開始撤銷
    let remainingToUndo = quantity
    const undoneDeliveries: string[] = []

    for (const di of deliveryItems || []) {
      if (remainingToUndo <= 0) break

      const undoQty = Math.min(di.quantity, remainingToUndo)

      if (undoQty === di.quantity) {
        // 整筆刪除
        await (supabaseServer
          .from('delivery_items') as any)
          .delete()
          .eq('id', di.id)
      } else {
        // 部分撤銷，更新數量
        await (supabaseServer
          .from('delivery_items') as any)
          .update({ quantity: di.quantity - undoQty })
          .eq('id', di.id)
      }

      // 寫入庫存日誌並更新庫存 - 只有有 product_id 的商品才需要
      if (saleItem.product_id) {
        // 取得目前庫存
        const { data: product } = await (supabaseServer
          .from('products') as any)
          .select('stock')
          .eq('id', saleItem.product_id)
          .single()

        const currentStock = product?.stock || 0
        const newStock = currentStock + undoQty

        // 直接更新庫存
        const { error: stockError } = await (supabaseServer
          .from('products') as any)
          .update({ stock: newStock })
          .eq('id', saleItem.product_id)

        if (stockError) {
          console.error('Failed to update stock:', stockError)
        }

        // 寫入庫存日誌
        const { error: logError } = await (supabaseServer
          .from('inventory_logs') as any)
          .insert({
            product_id: saleItem.product_id,
            ref_type: 'undo_delivery',
            ref_id: di.delivery_id,
            qty_change: undoQty,
            memo: `撤銷出貨 - ${di.deliveries?.delivery_no || 'N/A'} (${saleItem.snapshot_name} x${undoQty})`
          })

        if (logError) {
          console.error('Failed to insert inventory log:', logError)
        }
      }

      undoneDeliveries.push(di.deliveries.delivery_no)
      remainingToUndo -= undoQty

      // 檢查該出貨單是否還有其他明細
      const { data: remainingItems } = await (supabaseServer
        .from('delivery_items') as any)
        .select('id')
        .eq('delivery_id', di.delivery_id)

      if (!remainingItems || remainingItems.length === 0) {
        // 該出貨單沒有其他明細了，刪除出貨單
        await (supabaseServer
          .from('deliveries') as any)
          .delete()
          .eq('id', di.delivery_id)
      }
    }

    // 4. 重新計算 sale 的 fulfillment_status
    const saleId = saleItem.sales.id

    const { data: allSaleItems } = await (supabaseServer
      .from('sale_items') as any)
      .select('id, quantity')
      .eq('sale_id', saleId)

    const allItemIds = allSaleItems?.map((item: any) => item.id) || []
    const orderedQuantityMap = new Map<string, number>(
      allSaleItems?.map((item: any) => [item.id, item.quantity]) || []
    )

    const { data: allConfirmedDeliveryItems } = await (supabaseServer
      .from('delivery_items') as any)
      .select(`
        sale_item_id,
        quantity,
        deliveries (
          status
        )
      `)
      .in('sale_item_id', allItemIds)

    const deliveredQuantityMap = new Map<string, number>()
    allConfirmedDeliveryItems?.forEach((di: any) => {
      // 只計算已確認的出貨
      if (di.deliveries?.status !== 'confirmed') return
      const currentQty = deliveredQuantityMap.get(di.sale_item_id) || 0
      deliveredQuantityMap.set(di.sale_item_id, currentQty + di.quantity)
    })

    let fullyDeliveredCount = 0
    let partiallyDeliveredCount = 0

    for (const itemId of allItemIds) {
      const orderedQty = orderedQuantityMap.get(itemId) || 0
      const deliveredQty = deliveredQuantityMap.get(itemId) || 0

      if (deliveredQty >= orderedQty) {
        fullyDeliveredCount++
      } else if (deliveredQty > 0) {
        partiallyDeliveredCount++
      }
    }

    let newFulfillmentStatus = 'none'
    if (fullyDeliveredCount === allItemIds.length) {
      newFulfillmentStatus = 'completed'
    } else if (fullyDeliveredCount > 0 || partiallyDeliveredCount > 0) {
      newFulfillmentStatus = 'partial'
    }

    await (supabaseServer
      .from('sales') as any)
      .update({ fulfillment_status: newFulfillmentStatus })
      .eq('id', saleId)

    return NextResponse.json({
      ok: true,
      data: {
        undone_quantity: quantity,
        product_name: saleItem.products.name,
        sale_no: saleItem.sales.sale_no,
        affected_deliveries: [...new Set(undoneDeliveries)]
      },
      message: `成功撤銷出貨 ${quantity} ${saleItem.products.name}，庫存已補回`
    })
  } catch (err) {
    console.error('Undo deliver error:', err)
    return NextResponse.json(
      { ok: false, error: '撤銷出貨失敗' },
      { status: 500 }
    )
  }
}
