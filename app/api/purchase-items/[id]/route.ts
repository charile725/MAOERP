import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { getTaiwanTime } from '@/lib/timezone'

type RouteContext = {
  params: Promise<{ id: string }>
}

// DELETE /api/purchase-items/:id - Delete single purchase item and restore inventory
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params

    // 1. Get purchase item details including received_quantity
    const { data: item, error: fetchError } = await (supabaseServer
      .from('purchase_items') as any)
      .select(`
        *,
        purchases!inner(status)
      `)
      .eq('id', id)
      .single()

    if (fetchError || !item) {
      return NextResponse.json(
        { ok: false, error: '找不到進貨明細' },
        { status: 404 }
      )
    }

    // 2. Restore inventory based on actual received quantity
    const receivedQty = item.received_quantity || 0

    if (receivedQty > 0) {
      console.log(`[Delete Purchase Item ${id}] Restoring ${receivedQty} units for product ${item.product_id}`)

      // 寫入負數的庫存日誌來回補庫存（trigger 會自動更新 products.stock）
      await (supabaseServer
        .from('inventory_logs') as any)
        .insert({
          product_id: item.product_id,
          ref_type: 'purchase_item_delete',
          ref_id: id,
          qty_change: -receivedQty,
          memo: `刪除進貨明細回補庫存 - 明細 ID: ${id}`,
        })

      // 更新平均成本
      const { data: product } = await (supabaseServer
        .from('products') as any)
        .select('stock, avg_cost')
        .eq('id', item.product_id)
        .single()

      if (product) {
        const currentStock = product.stock  // trigger 已經更新過的庫存
        const oldAvgCost = product.avg_cost

        // 計算新的平均成本（移除這次進貨的成本貢獻）
        let newAvgCost = oldAvgCost
        if (currentStock > 0) {
          const oldStock = currentStock + receivedQty
          const totalCostBefore = oldStock * oldAvgCost
          const itemCost = receivedQty * item.cost
          newAvgCost = (totalCostBefore - itemCost) / currentStock

          if (newAvgCost < 0) newAvgCost = 0
        } else {
          newAvgCost = 0
        }

        // 只更新平均成本
        await (supabaseServer
          .from('products') as any)
          .update({ avg_cost: newAvgCost })
          .eq('id', item.product_id)

        console.log(`[Delete Purchase Item ${id}] Restored inventory: stock reduced by ${receivedQty}, avg_cost: ${oldAvgCost.toFixed(2)} -> ${newAvgCost.toFixed(2)}`)
      }
    } else {
      console.log(`[Delete Purchase Item ${id}] Item has not been received, no inventory to restore`)
    }

    // 3. Update purchase total
    const { data: remainingRows } = await (supabaseServer
      .from('purchase_items') as any)
      .select('quantity, cost, subtotal')
      .eq('purchase_id', item.purchase_id)
      .neq('id', id)

    const remainingItems = remainingRows || []

    // 以 subtotal 為準：小計是使用者直接輸入的，跟 quantity * cost 不一定相等
    const newTotal = remainingItems.reduce(
      (sum: number, i: any) => sum + (i.subtotal ?? Math.round(i.quantity * i.cost)),
      0
    )

    await (supabaseServer
      .from('purchases') as any)
      .update({ total: newTotal })
      .eq('id', item.purchase_id)

    // 4. Delete purchase item
    const { error: deleteError } = await (supabaseServer
      .from('purchase_items') as any)
      .delete()
      .eq('id', id)

    if (deleteError) {
      return NextResponse.json(
        { ok: false, error: deleteError.message },
        { status: 500 }
      )
    }

    // 5. 刪掉最後一個品項就把整張進貨單收掉，不要留下 0 項 $0 的空單
    const purchaseRemoved = remainingItems.length === 0
    if (purchaseRemoved) {
      await (supabaseServer.from('purchases') as any).delete().eq('id', item.purchase_id)
      console.log(`[Delete Purchase Item ${id}] 最後一個品項已刪除，一併移除空的進貨單 ${item.purchase_id}`)
    }

    console.log(`[Delete Purchase Item ${id}] Successfully deleted item and restored inventory`)
    return NextResponse.json({ ok: true, data: { purchase_removed: purchaseRemoved } })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
