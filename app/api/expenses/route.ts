import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { expenseSchema } from '@/lib/schemas'
import { fromZodError } from 'zod-validation-error'
import { updateAccountBalance } from '@/lib/account-service'

// GET /api/expenses - List all expenses
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const category = searchParams.get('category')
    const accountId = searchParams.get('account_id')
    const dateFrom = searchParams.get('date_from')
    const dateTo = searchParams.get('date_to')

    let query = (supabaseServer
      .from('expenses') as any)
      .select(`
        *,
        accounts:account_id (
          id,
          account_name,
          account_type,
          balance
        )
      `)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })

    if (category) {
      query = query.eq('category', category)
    }

    if (accountId) {
      query = query.eq('account_id', accountId)
    }

    if (dateFrom) {
      query = query.gte('date', dateFrom)
    }

    if (dateTo) {
      query = query.lte('date', dateTo)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
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

// POST /api/expenses - Create new expense
export async function POST(request: NextRequest) {
  try {
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

    const expense = validation.data

    // 取得台灣時間 (UTC+8)
    const now = new Date()
    const taiwanTime = new Date(now.getTime() + 8 * 60 * 60 * 1000)

    // Insert expense
    const { data, error } = await (supabaseServer
      .from('expenses') as any)
      .insert({
        date: expense.date,
        category: expense.category,
        amount: expense.amount,
        account_id: expense.account_id || null,
        note: expense.note || null,
        created_at: taiwanTime.toISOString(),
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    // 更新帳戶餘額（如果有指定帳戶）
    if (data.account_id) {
      const accountUpdate = await updateAccountBalance({
        supabase: supabaseServer,
        accountId: data.account_id,
        amount: data.amount,
        direction: 'decrease', // 費用 = 現金流出
        transactionType: 'expense',
        referenceId: data.id.toString(),
        note: data.note
      })

      if (!accountUpdate.success) {
        console.error(`[Expenses API] 費用 ${data.id} 更新帳戶餘額失敗:`, accountUpdate.error)
        // 回滾 expense（費用記錄需精準）
        await (supabaseServer.from('expenses') as any).delete().eq('id', data.id)
        return NextResponse.json(
          { ok: false, error: `更新帳戶失敗: ${accountUpdate.error}` },
          { status: 500 }
        )
      }
    }

    return NextResponse.json(
      { ok: true, data },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
