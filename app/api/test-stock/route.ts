import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// Test endpoint to check stock_adjustments
export async function GET(request: NextRequest) {
  try {
    // Get latest product
    const { data: products } = await (supabaseServer
      .from('products') as any)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)

    if (!products || products.length === 0) {
      return NextResponse.json({ ok: false, error: '找不到商品' })
    }

    const product = products[0]

    // Get stock adjustments for this product
    const { data: adjustments } = await (supabaseServer
      .from('stock_adjustments') as any)
      .select('*')
      .eq('product_id', product.id)
      .order('created_at', { ascending: false })

    return NextResponse.json({
      ok: true,
      product: {
        id: product.id,
        name: product.name,
        stock: product.stock,
        created_at: product.created_at
      },
      adjustments: adjustments || []
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
