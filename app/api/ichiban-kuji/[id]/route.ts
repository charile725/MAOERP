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
          )
        )
      `)
      .eq('id', id)
      .single()

    if (error) {
      return NextResponse.json(
        { ok: false, error: 'Ichiban kuji not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ ok: true, data: kuji })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
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
    } else {
      // 自製套：成本從各商品計算
      const productIds = draft.prizes.map(p => p.product_id).filter(Boolean) as string[]
      const { data: products } = await (supabaseServer
        .from('products') as any)
        .select('id, cost')
        .in('id', productIds)

      const productCostMap = new Map(
        (products as any[])?.map(p => [p.id, p.cost]) || []
      )

      for (const prize of draft.prizes) {
        const cost = productCostMap.get(prize.product_id) || 0
        totalDraws += prize.quantity
        totalCost += cost * prize.quantity
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
      })
      .eq('id', id)

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 }
      )
    }

    // 讀取舊的 prizes（包含 ID，用於 UPDATE）
    const { data: oldPrizes } = await (supabaseServer
      .from('ichiban_kuji_prizes') as any)
      .select('id, prize_tier, prize_name, product_id, quantity, remaining')
      .eq('kuji_id', id)

    console.log(`[Ichiban Kuji PUT ${id}] Found ${oldPrizes?.length || 0} old prizes`)

    // 建立舊 prizes 的 Map（使用 prize_tier + product_id 作為唯一鍵；官方套用 prize_tier 即可）
    const oldPrizesMap = new Map<string, any>()
    if (oldPrizes && oldPrizes.length > 0) {
      for (const prize of oldPrizes) {
        const key = isOfficial ? prize.prize_tier : `${prize.prize_tier}_${prize.product_id}`
        if (oldPrizesMap.has(key)) {
          console.warn(`[Ichiban Kuji PUT ${id}] Duplicate prize found: ${key}`)
        }
        oldPrizesMap.set(key, prize)
      }
    }

    // 建立新 prizes 的 Map
    const newPrizesMap = new Map<string, any>()
    for (const prize of draft.prizes) {
      const key = isOfficial ? prize.prize_tier : `${prize.prize_tier}_${prize.product_id}`
      newPrizesMap.set(key, prize)
    }

    let updatedCount = 0
    let insertedCount = 0
    let deletedCount = 0

    // 1. UPDATE 或 INSERT 新的 prizes
    for (const [key, newPrize] of newPrizesMap) {
      const oldPrize = oldPrizesMap.get(key)

      if (oldPrize) {
        // 已存在，UPDATE（保留已售出數量）
        const sold = oldPrize.quantity - oldPrize.remaining
        const newRemaining = Math.max(0, newPrize.quantity - sold)

        const { error: updateError } = await (supabaseServer
          .from('ichiban_kuji_prizes') as any)
          .update({
            prize_name: newPrize.prize_name || null,
            quantity: newPrize.quantity,
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
        console.log(`[Ichiban Kuji PUT ${id}] Updated prize ${key}: quantity ${oldPrize.quantity} -> ${newPrize.quantity}, remaining ${oldPrize.remaining} -> ${newRemaining}`)
      } else {
        // 不存在，INSERT
        const { error: insertError } = await (supabaseServer
          .from('ichiban_kuji_prizes') as any)
          .insert({
            kuji_id: id,
            prize_tier: newPrize.prize_tier,
            prize_name: newPrize.prize_name || null,
            product_id: isOfficial ? null : newPrize.product_id,
            quantity: newPrize.quantity,
            remaining: newPrize.quantity,
          })

        if (insertError) {
          console.error(`[Ichiban Kuji PUT ${id}] Failed to insert prize ${key}:`, insertError)
          return NextResponse.json(
            { ok: false, error: `新增賞項失敗: ${insertError.message}` },
            { status: 500 }
          )
        }

        insertedCount++
        console.log(`[Ichiban Kuji PUT ${id}] Inserted new prize ${key}`)
      }
    }

    // 2. DELETE 被移除的 prizes（檢查是否有銷售記錄）
    for (const [key, oldPrize] of oldPrizesMap) {
      if (!newPrizesMap.has(key)) {
        // 檢查是否有銷售記錄
        const { data: saleItems } = await (supabaseServer
          .from('sale_items') as any)
          .select('id')
          .eq('ichiban_kuji_prize_id', oldPrize.id)
          .limit(1)

        if (saleItems && saleItems.length > 0) {
          console.warn(`[Ichiban Kuji PUT ${id}] Cannot delete prize ${key} - has sale records`)
          return NextResponse.json(
            { ok: false, error: `賞項 ${oldPrize.prize_tier} 已有銷售記錄，無法刪除。請保留此賞項或將數量設為 0。` },
            { status: 400 }
          )
        }

        // 沒有銷售記錄，可以刪除
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

    console.log(`[Ichiban Kuji PUT ${id}] Summary: updated ${updatedCount}, inserted ${insertedCount}, deleted ${deletedCount}`)

    return NextResponse.json({
      ok: true,
      data: {
        prizes_updated: updatedCount,
        prizes_inserted: insertedCount,
        prizes_deleted: deletedCount
      }
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
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
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
