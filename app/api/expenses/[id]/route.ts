import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { expenseSchema } from '@/lib/schemas'
import { fromZodError } from 'zod-validation-error'
import { updateAccountBalance } from '@/lib/account-service'
import { getTaiwanTime } from '@/lib/timezone'

type RouteContext = {
  params: Promise<{ id: string }>
}

// GET /api/expenses/:id - Get single expense
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params

    const { data, error } = await (supabaseServer
      .from('expenses') as any)
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      return NextResponse.json(
        { ok: false, error: '找不到費用記錄' },
        { status: 404 }
      )
    }

    return NextResponse.json({ ok: true, data })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}

// PUT /api/expenses/:id - Update expense
export async function PUT(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params
    const body = await request.json()

    // Validate input
    const validation = expenseSchema.safeParse(body)
    if (!validation.success) {
      const error = fromZodError(validation.error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      )
    }

    const newExpense = validation.data

    // 1. 讀取舊的費用記錄
    const { data: oldExpense, error: fetchError } = await (supabaseServer
      .from('expenses') as any)
      .select('account_id, amount')
      .eq('id', id)
      .single()

    if (fetchError) {
      return NextResponse.json(
        { ok: false, error: '找不到費用記錄' },
        { status: 404 }
      )
    }

    const oldAccountId = oldExpense.account_id
    const newAccountId = newExpense.account_id || null
    const oldAmount = oldExpense.amount
    const newAmount = newExpense.amount

    // 2. 完全還原舊狀態（如果有帳戶）
    if (oldAccountId) {
      // 刪除舊的 account_transactions 記錄
      await (supabaseServer
        .from('account_transactions') as any)
        .delete()
        .eq('ref_type', 'expense')
        .eq('ref_id', id)

      // 還原帳戶餘額
      const { data: oldAccount } = await (supabaseServer
        .from('accounts') as any)
        .select('balance')
        .eq('id', oldAccountId)
        .single()

      if (oldAccount) {
        const restoredBalance = Number(oldAccount.balance) + oldAmount
        await (supabaseServer
          .from('accounts') as any)
          .update({
            balance: restoredBalance,
            updated_at: getTaiwanTime()
          })
          .eq('id', oldAccountId)
      }
    }

    // 3. 更新 expense 記錄
    const { data, error } = await (supabaseServer
      .from('expenses') as any)
      .update({
        date: newExpense.date,
        category: newExpense.category,
        amount: newExpense.amount,
        account_id: newExpense.account_id || null,
        note: newExpense.note || null,
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    // 4. 重新記帳（使用 updateAccountBalance 確保一致性和冪等性）
    if (newAccountId) {
      const result = await updateAccountBalance({
        supabase: supabaseServer,
        accountId: newAccountId,
        amount: newAmount,
        direction: 'decrease',
        transactionType: 'expense',
        referenceId: id,
        note: newExpense.note || undefined
      })

      if (!result.success) {
        console.error(`[Expenses API] 費用 ${id} 記帳失敗:`, result.error)
        // 不返回錯誤，因為 expense 記錄已經更新成功
      } else if (result.warning) {
        console.log(`[Expenses API] ${result.warning}`)
      }
    }

    return NextResponse.json({ ok: true, data })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}

// DELETE /api/expenses/:id - Delete expense
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params

    // 先讀取 expense 資料（用於還原帳戶餘額）
    const { data: expense, error: fetchError } = await (supabaseServer
      .from('expenses') as any)
      .select('account_id, amount, note')
      .eq('id', id)
      .single()

    if (fetchError) {
      return NextResponse.json(
        { ok: false, error: '找不到費用記錄' },
        { status: 404 }
      )
    }

    // 如果有關聯帳戶，先還原餘額（在刪除 expense 之前）
    if (expense.account_id) {
      // 1. 刪除對應的 account_transactions 記錄
      await (supabaseServer
        .from('account_transactions') as any)
        .delete()
        .eq('ref_type', 'expense')
        .eq('ref_id', id)

      // 2. 直接反向更新帳戶餘額
      const { data: account } = await (supabaseServer
        .from('accounts') as any)
        .select('balance')
        .eq('id', expense.account_id)
        .single()

      if (account) {
        const newBalance = Number(account.balance) + expense.amount // 還原餘額

        const { error: updateError } = await (supabaseServer
          .from('accounts') as any)
          .update({
            balance: newBalance,
            updated_at: getTaiwanTime()
          })
          .eq('id', expense.account_id)

        if (updateError) {
          console.error(`[Expenses API] 刪除費用 ${id} 後還原帳戶餘額失敗:`, updateError)
        }
      }
    }

    // 刪除 expense
    const { error: deleteError } = await (supabaseServer
      .from('expenses') as any)
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
