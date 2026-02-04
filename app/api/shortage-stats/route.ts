import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// GET /api/shortage-stats - 獲取欠貨統計
export async function GET(request: NextRequest) {
  try {
    // 1. 獲取所有 active 銷售明細
    const { data: sales, error: salesError } = await (supabaseServer
      .from('sales') as any)
      .select(`
        id,
        sale_no,
        customer_code,
        customers:customer_code (
          customer_name
        ),
        sale_items (
          id,
          product_id,
          quantity,
          store_credit_qty,
          snapshot_name,
          products (
            item_code,
            name,
            unit,
            stock
          )
        )
      `)
      .eq('status', 'active')

    if (salesError) {
      console.error('[Shortage Stats API] Sales query error:', salesError)
      return NextResponse.json(
        { ok: false, error: salesError.message },
        { status: 500 }
      )
    }

    // 2. 獲取所有 sale_item_ids
    const allSaleItemIds = sales?.flatMap((sale: any) =>
      sale.sale_items?.map((item: any) => item.id) || []
    ) || []

    // 3. 查詢已確認出貨的數量（跟 sales API 一樣的邏輯）
    const deliveryQuantityMap: { [key: string]: number } = {}

    if (allSaleItemIds.length > 0) {
      const BATCH_SIZE = 50
      for (let i = 0; i < allSaleItemIds.length; i += BATCH_SIZE) {
        const batchIds = allSaleItemIds.slice(i, i + BATCH_SIZE)
        const { data: deliveryItems, error: diError } = await (supabaseServer
          .from('delivery_items') as any)
          .select(`
            sale_item_id,
            quantity,
            deliveries!inner (
              status
            )
          `)
          .in('sale_item_id', batchIds)
          .eq('deliveries.status', 'confirmed')

        if (!diError && deliveryItems) {
          deliveryItems.forEach((di: any) => {
            const currentQty = deliveryQuantityMap[di.sale_item_id] || 0
            deliveryQuantityMap[di.sale_item_id] = currentQty + di.quantity
          })
        }
      }
    }

    // 4. 計算每個商品的欠貨狀態
    type CustomerOwed = {
      customerCode: string | null
      customerName: string
      saleNo: string
      quantity: number
      pendingQuantity: number
    }

    type ProductShortage = {
      productId: string
      itemCode: string
      name: string
      unit: string
      stock: number
      totalPending: number
      shortage: number
      customers: CustomerOwed[]
    }

    const productMap = new Map<string, ProductShortage>()

    sales?.forEach((sale: any) => {
      const customerName = sale.customers?.customer_name || sale.customer_code || '散客'

      sale.sale_items?.forEach((item: any) => {
        if (!item.products) return

        const deliveredQty = deliveryQuantityMap[item.id] || 0
        const storeCreditQty = item.store_credit_qty || 0
        const pendingQty = item.quantity - deliveredQty - storeCreditQty

        // 只處理有未出貨數量的
        if (pendingQty <= 0) return

        const productId = item.product_id
        const existing = productMap.get(productId)

        if (existing) {
          existing.totalPending += pendingQty
          existing.shortage = Math.max(0, existing.totalPending - existing.stock)
          existing.customers.push({
            customerCode: sale.customer_code,
            customerName,
            saleNo: sale.sale_no,
            quantity: item.quantity,
            pendingQuantity: pendingQty
          })
        } else {
          const stock = item.products.stock ?? 0
          productMap.set(productId, {
            productId,
            itemCode: item.products.item_code,
            name: item.products.name || item.snapshot_name,
            unit: item.products.unit,
            stock,
            totalPending: pendingQty,
            shortage: Math.max(0, pendingQty - stock),
            customers: [{
              customerCode: sale.customer_code,
              customerName,
              saleNo: sale.sale_no,
              quantity: item.quantity,
              pendingQuantity: pendingQty
            }]
          })
        }
      })
    })

    // 5. 轉換為陣列並排序（欠貨數量大的在前）
    const shortageStats = Array.from(productMap.values())
      .sort((a, b) => b.shortage - a.shortage)

    // 6. 計算總統計
    const summary = {
      totalProducts: shortageStats.length,
      shortageProducts: shortageStats.filter(p => p.shortage > 0).length,
      totalPendingQty: shortageStats.reduce((sum, p) => sum + p.totalPending, 0),
      totalShortageQty: shortageStats.reduce((sum, p) => sum + p.shortage, 0)
    }

    return NextResponse.json({
      ok: true,
      data: shortageStats,
      summary
    })
  } catch (error) {
    console.error('[Shortage Stats API] Error:', error)
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
