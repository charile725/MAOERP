import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { z } from 'zod'
import { fromZodError } from 'zod-validation-error'

const adjustStockSchema = z.object({
  adjusted_stock: z.number().int().min(0, 'Adjusted stock cannot be negative'),
  note: z.string().optional().nullable(),
})

type RouteContext = {
  params: Promise<{ id: string }>
}

// POST /api/products/[id]/adjust-stock - Adjust stock for inventory count
export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params
    const body = await request.json()

    // Validate input
    const validation = adjustStockSchema.safeParse(body)
    if (!validation.success) {
      const error = fromZodError(validation.error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      )
    }

    const { adjusted_stock, note } = validation.data

    // Get current product stock
    const { data: product, error: productError } = await supabaseServer
      .from('products')
      .select('stock, name, item_code')
      .eq('id', id)
      .single()

    if (productError || !product) {
      return NextResponse.json(
        { ok: false, error: '找不到商品' },
        { status: 404 }
      )
    }

    const previous_stock = (product as any).stock as number
    const difference = adjusted_stock - previous_stock

    // Create stock adjustment record
    const { error: adjustmentError } = await (supabaseServer
      .from('stock_adjustments') as any)
      .insert({
        product_id: id,
        previous_stock,
        adjusted_stock,
        difference,
        note: note || null,
      })

    if (adjustmentError) {
      return NextResponse.json(
        { ok: false, error: adjustmentError.message },
        { status: 500 }
      )
    }

    // Update product stock
    const { data: updatedProduct, error: updateError } = await (supabaseServer
      .from('products') as any)
      .update({ stock: adjusted_stock })
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      data: {
        product: updatedProduct,
        adjustment: {
          previous_stock,
          adjusted_stock,
          difference,
        },
      },
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
