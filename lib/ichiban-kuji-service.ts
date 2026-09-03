import { supabaseServer } from '@/lib/supabase/server'
import { ichibanKujiDraftSchema } from '@/lib/schemas'
import type { z } from 'zod'

export type IchibanKujiDraft = z.infer<typeof ichibanKujiDraftSchema>

export type CreateIchibanKujiResult =
  | { ok: true; data: any }
  | { ok: false; error: string; status: number }

/**
 * 建立一番賞（含賞項與複選獎選項）。
 *
 * 從 POST /api/ichiban-kuji 抽出來，讓「開新套」可以沿用同一套成本計算與
 * 回滾流程，不必再維護第二份 insert 邏輯。
 */
export async function createIchibanKuji(
  draft: IchibanKujiDraft
): Promise<CreateIchibanKujiResult> {
  const isOfficial = draft.set_type === 'official'

  // 官方套必須選擇廠商
  if (isOfficial && !draft.vendor_code) {
    return { ok: false, error: '官方套必須選擇廠商', status: 400 }
  }

  // Calculate total draws and average cost
  let totalDraws = 0
  let totalCost = 0
  let lastPrizeCost = 0

  if (isOfficial) {
    // 官方套：成本來自使用者輸入
    totalDraws = draft.prizes.reduce((sum, p) => sum + p.quantity, 0)
    totalCost = draft.total_cost || 0
    // 官方套的最後賞成本已包含在 total_cost 中，不需額外計算
  } else {
    // 自製套：成本從各商品計算
    // 蒐集所有 product IDs（含複選獎選項）
    const productIds = draft.prizes.map(p => p.product_id).filter(Boolean) as string[]
    for (const prize of draft.prizes) {
      if (prize.selection_product_ids && prize.selection_product_ids.length > 0) {
        productIds.push(...prize.selection_product_ids)
      }
    }

    // 加入最後賞商品ID（如果有）
    if (draft.last_prize_product_id) {
      productIds.push(draft.last_prize_product_id)
    }

    const uniqueProductIds = [...new Set(productIds)]
    const { data: products } = await (supabaseServer
      .from('products') as any)
      .select('id, cost')
      .in('id', uniqueProductIds)

    const productCostMap = new Map(
      (products as any[])?.map(p => [p.id, p.cost]) || []
    )

    for (const prize of draft.prizes) {
      if (prize.selection_product_ids && prize.selection_product_ids.length > 0) {
        // 複選獎：平均選項成本 × 數量
        const optionCosts = prize.selection_product_ids.map(pid => productCostMap.get(pid) || 0)
        const avgOptionCost = optionCosts.reduce((a, b) => a + b, 0) / optionCosts.length
        totalDraws += prize.quantity
        totalCost += avgOptionCost * prize.quantity
      } else {
        // 普通獎
        const cost = productCostMap.get(prize.product_id) || 0
        totalDraws += prize.quantity
        totalCost += cost * prize.quantity
      }
    }

    // 加入最後賞成本（不計入抽數）
    if (draft.last_prize_product_id) {
      lastPrizeCost = productCostMap.get(draft.last_prize_product_id) || 0
      totalCost += lastPrizeCost
    }
  }

  const avgCost = totalDraws > 0 ? totalCost / totalDraws : 0

  // Create ichiban kuji
  const insertData: any = {
    name: draft.name,
    barcode: draft.barcode || null,
    price: draft.price,
    total_draws: totalDraws,
    avg_cost: avgCost,
    set_type: draft.set_type || 'custom',
    total_cost: totalCost,
    combo_prices: draft.combo_prices || [],
    opening_combo_prices: draft.opening_combo_prices || [],
    // 最後賞
    last_prize_name: draft.last_prize_name || null,
    last_prize_product_id: isOfficial ? null : (draft.last_prize_product_id || null),
  }

  // 官方套：設定廠商、未啟用（沒有收貨流程，建立時就當作已到貨）
  if (isOfficial) {
    insertData.vendor_code = draft.vendor_code
    insertData.is_received = true
    insertData.is_active = false
  }

  const { data: kuji, error: kujiError } = await (supabaseServer
    .from('ichiban_kuji') as any)
    .insert(insertData)
    .select()
    .single()

  if (kujiError) {
    return { ok: false, error: kujiError.message, status: 500 }
  }

  // Insert prizes
  const prizeInserts = draft.prizes.map(prize => {
    const isSelection = !isOfficial && prize.selection_product_ids && prize.selection_product_ids.length > 0
    return {
      kuji_id: kuji.id,
      prize_tier: prize.prize_tier,
      prize_name: prize.prize_name || null,
      product_id: isOfficial ? null : (isSelection ? null : prize.product_id),
      quantity: prize.quantity,
      remaining: prize.quantity,
    }
  })

  const { data: insertedPrizes, error: prizesError } = await (supabaseServer
    .from('ichiban_kuji_prizes') as any)
    .insert(prizeInserts)
    .select('id, prize_tier')

  if (prizesError) {
    // Rollback: delete the kuji
    await (supabaseServer.from('ichiban_kuji') as any).delete().eq('id', kuji.id)
    return { ok: false, error: prizesError.message, status: 500 }
  }

  // Insert prize options for selection prizes
  const optionInserts: any[] = []
  for (let i = 0; i < draft.prizes.length; i++) {
    const prize = draft.prizes[i]
    if (!isOfficial && prize.selection_product_ids && prize.selection_product_ids.length > 0) {
      const insertedPrize = insertedPrizes[i]
      for (const productId of prize.selection_product_ids) {
        optionInserts.push({
          prize_id: insertedPrize.id,
          product_id: productId,
        })
      }
    }
  }

  if (optionInserts.length > 0) {
    const { error: optionsError } = await (supabaseServer
      .from('ichiban_kuji_prize_options') as any)
      .insert(optionInserts)

    if (optionsError) {
      // Rollback
      await (supabaseServer.from('ichiban_kuji_prizes') as any).delete().eq('kuji_id', kuji.id)
      await (supabaseServer.from('ichiban_kuji') as any).delete().eq('id', kuji.id)
      return { ok: false, error: optionsError.message, status: 500 }
    }
  }

  return { ok: true, data: kuji }
}
