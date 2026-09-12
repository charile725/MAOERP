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

    // 用庫存日誌調整，不直接寫 products.stock
    //
    // 直接 UPDATE stock 的話，products.stock 會跟 inventory_logs 的累計永遠對不起來
    // （盤點調整不留異動軌跡），之後查「這個商品的庫存怎麼變成這樣」就斷線了。
    // 改成寫一筆 ref_type='adjustment' 的日誌，由 DB trigger 去更新 stock：
    // 差額為 0 就不用寫（盤點結果跟現有庫存一樣）。
    if (difference !== 0) {
      const { error: logError } = await (supabaseServer
        .from('inventory_logs') as any)
        .insert({
          product_id: id,
          ref_type: 'adjustment',
          ref_id: null,
          qty_change: difference,
          memo: note
            ? `盤點調整 ${previous_stock} → ${adjusted_stock}（${note}）`
            : `盤點調整 ${previous_stock} → ${adjusted_stock}`,
        })

      if (logError) {
        // 日誌寫不進去就別留下 stock_adjustments 的孤兒紀錄
        await (supabaseServer.from('stock_adjustments') as any)
          .delete()
          .eq('product_id', id)
          .eq('previous_stock', previous_stock)
          .eq('adjusted_stock', adjusted_stock)
        return NextResponse.json(
          { ok: false, error: `庫存調整失敗：${logError.message}` },
          { status: 500 }
        )
      }
    }

    // 讀回 trigger 更新後的結果
    const { data: updatedProduct, error: updateError } = await (supabaseServer
      .from('products') as any)
      .select()
      .eq('id', id)
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
