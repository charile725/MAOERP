import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { purchaseDraftSchema } from '@/lib/schemas'
import { fromZodError } from 'zod-validation-error'
import { generateCode } from '@/lib/utils'

// GET /api/purchases - List purchases with items summary
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const dateFrom = searchParams.get('date_from')
    const dateTo = searchParams.get('date_to')
    const vendorCode = searchParams.get('vendor_code')
    const keyword = searchParams.get('keyword')
    const productKeyword = searchParams.get('product_keyword')
    const status = searchParams.get('status')

    let query = (supabaseServer
      .from('purchases') as any)
      .select(`
        *,
        vendors (
          vendor_name
        ),
        purchase_items (
          *,
          products (
            name,
            item_code,
            unit
          )
        )
      `)
      .order('created_at', { ascending: false })

    if (dateFrom) {
      query = query.gte('purchase_date', dateFrom)
    }

    if (dateTo) {
      query = query.lte('purchase_date', dateTo)
    }

    if (vendorCode) {
      query = query.eq('vendor_code', vendorCode)
    }

    // keyword filtering moved to post-query for vendor_name support

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    // Filter by keyword (purchase_no, vendor_code, vendor_name)
    let filteredData = data
    if (keyword) {
      const kw = keyword.toLowerCase()
      filteredData = filteredData?.filter((purchase: any) =>
        purchase.purchase_no?.toLowerCase().includes(kw) ||
        purchase.vendor_code?.toLowerCase().includes(kw) ||
        purchase.vendors?.vendor_name?.toLowerCase().includes(kw)
      )
    }

    // Filter by product if needed
    if (productKeyword) {
      filteredData = filteredData?.filter((purchase: any) => {
        const items = purchase.purchase_items || []
        return items.some((item: any) =>
          item.products?.name?.toLowerCase().includes(productKeyword.toLowerCase()) ||
          item.products?.item_code?.toLowerCase().includes(productKeyword.toLowerCase())
        )
      })
    }

    // Calculate summary for each purchase
    const purchasesWithSummary = filteredData?.map((purchase: any) => {
      const items = purchase.purchase_items || []
      const totalQuantity = items.reduce((sum: number, item: any) => sum + item.quantity, 0)
      const avgCost = items.length > 0
        ? items.reduce((sum: number, item: any) => sum + item.cost, 0) / items.length
        : 0

      return {
        ...purchase,
        item_count: items.length,
        total_quantity: totalQuantity,
        avg_cost: avgCost,
        purchase_items: items // Keep items for detailed view
      }
    })

    return NextResponse.json({ ok: true, data: purchasesWithSummary })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/purchases - Create purchase
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate input
    const validation = purchaseDraftSchema.safeParse(body)
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
        { ok: false, error: `Vendor not found: ${draft.vendor_code}` },
        { status: 400 }
      )
    }

    // Generate purchase_no with retry logic
    let purchase: any = null
    let purchaseError: any = null
    let attempts = 0
    const maxAttempts = 5

    while (attempts < maxAttempts) {
      attempts++

      // Get latest purchase_no to determine next number
      // Order by purchase_no DESC to find the highest number (since they're zero-padded)
      const { data: lastPurchase, error: fetchError } = await supabaseServer
        .from('purchases')
        .select('purchase_no')
        .order('purchase_no', { ascending: false })
        .limit(1)
        .maybeSingle()

      let nextNum = 1
      if (lastPurchase && (lastPurchase as any).purchase_no) {
        // Extract number from P0001 format
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
      console.log(`[Purchase] Attempting to create purchase with number: ${purchaseNo} (attempt ${attempts}/${maxAttempts})`)

      // 1. Create purchase (draft)
      const result = await (supabaseServer
        .from('purchases') as any)
        .insert({
          purchase_no: purchaseNo,
          vendor_code: draft.vendor_code,
          is_paid: draft.is_paid,
          note: draft.note || null,
          status: 'draft',
          total: 0,
        })
        .select()
        .single()

      if (result.error) {
        // Check for unique violation (Postgres error 23505)
        if (result.error.code === '23505' && result.error.message.includes('purchases_purchase_no_key')) {
          console.warn(`[Purchase] Purchase number collision: ${purchaseNo}. Retrying (${attempts}/${maxAttempts})...`)
          continue // Retry loop will fetch new latest ID and try again
        }

        purchaseError = result.error
        console.error(`[Purchase] Insert failed:`, result.error)
        break
      }

      purchase = result.data
      console.log(`[Purchase] Successfully created purchase: ${purchaseNo}`)
      break
    }

    if (!purchase || purchaseError) {
      return NextResponse.json(
        { ok: false, error: purchaseError?.message || 'Failed to generate unique purchase number after retries' },
        { status: 500 }
      )
    }

    // 2. Insert purchase items (subtotal 由資料庫自動計算)
    const purchaseItems = draft.items.map((item) => ({
      purchase_id: purchase.id,
      product_id: item.product_id,
      quantity: item.quantity,
      cost: item.cost,
    }))

    const { data: insertedItems, error: itemsError } = await (supabaseServer
      .from('purchase_items') as any)
      .insert(purchaseItems)
      .select()

    // 2.5 如果前端有傳入自訂小計，更新 subtotal（覆蓋資料庫計算的值）
    if (insertedItems && !itemsError) {
      for (let i = 0; i < draft.items.length; i++) {
        const draftItem = draft.items[i]
        const insertedItem = insertedItems[i]
        if (draftItem.subtotal !== undefined && insertedItem) {
          await (supabaseServer
            .from('purchase_items') as any)
            .update({ subtotal: draftItem.subtotal })
            .eq('id', insertedItem.id)
        }
      }
    }

    if (itemsError) {
      // Rollback: delete the purchase
      await (supabaseServer.from('purchases') as any).delete().eq('id', purchase.id)
      return NextResponse.json(
        { ok: false, error: itemsError.message },
        { status: 500 }
      )
    }

    // 3. Calculate total（使用傳入的小計）
    const total = draft.items.reduce((sum, item) => sum + (item.subtotal || (item.quantity * item.cost)), 0)

    // 4. Update purchase to approved (老板创建的进货单直接审核通过，不需要审核)
    // 库存不在这里增加，等收货时再增加
    const { data: confirmedPurchase, error: confirmError } = await (supabaseServer
      .from('purchases') as any)
      .update({
        total,
        status: 'approved', // 老板创建的进货单直接审核通过
      })
      .eq('id', purchase.id)
      .select()
      .single()

    if (confirmError) {
      return NextResponse.json(
        { ok: false, error: confirmError.message },
        { status: 500 }
      )
    }

    // 6. Create accounts payable for each item (if not paid)
    if (!draft.is_paid && insertedItems) {
      const apRecords = insertedItems.map((item: any) => ({
        partner_type: 'vendor',
        partner_code: draft.vendor_code,
        direction: 'AP',
        ref_type: 'purchase',
        ref_id: purchase.id,
        purchase_item_id: item.id,
        amount: item.subtotal,
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
    }

    return NextResponse.json(
      { ok: true, data: confirmedPurchase },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
