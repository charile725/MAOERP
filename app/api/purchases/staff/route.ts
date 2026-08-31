import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { z } from 'zod'
import { fromZodError } from 'zod-validation-error'
import { getCurrentUser } from '@/lib/auth'
import { receivePurchaseItems } from '@/lib/purchase-stock'

// Simplified schema for staff purchase submission (quantity only, no cost)
const staffPurchaseSchema = z.object({
  vendor_code: z.string().min(1, 'Vendor is required'),
  note: z.string().optional(),
  items: z.array(
    z.object({
      product_id: z.string().uuid(),
      quantity: z.number().int().positive('Quantity must be positive'),
    })
  ).min(1, 'At least one item is required'),
})

// POST /api/purchases/staff - 員工開進貨單，建單即入庫（沒有審核流程）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Get current user
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { ok: false, error: '無權限' },
        { status: 401 }
      )
    }

    // Validate input
    const validation = staffPurchaseSchema.safeParse(body)
    if (!validation.success) {
      const error = fromZodError(validation.error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      )
    }

    const draft = validation.data

    // Verify vendor exists
    const { data: vendor } = await supabaseServer
      .from('vendors')
      .select('id')
      .eq('vendor_code', draft.vendor_code)
      .single()

    if (!vendor) {
      return NextResponse.json(
        { ok: false, error: `廠商不存在: ${draft.vendor_code}` },
        { status: 400 }
      )
    }

    // Generate purchase_no with retry logic to handle unique constraint violations
    let purchase: any = null
    let purchaseError: any = null
    let attempts = 0
    const maxAttempts = 5

    while (attempts < maxAttempts) {
      attempts++

      // Get latest purchase_no to determine next number
      const { data: lastPurchase } = await supabaseServer
        .from('purchases')
        .select('purchase_no')
        .order('purchase_no', { ascending: false })
        .limit(1)
        .maybeSingle()

      let nextNum = 1
      if (lastPurchase && (lastPurchase as any).purchase_no) {
        const match = (lastPurchase as any).purchase_no.match(/P(\d+)/)
        if (match) {
          nextNum = parseInt(match[1], 10) + 1
        }
      }

      // Add attempt number as additional offset to reduce collision chance on retry
      if (attempts > 1) {
        nextNum += attempts - 1
      }

      const purchaseNo = `P${nextNum.toString().padStart(4, '0')}`

      // Build note with staff info and user note
      const staffNote = `員工進貨 (by ${user.username})`
      const fullNote = draft.note ? `${staffNote} - ${draft.note}` : staffNote

      // 1. Create purchase（沒有審核，建立就是成立）
      const result = await (supabaseServer
        .from('purchases') as any)
        .insert({
          purchase_no: purchaseNo,
          vendor_code: draft.vendor_code,
          is_paid: false,
          note: fullNote,
          status: 'approved',
          total: 0,  // 員工不填成本，金額由老闆之後補
          created_by: user.username,
        })
        .select()
        .single()

      if (result.error) {
        // Check for unique violation (Postgres error 23505)
        if (result.error.code === '23505' && result.error.message.includes('purchases_purchase_no_key')) {
          console.warn(`[Staff Purchase] Purchase number collision: ${purchaseNo}. Retrying (${attempts}/${maxAttempts})...`)
          continue // Retry with new number
        }
        purchaseError = result.error
        break
      }

      purchase = result.data
      break
    }

    if (!purchase || purchaseError) {
      return NextResponse.json(
        { ok: false, error: purchaseError?.message || '無法生成唯一進貨單號，請稍後再試' },
        { status: 500 }
      )
    }

    // 2. Insert purchase items with cost = 0（員工只報數量，成本老闆之後自己補）
    const purchaseItems = draft.items.map((item) => ({
      purchase_id: purchase.id,
      product_id: item.product_id,
      quantity: item.quantity,
      cost: 0,
      subtotal: 0,
    }))

    const { data: insertedItems, error: itemsError } = await (supabaseServer
      .from('purchase_items') as any)
      .insert(purchaseItems)
      .select()

    if (itemsError) {
      // Rollback: delete the purchase
      await (supabaseServer.from('purchases') as any).delete().eq('id', purchase.id)
      return NextResponse.json(
        { ok: false, error: itemsError.message },
        { status: 500 }
      )
    }

    // 3. 建單即入庫，跟老闆開的單一樣（成本 0 不會動到平均成本）
    const { errors: stockErrors } = await receivePurchaseItems(
      purchase.id,
      purchase.purchase_no,
      (insertedItems || []).map((item: any) => ({
        id: item.id,
        product_id: item.product_id,
        quantity: item.quantity,
        cost: item.cost,
      }))
    )

    return NextResponse.json(
      {
        ok: true,
        data: purchase,
        message: `進貨單 ${purchase.purchase_no} 已建立，庫存已更新`,
        warning: stockErrors.length > 0
          ? `進貨單 ${purchase.purchase_no} 已建立，但有品項未入庫：${stockErrors.join('；')}`
          : undefined,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Staff purchase submission error:', error)
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
