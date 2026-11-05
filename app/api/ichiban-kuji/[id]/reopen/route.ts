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
 *
 * 括號是選擇性的：手動開的套常常直接打成「戰鬥陀螺 第2套」，
 * 不認這種寫法的話下一套會變成「戰鬥陀螺 第2套 (第2套)」。
 */
function nextSetName(sourceName: string, existingNames: string[]): string {
  const SUFFIX = /\s*[（(]?\s*第\s*(\d+)\s*套\s*[)）]?\s*$/
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
 * 自製套與官方套都支援，但成本的來源不一樣：
 *   - 自製套：賞項對應真實商品，成本由 service 依「目前的商品成本」重算。
 *   - 官方套：賞項只有名稱（product_id 一律 null），沒有東西可以算，
 *     成本一向是人工輸入的 → 沿用舊套的 total_cost，可用 body.total_cost 覆寫。
 *
 * Body:
 *   name?: string        — 選填，不給就自動接「(第N套)」
 *   total_cost?: number  — 選填，只有官方套會用到；不給就沿用舊套成本
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const customName: string | null =
      typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : null
    const costOverride: number | null =
      typeof body?.total_cost === 'number' && Number.isFinite(body.total_cost) && body.total_cost >= 0
        ? body.total_cost
        : null

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

    const isOfficial = kuji.set_type === 'official'

    // 官方套一定要有廠商，createIchibanKuji 會擋，先給句看得懂的話
    if (isOfficial && !kuji.vendor_code) {
      return NextResponse.json(
        { ok: false, error: '這套官方賞沒有廠商資料，請先到編輯頁補上廠商再開新套' },
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
      set_type: isOfficial ? 'official' : 'custom',
      // 自製套的成本由 service 依當下商品成本重算；官方套沒得算，沿用舊套（或呼叫方指定）
      total_cost: isOfficial ? (costOverride ?? (kuji.total_cost || 0)) : 0,
      vendor_code: isOfficial ? kuji.vendor_code : null,
      prizes: sortedPrizes.map((p) => {
        // 官方套的賞項只有名稱，沒有對應商品，也沒有複選獎
        if (isOfficial) {
          return {
            prize_tier: p.prize_tier,
            prize_name: p.prize_name || null,
            product_id: null,
            quantity: p.quantity,
            selection_product_ids: null,
          }
        }
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

    // createIchibanKuji 走的是「官方套進貨建立」的規則，會把官方套存成未啟用
    // （進貨當下還沒要賣）。但開新套的用意就是接著賣，而且收銀台只載入啟用中的套組，
    // 不啟用的話掃同一個條碼還是會落在賣完的舊套上 —— 所以這裡補一次啟用，
    // 讓官方套開新套的結果跟自製套一致。
    let warning: string | null = null
    if (isOfficial) {
      const { error: activateError } = await (supabaseServer
        .from('ichiban_kuji') as any)
        .update({ is_active: true })
        .eq('id', result.data.id)

      if (activateError) {
        console.error('[reopen] 新官方套啟用失敗:', activateError)
        warning = `新套已建立，但自動啟用失敗（${activateError.message}），請到一番賞庫手動啟用`
      } else {
        result.data.is_active = true
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        kuji: result.data,
        source_kuji_id: id,
        source_kuji_name: kuji.name,
        source_still_active: kuji.is_active === true,
        set_type: kuji.set_type,
        new_name: newName,
        total_draws: result.data.total_draws,
        total_cost: result.data.total_cost,
      },
      ...(warning ? { warning } : {}),
    })
  } catch (error: any) {
    console.error('[reopen] Error:', error)
    return NextResponse.json({ ok: false, error: '系統錯誤' }, { status: 500 })
  }
}
