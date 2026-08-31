import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { productSchema } from '@/lib/schemas'
import { fromZodError } from 'zod-validation-error'
import { generateCode } from '@/lib/utils'
import { getCurrentUser } from '@/lib/auth'
import { ilikeAny } from '@/lib/postgrest'

// GET /api/products - Search products
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const keyword = searchParams.get('keyword') || ''
    const active = searchParams.get('active')
    const all = searchParams.get('all') === 'true' // New parameter to get all products
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = Math.min(parseInt(searchParams.get('pageSize') || '20'), 1000)
    const sortBy = searchParams.get('sortBy') || 'updated_at'
    const sortOrder = searchParams.get('sortOrder') || 'desc'

    let query = supabaseServer
      .from('products')
      .select('*, product_barcodes(barcode)', { count: 'exact' })

    // Filter by active status
    if (active !== null) {
      query = query.eq('is_active', active === 'true')
    }

    // Search by keyword (name, item_code, or barcode)
    if (keyword) {
      query = query.or(ilikeAny(['name', 'item_code', 'barcode'], keyword))
    }

    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder === 'asc' })

    // Apply pagination (unless all=true)
    if (!all) {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1
      query = query.range(from, to)
    } else {
      // Supabase 預設限制 1000 筆，需要明確設置更大的 limit
      query = query.limit(10000)
    }

    const { data, error, count } = await query

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      data: data || [],
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize)
      }
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}

// POST /api/products - Create new product (admin only)
export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ ok: false, error: '無權限' }, { status: 403 })
  }

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
        { ok: false, error: '商品編號已存在' },
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
          { ok: false, error: '條碼已存在' },
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
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
