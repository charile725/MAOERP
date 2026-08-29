import { supabaseServer } from './supabase/server'

/**
 * 進貨即入庫
 *
 * 進貨單一建立（或員工申請被批准）就直接把數量加進庫存，沒有獨立的收貨步驟。
 * 庫存靠寫 inventory_logs，資料庫 trigger 會自動更新 products.stock，
 * 所以這裡讀回來的 stock 已經是加完的值，往回減才是進貨前的庫存。
 */

export type ReceivableItem = {
  id: string
  product_id: string
  quantity: number
  cost: number
}

export type ReceiveResult = {
  /** 每個失敗品項一則訊息；空陣列代表全部入庫成功 */
  errors: string[]
}

export async function receivePurchaseItems(
  purchaseId: string,
  purchaseNo: string,
  items: ReceivableItem[]
): Promise<ReceiveResult> {
  const errors: string[] = []

  // 逐筆處理：平均成本要用「上一筆算完的庫存」當基準，不能平行
  for (const item of items) {
    const qty = Number(item.quantity) || 0
    if (qty <= 0) continue

    const { error: logError } = await (supabaseServer
      .from('inventory_logs') as any)
      .insert({
        product_id: item.product_id,
        ref_type: 'purchase',
        ref_id: purchaseId,
        qty_change: qty,
        memo: `進貨入庫 - 進貨單: ${purchaseNo}`,
      })

    if (logError) {
      console.error(`[Purchase ${purchaseNo}] 庫存寫入失敗 product=${item.product_id}:`, logError)
      errors.push(`商品 ${item.product_id}：${logError.message}`)
      continue
    }

    // 庫存已入帳，把品項標成已收貨（刪除進貨單時是照 received_quantity 回補的）
    const { error: itemError } = await (supabaseServer
      .from('purchase_items') as any)
      .update({ received_quantity: qty, is_received: true })
      .eq('id', item.id)

    if (itemError) {
      console.error(`[Purchase ${purchaseNo}] 收貨數量更新失敗 item=${item.id}:`, itemError)
    }

    // 重算加權平均成本
    const { data: product } = await (supabaseServer
      .from('products') as any)
      .select('stock, avg_cost')
      .eq('id', item.product_id)
      .single()

    if (!product) continue

    const currentStock = Number(product.stock) || 0
    const oldStock = currentStock - qty
    const oldAvgCost = Number(product.avg_cost) || 0

    // 進貨前是負庫存或零庫存的話無法加權，直接以本次成本為準
    const newAvgCost = currentStock <= 0 || oldStock <= 0
      ? item.cost
      : ((oldStock * oldAvgCost) + (qty * item.cost)) / currentStock

    const { error: costError } = await (supabaseServer
      .from('products') as any)
      .update({ avg_cost: newAvgCost, cost: newAvgCost })
      .eq('id', item.product_id)

    if (costError) {
      console.error(`[Purchase ${purchaseNo}] 平均成本更新失敗 product=${item.product_id}:`, costError)
    }
  }

  return { errors }
}
