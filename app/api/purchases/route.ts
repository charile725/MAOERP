import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { purchaseDraftSchema } from '@/lib/schemas'
import { fromZodError } from 'zod-validation-error'
import { generateCode } from '@/lib/utils'
import { ilikeAny } from '@/lib/postgrest'
import { receivePurchaseItems } from '@/lib/purchase-stock'

// GET /api/purchases - List purchases with items summary
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const dateFrom = searchParams.get('date_from')
    const dateTo = searchParams.get('date_to')
    const vendorCode = searchParams.get('vendor_code')
    const keyword = searchParams.get('keyword')
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

    // keyword: 全部 server-side 過濾，避免 Supabase 預設 1000 筆上限導致漏資料
    if (keyword) {
      // 1. 查廠商名稱匹配的 vendor_codes
      const { data: matchedVendors } = await (supabaseServer
        .from('vendors') as any)
        .select('vendor_code')
        .ilike('vendor_name', `%${keyword}%`)
      const matchedVendorCodes: string[] = (matchedVendors || []).map((v: any) => v.vendor_code)

      // 2. 查商品名稱/品號匹配的 product_ids
      const { data: matchedProducts } = await (supabaseServer
        .from('products') as any)
        .select('id')
        .or(ilikeAny(['name', 'item_code'], keyword))
      const matchedProductIds: string[] = (matchedProducts || []).map((p: any) => p.id)

      // 3. 用 product_ids 查出對應的 purchase_ids
      let matchedPurchaseIds: string[] = []
      if (matchedProductIds.length > 0) {
        const { data: matchedItems } = await (supabaseServer
          .from('purchase_items') as any)
          .select('purchase_id')
          .in('product_id', matchedProductIds)
        matchedPurchaseIds = [...new Set((matchedItems || []).map((i: any) => i.purchase_id))] as string[]
      }

      // 4. 組合 server-side OR 條件
      const orParts: string[] = [
        ilikeAny(['purchase_no', 'vendor_code'], keyword),
      ]
      if (matchedVendorCodes.length > 0) {
        orParts.push(`vendor_code.in.(${matchedVendorCodes.join(',')})`)
      }
      if (matchedPurchaseIds.length > 0) {
        orParts.push(`id.in.(${matchedPurchaseIds.join(',')})`)
      }
      query = query.or(orParts.join(','))
    }

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

    let filteredData = data

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
      }
    })

    return NextResponse.json({ ok: true, data: purchasesWithSummary })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
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
          is_paid: false,
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

    // 2. Insert purchase items（直接包含 subtotal，避免 trigger 計算小數）
    const purchaseItems = draft.items.map((item) => ({
      purchase_id: purchase.id,
      product_id: item.product_id,
      quantity: item.quantity,
      cost: item.cost,
      subtotal: item.subtotal !== undefined ? item.subtotal : Math.round(item.quantity * item.cost),
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

    // 3. Calculate total（使用傳入的小計）
    const total = draft.items.reduce((sum, item) => sum + (item.subtotal || Math.round(item.quantity * item.cost)), 0)

    // 4. 進貨單沒有審核流程，建立就算成立
    const { data: confirmedPurchase, error: confirmError } = await (supabaseServer
      .from('purchases') as any)
      .update({
        total,
        status: 'approved',
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

    // 5. 進貨直接連動庫存：建立當下就入庫，沒有另外的收貨步驟
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
        data: confirmedPurchase,
        warning: stockErrors.length > 0
          ? `進貨單 ${purchase.purchase_no} 已建立，但有品項未入庫：${stockErrors.join('；')}`
          : undefined,
      },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
