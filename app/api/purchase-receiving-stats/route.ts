import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// GET /api/purchase-receiving-stats - 獲取未收貨統計
export async function GET(request: NextRequest) {
  try {
    // 1. 查詢所有已確認的進貨單及品項
    const { data: purchases, error: purchasesError } = await (supabaseServer
      .from('purchases') as any)
      .select(`
        *,
        vendors (
          vendor_name
        ),
        purchase_items (
          id,
          quantity,
          cost,
          subtotal,
          received_quantity,
          is_received,
          product_id,
          products (
            item_code,
            name,
            unit,
            stock
          )
        )
      `)
      .in('status', ['approved', 'confirmed'])

    if (purchasesError) {
      console.error('[Purchase Receiving Stats API] Query error:', purchasesError)
      return NextResponse.json(
        { ok: false, error: purchasesError.message },
        { status: 500 }
      )
    }

    if (!purchases || purchases.length === 0) {
      return NextResponse.json({
        ok: true,
        data: [],
        summary: { totalProducts: 0, totalPendingQty: 0, totalPendingAmount: 0 }
      })
    }

    // 2. 計算每個商品的未收貨狀態
    type VendorOwed = {
      vendorCode: string
      vendorName: string
      purchaseNo: string
      purchaseDate: string
      quantity: number
      pendingQuantity: number
      cost: number
    }

    type ProductReceiving = {
      productId: string
      itemCode: string
      name: string
      unit: string
      stock: number
      totalPending: number
      totalPendingAmount: number
      vendors: VendorOwed[]
    }

    const receivingMap = new Map<string, ProductReceiving>()

    purchases.forEach((purchase: any) => {
      const vendorName = purchase.vendors?.vendor_name || purchase.vendor_code

      purchase.purchase_items?.forEach((item: any) => {
        const pendingQty = item.quantity - (item.received_quantity || 0)

        // 只處理有未收貨數量的
        if (pendingQty <= 0) return

        const product = item.products
        if (!product) return

        const itemCost = item.cost || 0
        const pendingAmount = item.subtotal
          ? Math.round(item.subtotal * (pendingQty / item.quantity))
          : Math.round(pendingQty * itemCost)

        const existing = receivingMap.get(item.product_id)

        if (existing) {
          existing.totalPending += pendingQty
          existing.totalPendingAmount += pendingAmount
          existing.vendors.push({
            vendorCode: purchase.vendor_code,
            vendorName,
            purchaseNo: purchase.purchase_no,
            purchaseDate: purchase.purchase_date,
            quantity: item.quantity,
            pendingQuantity: pendingQty,
            cost: itemCost
          })
        } else {
          receivingMap.set(item.product_id, {
            productId: item.product_id,
            itemCode: product.item_code,
            name: product.name,
            unit: product.unit,
            stock: product.stock ?? 0,
            totalPending: pendingQty,
            totalPendingAmount: pendingAmount,
            vendors: [{
              vendorCode: purchase.vendor_code,
              vendorName,
              purchaseNo: purchase.purchase_no,
              purchaseDate: purchase.purchase_date,
              quantity: item.quantity,
              pendingQuantity: pendingQty,
              cost: itemCost
            }]
          })
        }
      })
    })

    // 3. 轉換為陣列並排序（按待收貨數量降序）
    const receivingStats = Array.from(receivingMap.values())
      .sort((a, b) => b.totalPending - a.totalPending)

    // 4. 計算總統計
    const summary = {
      totalProducts: receivingStats.length,
      totalPendingQty: receivingStats.reduce((sum, p) => sum + p.totalPending, 0),
      totalPendingAmount: receivingStats.reduce((sum, p) => sum + p.totalPendingAmount, 0)
    }

    return NextResponse.json({
      ok: true,
      data: receivingStats,
      summary
    })
  } catch (error) {
    console.error('[Purchase Receiving Stats API] Error:', error)
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
