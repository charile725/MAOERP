import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { generateCode } from '@/lib/utils'

type RouteContext = {
  params: Promise<{ id: string }>
}

// POST /api/purchase-items/:id/receive - 收货指定品项
export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params
    const body = await request.json()
    const { quantity } = body

    if (!quantity || quantity <= 0) {
      return NextResponse.json(
        { ok: false, error: '收貨數量必須大於 0' },
        { status: 400 }
      )
    }

    // 1. 获取 purchase_item 信息
    const { data: purchaseItem, error: itemError } = await (supabaseServer
      .from('purchase_items') as any)
      .select('*')
      .eq('id', id)
      .single()

    if (itemError || !purchaseItem) {
      return NextResponse.json(
        { ok: false, error: '找不到进货明细' },
        { status: 404 }
      )
    }

    // 2. 检查收货数量是否超过进货数量
    // 安全地获取已收货数量（如果字段不存在，默认为0）
    const receivedQuantity = purchaseItem.received_quantity || 0
    const remainingQuantity = purchaseItem.quantity - receivedQuantity

    if (quantity > remainingQuantity) {
      return NextResponse.json(
        {
          ok: false,
          error: `收貨數量不能超過剩餘數量。剩餘: ${remainingQuantity}, 嘗試收貨: ${quantity}`
        },
        { status: 400 }
      )
    }

    // 3. 获取进货单信息
    const { data: purchase } = await (supabaseServer
      .from('purchases') as any)
      .select('purchase_no')
      .eq('id', purchaseItem.purchase_id)
      .single()

    // 4. 更新 purchase_item 的 received_quantity（如果字段存在）
    const updatedReceivedQty = receivedQuantity + quantity
    const fullyReceived = updatedReceivedQty >= purchaseItem.quantity

    // 尝试更新收货字段
    try {
      const { error: updateItemError } = await (supabaseServer
        .from('purchase_items') as any)
        .update({
          received_quantity: updatedReceivedQty,
          is_received: fullyReceived,
        })
        .eq('id', id)

      if (updateItemError) {
        console.error('Failed to update purchase_item (fields may not exist):', updateItemError.message)
        // 不抛出错误，继续执行，因为字段可能不存在
      }
    } catch (err) {
      console.error('Error updating purchase_item:', err)
      // 字段可能不存在，继续执行
    }

    // 5. 寫入庫存日誌（trigger 會自動更新 products.stock）
    const { error: logError } = await (supabaseServer
      .from('inventory_logs') as any)
      .insert({
        product_id: purchaseItem.product_id,
        ref_type: 'purchase',
        ref_id: purchaseItem.purchase_id,
        qty_change: quantity,
        memo: `收貨 - 進貨單: ${purchase?.purchase_no} (收貨數量: ${quantity})`,
      })

    if (logError) {
      console.error('Failed to create inventory log:', logError)
      return NextResponse.json(
        { ok: false, error: '庫存更新失敗：' + logError.message },
        { status: 500 }
      )
    }

    // 6. 更新商品平均成本
    const { data: product } = await (supabaseServer
      .from('products') as any)
      .select('stock, avg_cost')
      .eq('id', purchaseItem.product_id)
      .single()

    if (product) {
      const currentStock = product.stock  // trigger 已經更新過的庫存
      const oldAvgCost = product.avg_cost

      // 使用加權平均計算新的平均成本
      let newAvgCost = oldAvgCost
      if (currentStock > 0) {
        const oldStock = currentStock - quantity
        newAvgCost = ((oldStock * oldAvgCost) + (quantity * purchaseItem.cost)) / currentStock
      }

      // 只更新平均成本
      const { error: updateCostError } = await (supabaseServer
        .from('products') as any)
        .update({ avg_cost: newAvgCost })
        .eq('id', purchaseItem.product_id)

      if (updateCostError) {
        console.error('Failed to update product avg_cost:', updateCostError)
      } else {
        console.log(`[Receive] Updated avg_cost for product ${purchaseItem.product_id}: ${oldAvgCost.toFixed(2)} -> ${newAvgCost.toFixed(2)}`)
      }
    }

    return NextResponse.json(
      {
        ok: true,
        data: {
          purchase_item_id: id,
          quantity,
          received_quantity: updatedReceivedQty,
          is_received: fullyReceived
        },
        message: `收貨成功！已收貨 ${updatedReceivedQty}/${purchaseItem.quantity}`
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Receive purchase item error:', error)
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
