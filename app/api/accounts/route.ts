import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { accountSchema } from '@/lib/schemas'
import { fromZodError } from 'zod-validation-error'
import { getTaiwanTime } from '@/lib/timezone'

// GET /api/accounts - 獲取所有帳戶
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const activeOnly = searchParams.get('active_only') === 'true'

    let query = (supabaseServer.from('accounts') as any)
      .select('*')
      .order('sort_order', { ascending: true })
      .order('account_name', { ascending: true })

    if (activeOnly) {
      query = query.eq('is_active', true)
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

// 從帳戶名稱產生付款方式代碼
function generatePaymentMethodCode(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '_')           // 空白換成底線
    .replace(/[^\w\u4e00-\u9fff]/g, '') // 只保留字母數字底線和中文
    .substring(0, 50)               // 限制長度
}

// POST /api/accounts - 新增帳戶
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // 驗證輸入
    const validation = accountSchema.safeParse(body)
    if (!validation.success) {
      const error = fromZodError(validation.error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      )
    }

    const account = validation.data

    // 檢查帳戶名稱是否重複
    const { data: existing } = await (supabaseServer.from('accounts') as any)
      .select('id')
      .eq('account_name', account.account_name)
      .single()

    if (existing) {
      return NextResponse.json(
        { ok: false, error: '帳戶名稱已存在' },
        { status: 400 }
      )
    }

    // 自動產生 payment_method_code（如果沒有提供）
    const paymentMethodCode = body.payment_method_code || generatePaymentMethodCode(account.account_name)

    // 新增帳戶（使用台灣時間）
    const { data, error } = await (supabaseServer.from('accounts') as any)
      .insert({
        account_name: account.account_name,
        account_type: account.account_type,
        payment_method_code: paymentMethodCode,
        display_name: body.display_name || account.account_name,
        sort_order: body.sort_order ?? 999,
        auto_mark_paid: body.auto_mark_paid ?? false,
        // Balance is always 0 on creation now. Adjustments must be made via transaction.
        balance: 0,
        is_active: account.is_active !== false,
        created_at: getTaiwanTime(),
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, data }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
