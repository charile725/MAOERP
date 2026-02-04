import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { productSchema } from '@/lib/schemas'
import { fromZodError } from 'zod-validation-error'
import { generateCode } from '@/lib/utils'

// GET /api/products - Search products
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const keyword = searchParams.get('keyword') || ''
    const active = searchParams.get('active')
    const all = searchParams.get('all') === 'true' // New parameter to get all products
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = 50
    const sortBy = searchParams.get('sortBy') || 'updated_at'
    const sortOrder = searchParams.get('sortOrder') || 'desc'

    let query = supabaseServer
      .from('products')
      .select('*', { count: 'exact' })

    // Filter by active status
    if (active !== null) {
      query = query.eq('is_active', active === 'true')
    }

    // Search by keyword (name, item_code, or barcode)
    if (keyword) {
      query = query.or(`name.ilike.%${keyword}%,item_code.ilike.%${keyword}%,barcode.ilike.%${keyword}%`)
    }

    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder === 'asc' })

    // Apply pagination (unless all=true)
    if (!all) {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1
      query = query.range(from, to)
    }

    const { data, error, count } = await query

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    // 查詢待出貨數量：複用 shortage-stats 的邏輯
    let pendingMap: Record<string, number> = {}

    // 1. 從 sales 出發，取得已確認銷售及其品項
    const { data: confirmedSales } = await (supabaseServer
      .from('sales') as any)
      .select(`
        id,
        sale_items (
          id,
          product_id,
          quantity,
          store_credit_qty
        )
      `)
      .eq('status', 'confirmed')

    if (confirmedSales && confirmedSales.length > 0) {
      // 2. 收集所有 sale_item_ids
      const allSaleItems: any[] = []
      const allSaleItemIds: string[] = []
      for (const sale of confirmedSales as any[]) {
        for (const si of (sale.sale_items || [])) {
          allSaleItems.push(si)
          allSaleItemIds.push(si.id)
        }
      }

      // 3. 批次查詢已確認出貨數量
      const deliveredMap: Record<string, number> = {}
      const BATCH_SIZE = 50
      for (let i = 0; i < allSaleItemIds.length; i += BATCH_SIZE) {
        const batchIds = allSaleItemIds.slice(i, i + BATCH_SIZE)
        const { data: deliveryItems } = await (supabaseServer
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

        if (deliveryItems) {
          for (const di of deliveryItems as any[]) {
            deliveredMap[di.sale_item_id] = (deliveredMap[di.sale_item_id] || 0) + Number(di.quantity)
          }
        }
      }

      // 4. 計算每個商品的待出貨數量
      for (const si of allSaleItems) {
        const deliveredQty = deliveredMap[si.id] || 0
        const storeCreditQty = si.store_credit_qty || 0
        const pendingQty = si.quantity - deliveredQty - storeCreditQty
        if (pendingQty > 0) {
          pendingMap[si.product_id] = (pendingMap[si.product_id] || 0) + pendingQty
        }
      }
    }

    // 合併待出貨數量到商品資料
    const enrichedData = (data || []).map((product: any) => ({
      ...product,
      pending_delivery: pendingMap[product.id] || 0,
    }))

    return NextResponse.json({
      ok: true,
      data: enrichedData,
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize)
      }
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/products - Create new product
export async function POST(request: NextRequest) {
  const requestId = Math.random().toString(36).substring(7)
  console.log(`[${requestId}] === POST /api/products START ===`)

  try {
    const body = await request.json()
    console.log(`[${requestId}] Request body:`, body)

    // Validate input
    const validation = productSchema.safeParse(body)
    if (!validation.success) {
      const error = fromZodError(validation.error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      )
    }

    const data = validation.data

    // Generate item_code if not provided
    if (!data.item_code) {
      // Find the maximum existing item_code number to avoid conflicts with manually inserted data
      const { data: products } = await (supabaseServer
        .from('products') as any)
        .select('item_code')
        .like('item_code', 'I%')
        .order('item_code', { ascending: false })
        .limit(1)

      let maxNumber = 0
      if (products && products.length > 0) {
        const lastCode = products[0].item_code
        // Extract number from format I0001, I0002, etc.
        const match = lastCode.match(/^I(\d+)$/)
        if (match) {
          maxNumber = parseInt(match[1])
        }
      }

      // generateCode adds 1 internally, so pass maxNumber directly
      data.item_code = generateCode('I', maxNumber)
    }

    // Check if item_code already exists
    const { data: existing } = await supabaseServer
      .from('products')
      .select('id')
      .eq('item_code', data.item_code)
      .single()

    if (existing) {
      return NextResponse.json(
        { ok: false, error: 'Item code already exists' },
        { status: 400 }
      )
    }

    // Check if barcode already exists (if provided)
    if (data.barcode) {
      const { data: existingBarcode } = await supabaseServer
        .from('products')
        .select('id')
        .eq('barcode', data.barcode)
        .single()

      if (existingBarcode) {
        return NextResponse.json(
          { ok: false, error: 'Barcode already exists' },
          { status: 400 }
        )
      }
    }

    // Insert product
    // If initial stock is provided, set avg_cost to cost value
    const insertData = {
      ...data,
      avg_cost: data.stock > 0 ? data.cost : 0,
    }

    console.log(`[${requestId}] Inserting with stock:`, insertData.stock)

    const { data: product, error } = await (supabaseServer
      .from('products') as any)
      .insert(insertData)
      .select()
      .single()

    if (error) {
      console.log(`[${requestId}] Insert error:`, error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    console.log(`[${requestId}] Insert returned stock:`, product?.stock)
    console.log(`[${requestId}] === POST /api/products END ===`)

    return NextResponse.json({ ok: true, data: product }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
