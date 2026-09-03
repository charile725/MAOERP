import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { createIchibanKuji, type IchibanKujiDraft } from '@/lib/ichiban-kuji-service'

type RouteContext = {
  params: Promise<{ id: string }>
}

/**
 * 依既有名稱推出下一套的名稱：「XX一番賞」→「XX一番賞 (第2套)」。
 *
 * 同名的套組會讓「復活」按名稱找廢套費用時抓錯筆，所以每一套都要有自己的名字。
 */
function nextSetName(sourceName: string, existingNames: string[]): string {
  const SUFFIX = /\s*[（(]\s*第\s*(\d+)\s*套\s*[)）]\s*$/
  const base = sourceName.replace(SUFFIX, '').trim()

  let maxSet = 0
  for (const name of existingNames) {
    const trimmed = (name || '').trim()
    const matched = trimmed.match(SUFFIX)
    const nameBase = trimmed.replace(SUFFIX, '').trim()
    if (nameBase !== base) continue
    // 沒有後綴的視為第 1 套
    maxSet = Math.max(maxSet, matched ? parseInt(matched[1], 10) : 1)
  }

  return `${base} (第${maxSet + 1}套)`
}

/**
 * POST /api/ichiban-kuji/:id/reopen
 *
 * 開新套：以既有一番賞為範本，建立一套全新的（所有賞項 remaining 歸回滿的）。
 * 舊套原封不動保留，銷售紀錄仍指向舊套的賞項，歷史帳不會被動到。
 *
 * Body:
 *   name?: string  — 選填，不給就自動接「(第N套)」
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const customName: string | null =
      typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : null

    // 1. 讀取來源一番賞（含賞項與複選獎選項）
    const { data: kuji, error: kujiError } = await (supabaseServer
      .from('ichiban_kuji') as any)
      .select(`
        *,
        ichiban_kuji_prizes (
          id,
          prize_tier,
          prize_name,
          product_id,
          quantity,
          ichiban_kuji_prize_options (
            id,
            product_id
          )
        )
      `)
      .eq('id', id)
      .single()

    if (kujiError || !kuji) {
      return NextResponse.json({ ok: false, error: '找不到一番賞' }, { status: 404 })
    }

    // 官方套有自己的進貨流程（/purchases/official-kuji），不從這裡複製
    if (kuji.set_type !== 'custom') {
      return NextResponse.json(
        { ok: false, error: '僅自製套可開新套，官方套請走進貨流程' },
        { status: 400 }
      )
    }

    const prizes = (kuji.ichiban_kuji_prizes || []) as any[]
    if (prizes.length === 0) {
      return NextResponse.json(
        { ok: false, error: '此一番賞沒有賞項，無法開新套' },
        { status: 400 }
      )
    }

    // 2. 決定新套名稱
    let newName = customName
    if (!newName) {
      // 表不大，整批取名字在 JS 比對，省去 LIKE 的跳脫問題
      const { data: allKujis } = await (supabaseServer
        .from('ichiban_kuji') as any)
        .select('name')
      newName = nextSetName(kuji.name, (allKujis as any[])?.map(k => k.name) || [])
    }

    // 3. 依來源組出草稿。賞項照 prize_tier 排序，讓新套的順序穩定
    const sortedPrizes = [...prizes].sort((a, b) =>
      String(a.prize_tier).localeCompare(String(b.prize_tier), 'zh-Hant')
    )

    const draft: IchibanKujiDraft = {
      name: newName,
      // 同一個實體商品的條碼；收銀台只載入啟用中的套組且以最新的優先，掃碼會落在新套上
      barcode: kuji.barcode || null,
      price: kuji.price || 0,
      set_type: 'custom',
      total_cost: 0, // 自製套的成本由 service 依當下商品成本重算
      vendor_code: null,
      prizes: sortedPrizes.map((p) => {
        const optionProductIds = (p.ichiban_kuji_prize_options || [])
          .map((o: any) => o.product_id)
          .filter(Boolean)
        return {
          prize_tier: p.prize_tier,
          prize_name: p.prize_name || null,
          product_id: optionProductIds.length > 0 ? null : p.product_id,
          quantity: p.quantity,
          selection_product_ids: optionProductIds.length > 0 ? optionProductIds : null,
        }
      }),
      combo_prices: kuji.combo_prices || [],
      opening_combo_prices: kuji.opening_combo_prices || [],
      last_prize_name: kuji.last_prize_name || null,
      last_prize_product_id: kuji.last_prize_product_id || null,
    }

    // 4. 走跟建立一番賞完全相同的流程（成本重算、賞項、選項、失敗回滾）
    const result = await createIchibanKuji(draft)

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
    }

    return NextResponse.json({
      ok: true,
      data: {
        kuji: result.data,
        source_kuji_id: id,
        source_kuji_name: kuji.name,
        source_still_active: kuji.is_active === true,
        new_name: newName,
        total_draws: result.data.total_draws,
      },
    })
  } catch (error: any) {
    console.error('[reopen] Error:', error)
    return NextResponse.json({ ok: false, error: '系統錯誤' }, { status: 500 })
  }
}
