import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { updateAccountBalance } from '@/lib/account-service'
import { getTaiwanTime } from '@/lib/timezone'

type RouteContext = {
  params: Promise<{ id: string }>
}

/**
 * POST /api/ichiban-kuji/:id/reactivate
 *
 * 復活已廢套結算的一番賞：反轉費用記錄、回補帳戶、重新啟用
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params

    // 1. 讀取一番賞
    const { data: kuji, error: kujiError } = await (supabaseServer
      .from('ichiban_kuji') as any)
      .select('*')
      .eq('id', id)
      .single()

    if (kujiError || !kuji) {
      return NextResponse.json(
        { ok: false, error: '找不到一番賞' },
        { status: 404 }
      )
    }

    if (kuji.set_type !== 'custom') {
      return NextResponse.json(
        { ok: false, error: '僅自製套可復活' },
        { status: 400 }
      )
    }

    if (kuji.is_active) {
      return NextResponse.json(
        { ok: false, error: '此一番賞已啟用中' },
        { status: 400 }
      )
    }

    // 2. 找到廢套結算產生的費用記錄
    const notePrefix = `一番賞廢套結算：${kuji.name}`
    const { data: expenses } = await (supabaseServer
      .from('expenses') as any)
      .select('id, amount, account_id')
      .eq('category', '一番賞結損')
      .like('note', `${notePrefix}%`)
      .order('created_at', { ascending: false })
      .limit(1)

    const expense = expenses?.[0]

    if (expense) {
      // 3. 反轉帳戶餘額（如果有扣帳戶）
      if (expense.account_id && expense.amount > 0) {
        const accountUpdate = await updateAccountBalance({
          supabase: supabaseServer,
          accountId: expense.account_id,
          amount: expense.amount,
          direction: 'increase',
          transactionType: 'adjustment',
          referenceId: expense.id.toString(),
          note: `一番賞復活回補：${kuji.name}`,
        })

        if (!accountUpdate.success) {
          return NextResponse.json(
            { ok: false, error: `回補帳戶失敗: ${accountUpdate.error}` },
            { status: 500 }
          )
        }
      }

      // 4. 刪除費用記錄
      await (supabaseServer
        .from('expenses') as any)
        .delete()
        .eq('id', expense.id)
    }

    // 5. 重新啟用一番賞
    const { error: activateError } = await (supabaseServer
      .from('ichiban_kuji') as any)
      .update({ is_active: true })
      .eq('id', id)

    if (activateError) {
      return NextResponse.json(
        { ok: false, error: `啟用失敗: ${activateError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      data: {
        kuji_id: id,
        kuji_name: kuji.name,
        expense_reversed: !!expense,
        amount_reversed: expense?.amount || 0,
        account_restored: !!(expense?.account_id),
      }
    })
  } catch (error: any) {
    console.error('[reactivate] Error:', error)
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
