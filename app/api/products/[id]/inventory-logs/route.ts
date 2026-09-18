import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

type RouteContext = {
  params: Promise<{ id: string }>
}

/**
 * GET /api/products/[id]/inventory-logs
 *
 * 單一商品的完整庫存異動（初始庫存、進貨、出貨、調整、回補…），由舊到新。
 * `products.stock` 是由 inventory_logs 的 trigger 維護的，所以這份清單就是庫存數字的來源。
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params

    const { data: product, error: productError } = await (supabaseServer
      .from('products') as any)
      .select('id, item_code, name, unit, stock, cost, avg_cost')
      .eq('id', id)
      .single()

    if (productError || !product) {
      return NextResponse.json({ ok: false, error: '找不到商品' }, { status: 404 })
    }

    // 一定要分頁抓：PostgREST 單次最多回傳 1000 筆，`.limit()` 也蓋不過伺服器端的上限。
    // 共用的「沒中獎小賞」這種商品光是出貨就有上千筆，只抓第一頁會讓累計少一大截，
    // 畫面就會誤報「庫存跟異動對不起來」。
    const PAGE = 1000
    const MAX_LOGS = 20000
    const logs: any[] = []
    let truncated = false
    for (let from = 0; ; from += PAGE) {
      const { data: page, error: logsError } = await (supabaseServer
        .from('inventory_logs') as any)
        .select('id, ref_type, ref_id, qty_change, unit_cost, memo, created_at')
        .eq('product_id', id)
        .order('created_at', { ascending: true })
        .range(from, from + PAGE - 1)

      if (logsError || !page) {
        return NextResponse.json(
          { ok: false, error: `讀取庫存異動失敗：${logsError?.message || '沒有回傳資料'}` },
          { status: 500 }
        )
      }

      logs.push(...page)
      if (page.length < PAGE) break
      if (logs.length >= MAX_LOGS) { truncated = true; break }
    }

    // 摘要：初始庫存、進貨、出貨、調整各自的合計
    const summary = { init: 0, purchase: 0, delivery: 0, adjustment: 0, other: 0 }
    for (const log of logs) {
      const qty = Number(log.qty_change) || 0
      const type = String(log.ref_type || '')
      if (type === 'init') summary.init += qty
      else if (type.startsWith('purchase')) summary.purchase += qty
      else if (type.startsWith('delivery')) summary.delivery += qty
      else if (type === 'adjustment') summary.adjustment += qty
      else summary.other += qty
    }

    const logged = logs.reduce((sum, l) => sum + (Number(l.qty_change) || 0), 0)

    return NextResponse.json({
      ok: true,
      data: {
        product,
        logs,
        summary,
        logged_total: logged,
        truncated,
        // 正常情況下兩者必定相等；不相等代表有人繞過 inventory_logs 直接改了 stock。
        // 筆數被截斷時累計本來就不完整，不做這個判斷免得誤報。
        matches_stock: truncated ? null : logged === Number(product.stock),
      },
    })
  } catch (error) {
    return NextResponse.json({ ok: false, error: '系統錯誤' }, { status: 500 })
  }
}
