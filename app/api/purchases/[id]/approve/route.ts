import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { z } from 'zod'
import { fromZodError } from 'zod-validation-error'
import { receivePurchaseItems } from '@/lib/purchase-stock'

type RouteContext = {
  params: Promise<{ id: string }>
}

// Schema for approving purchase (boss can adjust quantities, costs, add/remove items)
const approvePurchaseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid().optional(), // Existing item ID (if updating)
      product_id: z.string().uuid(),
      quantity: z.number().int().positive('Quantity must be positive'),
      cost: z.number().min(0, 'Cost must be positive'),
      subtotal: z.number().int().optional(), // Optional subtotal (takes priority over quantity * cost)
    })
  ).min(1, 'At least one item is required'),
})

// POST /api/purchases/:id/approve - Boss approves purchase and updates inventory
export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params
    const body = await request.json()

    // Validate input
    const validation = approvePurchaseSchema.safeParse(body)
    if (!validation.success) {
      const error = fromZodError(validation.error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      )
    }

    const { items } = validation.data

    // Get purchase to check status and vendor
    const { data: purchase, error: purchaseError } = await (supabaseServer
      .from('purchases') as any)
      .select('status, vendor_code')
      .eq('id', id)
      .single()

    if (purchaseError || !purchase) {
      return NextResponse.json(
        { ok: false, error: '進貨單不存在' },
        { status: 404 }
      )
    }

    if (purchase.status !== 'pending') {
      return NextResponse.json(
        { ok: false, error: '只能批准待審核的進貨單' },
        { status: 400 }
      )
    }

    // 1. Get existing purchase items
    const { data: existingItems } = await (supabaseServer
      .from('purchase_items') as any)
      .select('id, product_id')
      .eq('purchase_id', id)

    const existingItemIds = new Set((existingItems || []).map((item: any) => item.id))
    const updatedItemIds = new Set(items.filter(item => item.id).map(item => item.id))

    // 2. Delete items that were removed by boss
    const itemsToDelete = (existingItems || [])
      .filter((item: any) => !updatedItemIds.has(item.id))
      .map((item: any) => item.id)

    if (itemsToDelete.length > 0) {
      await (supabaseServer
        .from('purchase_items') as any)
        .delete()
        .in('id', itemsToDelete)
    }

    // 3. Update existing items or insert new items
    // subtotal 一定要寫：purchases.total 是資料庫 trigger 從各品項 subtotal 加總出來的，
    // 少寫這欄的話品項留在 null，批准後整張單的金額會變成 0。
    const updatePromises = items.map(async (item) => {
      const subtotal = item.subtotal !== undefined ? item.subtotal : Math.round(item.quantity * item.cost)

      if (item.id && existingItemIds.has(item.id)) {
        // Update existing item
        return await (supabaseServer
          .from('purchase_items') as any)
          .update({
            quantity: item.quantity,
            cost: item.cost,
            subtotal,
          })
          .eq('id', item.id)
          .select()
          .single()
      } else {
        // Insert new item
        return await (supabaseServer
          .from('purchase_items') as any)
          .insert({
            purchase_id: id,
            product_id: item.product_id,
            quantity: item.quantity,
            cost: item.cost,
            subtotal,
          })
          .select()
          .single()
      }
    })

    const results = await Promise.all(updatePromises)
    const updatedItems = results.map(result => result.data)

    // Check for errors
    const hasError = results.some(result => result.error)
    if (hasError) {
      return NextResponse.json(
        { ok: false, error: '更新進貨明細時發生錯誤' },
        { status: 500 }
      )
    }

    // 4. Calculate total（使用 subtotal 小計，避免小數點問題）
    const total = items.reduce((sum, item) => sum + (item.subtotal || Math.round(item.quantity * item.cost)), 0)

    // 取得進貨單號
    const { data: purchaseData } = await (supabaseServer
      .from('purchases') as any)
      .select('purchase_no')
      .eq('id', id)
      .single()
    const purchaseNo = purchaseData?.purchase_no || id

    // 5. Update purchase to confirmed
    const { data: confirmedPurchase, error: confirmError } = await (supabaseServer
      .from('purchases') as any)
      .update({
        total,
        status: 'confirmed',
      })
      .eq('id', id)
      .select()
      .single()

    if (confirmError) {
      return NextResponse.json(
        { ok: false, error: confirmError.message },
        { status: 500 }
      )
    }

    // 6. 進貨直接連動庫存：批准當下就入庫並重算平均成本，沒有另外的收貨步驟
    const { errors: stockErrors } = await receivePurchaseItems(
      id,
      purchaseNo,
      updatedItems.map((item: any) => ({
        id: item.id,
        product_id: item.product_id,
        quantity: item.quantity,
        cost: item.cost,
      }))
    )

    // 進貨不再產生應付帳款，付款與否只靠進貨單上的「已付款」註記

    return NextResponse.json(
      {
        ok: true,
        data: confirmedPurchase,
        message: stockErrors.length > 0
          ? `進貨單已批准，但有品項未入庫：${stockErrors.join('；')}`
          : '進貨單已批准，庫存已更新'
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Approve purchase error:', error)
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
