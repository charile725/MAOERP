import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { ichibanKujiDraftSchema } from '@/lib/schemas'
import { fromZodError } from 'zod-validation-error'

type RouteContext = {
  params: Promise<{ id: string }>
}

// GET /api/ichiban-kuji/:id - Get single ichiban kuji with prizes
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params

    const { data: kuji, error } = await (supabaseServer
      .from('ichiban_kuji') as any)
      .select(`
        *,
        ichiban_kuji_prizes (
          id,
          prize_tier,
          prize_name,
          product_id,
          quantity,
          remaining,
          products (
            id,
            name,
            item_code,
            barcode,
            cost,
            price,
            stock,
            unit
          ),
          ichiban_kuji_prize_options (
            id,
            product_id,
            is_consumed,
            consumed_sale_item_id,
            products (
              id,
              name,
              item_code,
              cost
            )
          )
        ),
        last_prize_product:products!last_prize_product_id (
          id,
          name,
          item_code,
          cost
        )
      `)
      .eq('id', id)
      .single()

    if (error) {
      return NextResponse.json(
        { ok: false, error: '找不到一番賞' },
        { status: 404 }
      )
    }

    return NextResponse.json({ ok: true, data: kuji })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}

// PUT /api/ichiban-kuji/:id - Update ichiban kuji
export async function PUT(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params
    const body = await request.json()

    // Validate input
    const validation = ichibanKujiDraftSchema.safeParse(body)
    if (!validation.success) {
      const error = fromZodError(validation.error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      )
    }

    const draft = validation.data
    const isOfficial = draft.set_type === 'official'

    // Calculate total draws and average cost
    let totalDraws = 0
    let totalCost = 0

    if (isOfficial) {
      // 官方套：成本來自使用者輸入
      totalDraws = draft.prizes.reduce((sum, p) => sum + p.quantity, 0)
      totalCost = draft.total_cost || 0
      // 官方套的最後賞成本已包含在 total_cost 中
    } else {
      // 自製套：成本從各商品計算
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
          const cost = productCostMap.get(prize.product_id) || 0
          totalDraws += prize.quantity
          totalCost += cost * prize.quantity
        }
      }

      // 加入最後賞成本（不計入抽數）
      if (draft.last_prize_product_id) {
        const lastPrizeCost = productCostMap.get(draft.last_prize_product_id) || 0
        totalCost += lastPrizeCost
      }
    }

    const avgCost = totalDraws > 0 ? totalCost / totalDraws : 0

    // Update ichiban kuji
    const { error: updateError } = await (supabaseServer
      .from('ichiban_kuji') as any)
      .update({
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
      })
      .eq('id', id)

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 }
      )
    }

    // 讀取舊的 prizes（包含 ID，用於 UPDATE）
    //
    // ⚠️ 這次讀取一定要檢查錯誤。讀失敗時 data 是 null，下面的比對表就會是空的，
    //    於是每一個賞項都被判定成「新的」而整批 INSERT —— 整套賞項瞬間變兩份。
    //    2026-09-12 就這樣讓「寶可夢鑑定卡牌大賞(大套)」多出 17 筆重複賞項。
    //    讀不到舊資料時寧可整個失敗，也不能當成「本來就沒有」。
    const { data: oldPrizes, error: oldPrizesError } = await (supabaseServer
      .from('ichiban_kuji_prizes') as any)
      .select('id, prize_tier, prize_name, product_id, quantity, remaining')
      .eq('kuji_id', id)

    if (oldPrizesError || !oldPrizes) {
      console.error(`[Ichiban Kuji PUT ${id}] 讀取現有賞項失敗:`, oldPrizesError)
      return NextResponse.json(
        { ok: false, error: `讀取現有賞項失敗，為避免賞項重複已中止更新：${oldPrizesError?.message || '沒有回傳資料'}` },
        { status: 500 }
      )
    }

    // 讀取舊的 prize options
    const oldPrizeIds = oldPrizes.map((p: any) => p.id)
    let oldOptionsMap = new Map<string, any[]>()
    if (oldPrizeIds.length > 0) {
      const { data: oldOptions, error: oldOptionsError } = await (supabaseServer
        .from('ichiban_kuji_prize_options') as any)
        .select('id, prize_id, product_id, is_consumed')
        .in('prize_id', oldPrizeIds)

      // 同理：讀不到選項會讓複選獎的 key 算錯，一樣會變成重複插入
      if (oldOptionsError || !oldOptions) {
        console.error(`[Ichiban Kuji PUT ${id}] 讀取複選獎選項失敗:`, oldOptionsError)
        return NextResponse.json(
          { ok: false, error: `讀取複選獎選項失敗，為避免賞項重複已中止更新：${oldOptionsError?.message || '沒有回傳資料'}` },
          { status: 500 }
        )
      }

      for (const opt of oldOptions) {
        const list = oldOptionsMap.get(opt.prize_id) || []
        list.push(opt)
        oldOptionsMap.set(opt.prize_id, list)
      }
    }

    console.log(`[Ichiban Kuji PUT ${id}] Found ${oldPrizes.length} old prizes`)

    // 建立舊 prizes 的 Map
    // 複選獎使用 `${prize_tier}_selection` 作為 key
    //
    // 同一個 key 可能對到多筆（歷史上被重複插入過），所以存成陣列：
    // 第一筆拿來更新，多出來的在下面順手清掉，讓這條路徑自己把舊的重複收拾乾淨。
    const oldPrizesMap = new Map<string, any[]>()
    for (const prize of oldPrizes) {
      const hasOptions = (oldOptionsMap.get(prize.id) || []).length > 0
      const key = isOfficial
        ? prize.prize_tier
        : hasOptions
          ? `${prize.prize_tier}_selection`
          : `${prize.prize_tier}_${prize.product_id}`
      const list = oldPrizesMap.get(key) || []
      if (list.length > 0) {
        console.warn(`[Ichiban Kuji PUT ${id}] Duplicate prize found: ${key}`)
      }
      list.push(prize)
      oldPrizesMap.set(key, list)
    }

    // 建立新 prizes 的 Map
    const newPrizesMap = new Map<string, any>()
    for (const prize of draft.prizes) {
      const isSelection = !isOfficial && prize.selection_product_ids && prize.selection_product_ids.length > 0
      const key = isOfficial
        ? prize.prize_tier
        : isSelection
          ? `${prize.prize_tier}_selection`
          : `${prize.prize_tier}_${prize.product_id}`
      newPrizesMap.set(key, prize)
    }

    // 每個舊賞項實際賣出幾抽，一律以 sale_items 為準。
    // 不能用 quantity - remaining 推算：remaining 被重複加回過（刪除銷售單重試）的話，
    // 推出來的已賣數量會變成負數，錯誤就被這次編輯原封不動保留下來。
    const soldByPrizeId = new Map<string, number>()
    if (oldPrizeIds.length > 0) {
      const { data: soldRows, error: soldError } = await (supabaseServer
        .from('sale_items') as any)
        .select('ichiban_kuji_prize_id, quantity')
        .in('ichiban_kuji_prize_id', oldPrizeIds)

      if (soldError || !soldRows) {
        console.error(`[Ichiban Kuji PUT ${id}] 讀取已售抽數失敗:`, soldError)
        return NextResponse.json(
          { ok: false, error: `讀取已售抽數失敗，已中止更新：${soldError?.message || '沒有回傳資料'}` },
          { status: 500 }
        )
      }

      for (const row of soldRows) {
        soldByPrizeId.set(
          row.ichiban_kuji_prize_id,
          (soldByPrizeId.get(row.ichiban_kuji_prize_id) || 0) + Number(row.quantity || 0)
        )
      }
    }

    // 數量被調到比已賣出還少的賞項（會自動拉回已賣出的數量），回傳給前端提示
    const clampedPrizes: { prize_tier: string; requested: number; sold: number }[] = []

    let updatedCount = 0
    let insertedCount = 0
    let deletedCount = 0

    // 1. UPDATE 或 INSERT 新的 prizes
    for (const [key, newPrize] of newPrizesMap) {
      const oldGroup = oldPrizesMap.get(key) || []
      const oldPrize = oldGroup[0]

      // 同一個 key 有多筆＝歷史上被重複插入過。留第一筆繼續用，
      // 其餘沒有銷售紀錄的就地清掉（有銷售紀錄的不動，留給人工判斷）。
      for (const surplus of oldGroup.slice(1)) {
        const { data: surplusSales } = await (supabaseServer
          .from('sale_items') as any)
          .select('id')
          .eq('ichiban_kuji_prize_id', surplus.id)
          .limit(1)

        if (surplusSales && surplusSales.length > 0) {
          console.warn(`[Ichiban Kuji PUT ${id}] 重複賞項 ${key} 有銷售紀錄，保留不刪：${surplus.id}`)
          continue
        }

        const { error: surplusError } = await (supabaseServer
          .from('ichiban_kuji_prizes') as any)
          .delete()
          .eq('id', surplus.id)

        if (surplusError) {
          console.error(`[Ichiban Kuji PUT ${id}] 清除重複賞項 ${key} 失敗:`, surplusError)
        } else {
          deletedCount++
          console.log(`[Ichiban Kuji PUT ${id}] 清除重複賞項 ${key}：${surplus.id}`)
        }
      }

      if (oldPrize) {
        // 已存在，UPDATE（保留已售出數量）
        //
        // 數量不能改到比「已經賣出的抽數」還少。紙籤已經被抽走了，
        // 總數 1、已賣 59 這種資料會讓 total_draws 少算、每抽成本被灌大。
        // 常見情境：換掉沒中獎的商品時，舊賞項有銷售紀錄刪不掉，就把數量改成 0 或 1 —
        // 這時自動拉回已賣出的數量，等於「這個賞項售完、不再出」，正是使用者要的效果。
        const sold = soldByPrizeId.get(oldPrize.id) || 0
        const effectiveQuantity = Math.max(Number(newPrize.quantity), sold)
        const newRemaining = effectiveQuantity - sold

        if (effectiveQuantity !== Number(newPrize.quantity)) {
          clampedPrizes.push({ prize_tier: newPrize.prize_tier, requested: Number(newPrize.quantity), sold })
        }

        const { error: updateError } = await (supabaseServer
          .from('ichiban_kuji_prizes') as any)
          .update({
            prize_name: newPrize.prize_name || null,
            quantity: effectiveQuantity,
            remaining: newRemaining,
          })
          .eq('id', oldPrize.id)

        if (updateError) {
          console.error(`[Ichiban Kuji PUT ${id}] Failed to update prize ${key}:`, updateError)
          return NextResponse.json(
            { ok: false, error: `更新賞項失敗: ${updateError.message}` },
            { status: 500 }
          )
        }

        updatedCount++
        console.log(`[Ichiban Kuji PUT ${id}] Updated prize ${key}: quantity ${oldPrize.quantity} -> ${effectiveQuantity}, remaining ${oldPrize.remaining} -> ${newRemaining}（已賣 ${sold}）`)
      } else {
        // 不存在，INSERT
        const isSelection = !isOfficial && newPrize.selection_product_ids && newPrize.selection_product_ids.length > 0
        const { data: insertedPrize, error: insertError } = await (supabaseServer
          .from('ichiban_kuji_prizes') as any)
          .insert({
            kuji_id: id,
            prize_tier: newPrize.prize_tier,
            prize_name: newPrize.prize_name || null,
            product_id: isOfficial ? null : (isSelection ? null : newPrize.product_id),
            quantity: newPrize.quantity,
            remaining: newPrize.quantity,
          })
          .select('id')
          .single()

        if (insertError) {
          console.error(`[Ichiban Kuji PUT ${id}] Failed to insert prize ${key}:`, insertError)
          return NextResponse.json(
            { ok: false, error: `新增賞項失敗: ${insertError.message}` },
            { status: 500 }
          )
        }

        // 插入複選獎選項
        if (isSelection && insertedPrize) {
          const optInserts = newPrize.selection_product_ids!.map((pid: string) => ({
            prize_id: insertedPrize.id,
            product_id: pid,
          }))
          const { error: optErr } = await (supabaseServer
            .from('ichiban_kuji_prize_options') as any)
            .insert(optInserts)
          if (optErr) {
            console.error(`[Ichiban Kuji PUT ${id}] Failed to insert options for ${key}:`, optErr)
          }
        }

        insertedCount++
        console.log(`[Ichiban Kuji PUT ${id}] Inserted new prize ${key}`)
      }

      // 更新複選獎選項（已存在的 prize）
      if (oldPrize && !isOfficial && newPrize.selection_product_ids && newPrize.selection_product_ids.length > 0) {
        const existingOptions = oldOptionsMap.get(oldPrize.id) || []
        const existingProductIds = new Set(existingOptions.map((o: any) => o.product_id))
        const newProductIds = new Set(newPrize.selection_product_ids as string[])

        // 新增不存在的選項
        const toAdd = [...newProductIds].filter(pid => !existingProductIds.has(pid))
        if (toAdd.length > 0) {
          await (supabaseServer
            .from('ichiban_kuji_prize_options') as any)
            .insert(toAdd.map(pid => ({ prize_id: oldPrize.id, product_id: pid })))
        }

        // 刪除不再需要且未消耗的選項
        const toRemove = existingOptions.filter(
          (o: any) => !newProductIds.has(o.product_id) && !o.is_consumed
        )
        if (toRemove.length > 0) {
          await (supabaseServer
            .from('ichiban_kuji_prize_options') as any)
            .delete()
            .in('id', toRemove.map((o: any) => o.id))
        }

        // 拒絕刪除已消耗的選項
        const consumedButRemoved = existingOptions.filter(
          (o: any) => !newProductIds.has(o.product_id) && o.is_consumed
        )
        if (consumedButRemoved.length > 0) {
          console.warn(`[Ichiban Kuji PUT ${id}] Cannot remove consumed options for ${key}`)
        }
      }
    }

    // 2. DELETE 被移除的 prizes（檢查是否有銷售記錄）
    for (const [key, oldGroup] of oldPrizesMap) {
      if (newPrizesMap.has(key)) continue
      for (const oldPrize of oldGroup) {
        // 檢查是否有銷售記錄
        const { data: saleItems } = await (supabaseServer
          .from('sale_items') as any)
          .select('id')
          .eq('ichiban_kuji_prize_id', oldPrize.id)
          .limit(1)

        if (saleItems && saleItems.length > 0) {
          console.warn(`[Ichiban Kuji PUT ${id}] Cannot delete prize ${key} - has sale records`)
          return NextResponse.json(
            { ok: false, error: `賞項 ${oldPrize.prize_tier} 已有銷售記錄，無法刪除。請保留此賞項，把數量設成 0 即可（系統會自動保留已賣出的 ${soldByPrizeId.get(oldPrize.id) || 0} 抽並視為售完）。` },
            { status: 400 }
          )
        }

        // 沒有銷售記錄，可以刪除（options 會 CASCADE 刪除）
        const { error: deleteError } = await (supabaseServer
          .from('ichiban_kuji_prizes') as any)
          .delete()
          .eq('id', oldPrize.id)

        if (deleteError) {
          console.error(`[Ichiban Kuji PUT ${id}] Failed to delete prize ${key}:`, deleteError)
          return NextResponse.json(
            { ok: false, error: `刪除賞項失敗: ${deleteError.message}` },
            { status: 500 }
          )
        }

        deletedCount++
        console.log(`[Ichiban Kuji PUT ${id}] Deleted prize ${key}`)
      }
    }

    // 依照實際寫進去的賞項重算抽數與成本。
    // 最上面是照使用者送來的數量算的，但數量可能被拉回已賣出的數量，那個值已經不對了。
    const { data: finalPrizes, error: finalPrizesError } = await (supabaseServer
      .from('ichiban_kuji_prizes') as any)
      .select('id, product_id, quantity')
      .eq('kuji_id', id)

    if (!finalPrizesError && finalPrizes) {
      const finalDraws = finalPrizes.reduce((sum: number, p: any) => sum + Number(p.quantity || 0), 0)
      let finalCost = totalCost

      if (!isOfficial) {
        const finalIds = finalPrizes.map((p: any) => p.id)
        const { data: finalOptions } = finalIds.length > 0
          ? await (supabaseServer.from('ichiban_kuji_prize_options') as any)
              .select('prize_id, product_id')
              .in('prize_id', finalIds)
          : { data: [] }

        const optionsByPrize = new Map<string, string[]>()
        for (const o of (finalOptions || []) as any[]) {
          const list = optionsByPrize.get(o.prize_id) || []
          list.push(o.product_id)
          optionsByPrize.set(o.prize_id, list)
        }

        const costIds = [
          ...finalPrizes.map((p: any) => p.product_id).filter(Boolean),
          ...((finalOptions || []) as any[]).map((o: any) => o.product_id),
          ...(draft.last_prize_product_id ? [draft.last_prize_product_id] : []),
        ]
        const { data: costRows } = costIds.length > 0
          ? await (supabaseServer.from('products') as any).select('id, cost').in('id', [...new Set(costIds)])
          : { data: [] }
        const costOf = new Map<string, number>(((costRows || []) as any[]).map((r: any) => [r.id, Number(r.cost) || 0]))

        finalCost = 0
        for (const p of finalPrizes as any[]) {
          const opts = optionsByPrize.get(p.id) || []
          const unitCost = opts.length > 0
            ? opts.reduce((sum, pid) => sum + (costOf.get(pid) || 0), 0) / opts.length
            : (costOf.get(p.product_id) || 0)
          finalCost += unitCost * Number(p.quantity || 0)
        }
        if (draft.last_prize_product_id) finalCost += costOf.get(draft.last_prize_product_id) || 0
      }

      if (finalDraws !== totalDraws || Math.abs(finalCost - totalCost) > 0.005) {
        await (supabaseServer
          .from('ichiban_kuji') as any)
          .update({
            total_draws: finalDraws,
            total_cost: finalCost,
            avg_cost: finalDraws > 0 ? finalCost / finalDraws : 0,
          })
          .eq('id', id)
      }
    }

    console.log(`[Ichiban Kuji PUT ${id}] Summary: updated ${updatedCount}, inserted ${insertedCount}, deleted ${deletedCount}`)

    return NextResponse.json({
      ok: true,
      data: {
        prizes_updated: updatedCount,
        prizes_inserted: insertedCount,
        prizes_deleted: deletedCount,
        // 數量被自動拉回已賣出抽數的賞項（前端可提示「已視為售完」）
        clamped_prizes: clampedPrizes,
      }
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}

// PATCH /api/ichiban-kuji/:id - Toggle active / mark received
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params
    const body = await request.json()

    // 讀取當前一番賞資料
    const { data: kuji, error: fetchError } = await (supabaseServer
      .from('ichiban_kuji') as any)
      .select('id, is_active, set_type')
      .eq('id', id)
      .single()

    if (fetchError || !kuji) {
      return NextResponse.json(
        { ok: false, error: '找不到一番賞' },
        { status: 404 }
      )
    }

    const updateData: any = {}

    // 處理啟用/停用（已無收貨流程，不再擋未收貨）
    if (typeof body.is_active === 'boolean') {
      updateData.is_active = body.is_active
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { ok: false, error: '沒有需要更新的欄位' },
        { status: 400 }
      )
    }

    const { data: updated, error: updateError } = await (supabaseServer
      .from('ichiban_kuji') as any)
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, data: updated })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}

// DELETE /api/ichiban-kuji/:id - Delete ichiban kuji
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params

    // 檢查是否有相關銷售紀錄
    const { data: saleItems } = await (supabaseServer
      .from('sale_items') as any)
      .select('id')
      .eq('ichiban_kuji_id', id)
      .limit(1)

    if (saleItems && saleItems.length > 0) {
      return NextResponse.json(
        { ok: false, error: '此一番賞已有銷售紀錄，無法刪除' },
        { status: 400 }
      )
    }

    // Delete prizes first (cascade should handle this, but being explicit)
    await (supabaseServer
      .from('ichiban_kuji_prizes') as any)
      .delete()
      .eq('kuji_id', id)

    // Delete kuji
    const { error: deleteError } = await (supabaseServer
      .from('ichiban_kuji') as any)
      .delete()
      .eq('id', id)

    if (deleteError) {
      return NextResponse.json(
        { ok: false, error: deleteError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
