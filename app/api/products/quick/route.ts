import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { generateCode } from '@/lib/utils'
import { z } from 'zod'
import { fromZodError } from 'zod-validation-error'

// Simplified schema for staff quick product creation
const quickProductSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  barcode: z.string().optional().nullable(),
  cost: z.number().min(0).optional(),  // 進貨時可以直接填成本
  price: z.number().min(0).optional(), // 可選填售價
})

// POST /api/products/quick - Quick create product for staff (minimal info)
export async function POST(request: NextRequest) {
  const requestId = Math.random().toString(36).substring(7)
  console.log(`[${requestId}] === POST /api/products/quick START ===`)

  try {
    const body = await request.json()
    console.log(`[${requestId}] Request body:`, body)

    // Validate input
    const validation = quickProductSchema.safeParse(body)
    if (!validation.success) {
      const error = fromZodError(validation.error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      )
    }

    const data = validation.data

    // Generate item_code automatically
    const { data: products } = await (supabaseServer
      .from('products') as any)
      .select('item_code')
      .like('item_code', 'I%')
      .order('item_code', { ascending: false })
      .limit(1)

    let maxNumber = 0
    if (products && products.length > 0) {
      const lastCode = products[0].item_code
      const match = lastCode.match(/^I(\d+)$/)
      if (match) {
        maxNumber = parseInt(match[1])
      }
    }

    const item_code = generateCode('I', maxNumber)

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

    // Insert product with minimal info (cost and price can be filled now or by boss later)
    const insertData = {
      item_code,
      name: data.name,
      barcode: data.barcode || null,
      price: data.price || 0,
      cost: data.cost || 0,
      unit: '件',
      tags: [],
      stock: 0,
      avg_cost: data.cost || 0,  // 初始平均成本等於進貨成本
      allow_negative: true,
      is_active: true,
    }

    console.log(`[${requestId}] Inserting quick product:`, insertData)

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

    console.log(`[${requestId}] Quick product created:`, product)
    console.log(`[${requestId}] === POST /api/products/quick END ===`)

    return NextResponse.json({ ok: true, data: product }, { status: 201 })
  } catch (error) {
    console.error('Quick product creation error:', error)
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
