import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { updateAccountBalance } from '@/lib/account-service'
import { getTaiwanTime, getTaiwanDateString } from '@/lib/timezone'

type RouteContext = {
  params: Promise<{ id: string }>
}

/**
 * POST /api/ichiban-kuji/:id/close-set
 *
 * 廢套結算：計算自製一番賞的成本差額，建立費用記錄，停用一番賞
 *
 * Body:
 *   preview: boolean  — true 時只回傳計算結果，不寫入
 *   account_id?: string — 選填，要扣款的帳戶
 *   last_prize_delivered?: boolean — 最後賞是否已送出（影響成本計算）
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params
    const body = await request.json()
    const preview = body.preview === true
    const accountId: string | null = body.account_id || null
    const lastPrizeDelivered: boolean = body.last_prize_delivered === true

    // 1. 讀取一番賞及其賞項
    const { data: kuji, error: kujiError } = await (supabaseServer
      .from('ichiban_kuji') as any)
      .select(`
        *,
        ichiban_kuji_prizes (
          id,
          prize_tier,
          product_id,
          quantity,
          remaining,
          products (
            id,
            name,
            item_code,
            cost
          )
        )
      `)
      .eq('id', id)
      .single()

    if (kujiError || !kuji) {
      return NextResponse.json(
        { ok: false, error: '找不到一番賞' },
        { status: 404 }
      )
    }

    // 驗證：必須是自製套
    if (kuji.set_type !== 'custom') {
      return NextResponse.json(
        { ok: false, error: '僅自製套可進行廢套結算' },
        { status: 400 }
      )
    }

    // 驗證：必須是啟用中
    if (!kuji.is_active) {
      return NextResponse.json(
        { ok: false, error: '此一番賞已停用' },
        { status: 400 }
      )
    }

    // 2. 計算各獎品的已抽數量及成本
    const prizes = kuji.ichiban_kuji_prizes as any[]
    let totalDrawsSold = 0
    let actualCostOfDrawn = 0
    const prizeDetails: {
      prize_tier: string
      product_name: string
      quantity: number
      remaining: number
      drawn: number
      unit_cost: number
      drawn_cost: number
    }[] = []

    for (const prize of prizes) {
      const drawn = prize.quantity - prize.remaining
      const unitCost = prize.products?.cost || 0
      const drawnCost = drawn * unitCost
      totalDrawsSold += drawn
      actualCostOfDrawn += drawnCost

      prizeDetails.push({
        prize_tier: prize.prize_tier,
        product_name: prize.products?.name || '-',
        quantity: prize.quantity,
        remaining: prize.remaining,
        drawn,
        unit_cost: unitCost,
        drawn_cost: drawnCost,
      })
    }

    // 3. 最後賞成本（如果已送出）
    let lastPrizeCost = 0
    let lastPrizeProductName: string | null = null
    if (lastPrizeDelivered && kuji.last_prize_product_id) {
      const { data: lastProduct } = await (supabaseServer
        .from('products') as any)
        .select('id, name, cost')
        .eq('id', kuji.last_prize_product_id)
        .single()

      if (lastProduct) {
        lastPrizeCost = lastProduct.cost || 0
        lastPrizeProductName = lastProduct.name
        actualCostOfDrawn += lastPrizeCost
      }
    }

    // 4. 已記錄成本 = avg_cost × 已賣總抽數
    const recordedCost = kuji.avg_cost * totalDrawsSold

    // 5. 差額
    const adjustment = actualCostOfDrawn - recordedCost

    const result = {
      kuji_id: id,
      kuji_name: kuji.name,
      avg_cost: kuji.avg_cost,
      total_draws: kuji.total_draws,
      total_draws_sold: totalDrawsSold,
      total_draws_remaining: kuji.total_draws - totalDrawsSold,
      actual_cost_of_drawn: actualCostOfDrawn,
      recorded_cost: Math.round(recordedCost),
      adjustment: Math.round(actualCostOfDrawn - recordedCost),
      last_prize_delivered: lastPrizeDelivered,
      last_prize_cost: lastPrizeCost,
      last_prize_product_name: lastPrizeProductName,
      prize_details: prizeDetails,
    }

    // 預覽模式：只回傳計算結果
    if (preview) {
      return NextResponse.json({ ok: true, data: result })
    }

    // === 執行模式 ===

    const adjustmentAmount = result.adjustment
    const absAmount = Math.abs(adjustmentAmount)

    // 組合備註
    const noteLines = [
      `一番賞廢套結算：${kuji.name}`,
      `已售抽數：${totalDrawsSold}/${kuji.total_draws}`,
      `被抽出商品總成本：${actualCostOfDrawn}`,
      `已記錄成本 (${kuji.avg_cost} × ${totalDrawsSold})：${result.recorded_cost}`,
      `調整金額：${adjustmentAmount >= 0 ? '+' : ''}${adjustmentAmount}`,
    ]
    if (lastPrizeDelivered && lastPrizeProductName) {
      noteLines.push(`最後賞已送出：${lastPrizeProductName} (成本 ${lastPrizeCost})`)
    }
    // 各獎品明細
    noteLines.push('---')
    for (const p of prizeDetails) {
      noteLines.push(`${p.prize_tier} ${p.product_name}: 已抽 ${p.drawn}/${p.quantity}, 成本 ${p.drawn_cost}`)
    }
    const note = noteLines.join('\n')

    const today = getTaiwanDateString()

    if (absAmount > 0) {
      // 6. 建立 expense 記錄
      const { data: expense, error: expenseError } = await (supabaseServer
        .from('expenses') as any)
        .insert({
          date: today,
          category: '一番賞結損',
          amount: absAmount,
          account_id: accountId,
          note,
          created_at: getTaiwanTime(),
        })
        .select()
        .single()

      if (expenseError) {
        return NextResponse.json(
          { ok: false, error: `建立費用記錄失敗: ${expenseError.message}` },
          { status: 500 }
        )
      }

      // 7. 如果有指定帳戶，扣減帳戶餘額
      if (accountId && absAmount > 0) {
        const accountUpdate = await updateAccountBalance({
          supabase: supabaseServer,
          accountId,
          amount: absAmount,
          direction: adjustmentAmount > 0 ? 'decrease' : 'increase',
          transactionType: 'expense',
          referenceId: expense.id.toString(),
          note: `一番賞廢套結算：${kuji.name}`,
        })

        if (!accountUpdate.success) {
          // 回滾 expense
          await (supabaseServer.from('expenses') as any).delete().eq('id', expense.id)
          return NextResponse.json(
            { ok: false, error: `更新帳戶失敗: ${accountUpdate.error}` },
            { status: 500 }
          )
        }
      }
    }

    // 8. 停用一番賞
    const { error: deactivateError } = await (supabaseServer
      .from('ichiban_kuji') as any)
      .update({ is_active: false })
      .eq('id', id)

    if (deactivateError) {
      return NextResponse.json(
        { ok: false, error: `停用一番賞失敗: ${deactivateError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      data: {
        ...result,
        expense_created: absAmount > 0,
        account_updated: accountId && absAmount > 0,
      }
    })
  } catch (error: any) {
    console.error('[close-set] Error:', error)
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
