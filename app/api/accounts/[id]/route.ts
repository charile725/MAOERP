import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { accountUpdateSchema } from '@/lib/schemas'
import { fromZodError } from 'zod-validation-error'

// GET /api/accounts/[id] - 獲取單一帳戶
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { data, error } = await (supabaseServer.from('accounts') as any)
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
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

// PATCH /api/accounts/[id] - 更新帳戶
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    // 驗證輸入
    const validation = accountUpdateSchema.safeParse(body)
    if (!validation.success) {
      const error = fromZodError(validation.error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      )
    }

    const updates = validation.data

    // 如果更新帳戶名稱，檢查是否重複
    if (updates.account_name) {
      const { data: existing } = await (supabaseServer.from('accounts') as any)
        .select('id')
        .eq('account_name', updates.account_name)
        .neq('id', id)
        .single()

      if (existing) {
        return NextResponse.json(
          { ok: false, error: '帳戶名稱已存在' },
          { status: 400 }
        )
      }
    }

    // 更新帳戶
    const { data, error } = await (supabaseServer.from('accounts') as any)
      .update(updates)
      .eq('id', id)
      .select()
      .single()

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

// DELETE /api/accounts/[id] - 刪除帳戶
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    // 檢查是否有相關的費用記錄
    const { data: expenseCount } = await (supabaseServer.from('expenses') as any)
      .select('id', { count: 'exact', head: true })
      .eq('account_id', id)

    if (expenseCount && (expenseCount as any).count > 0) {
      return NextResponse.json(
        { ok: false, error: '此帳戶有關聯的費用記錄，無法刪除' },
        { status: 400 }
      )
    }

    const { error } = await (supabaseServer.from('accounts') as any)
      .delete()
      .eq('id', id)

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
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
