import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { z } from 'zod'
import { fromZodError } from 'zod-validation-error'

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

// POST /api/purchases/:id/approve - Boss approves purchase and updates inventory & AP
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
    const updatePromises = items.map(async (item) => {
      if (item.id && existingItemIds.has(item.id)) {
        // Update existing item
        return await (supabaseServer
          .from('purchase_items') as any)
          .update({
            quantity: item.quantity,
            cost: item.cost,
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

    // 5. 批准時不更新庫存！庫存只在收貨時更新，避免重複進貨
    // 庫存更新在 /api/purchase-items/:id/receive 處理
    console.log(`[Approve] Purchase ${purchaseNo} approved. Inventory will be updated upon receiving.`)

    // 6. Update purchase to confirmed
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

    // 7. Create accounts payable for each item (since not paid)
    const apRecords = updatedItems.map((item: any) => ({
      partner_type: 'vendor',
      partner_code: purchase.vendor_code,
      direction: 'AP',
      ref_type: 'purchase',
      ref_id: id,
      purchase_item_id: item.id,
      amount: item.subtotal || Math.round(item.quantity * item.cost),
      received_paid: 0,
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days from now
      status: 'unpaid',
    }))

    const { error: apError } = await (supabaseServer
      .from('partner_accounts') as any)
      .insert(apRecords)

    if (apError) {
      console.error('Failed to create AP records:', apError)
      // Don't fail the whole transaction, just log the error
    }

    return NextResponse.json(
      {
        ok: true,
        data: confirmedPurchase,
        message: '進貨單已批准，應付帳款已建立。請於收貨時更新庫存。'
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Approve purchase error:', error)
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
