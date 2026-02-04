import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// 從帳戶名稱產生付款方式代碼
function generatePaymentMethodCode(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w\u4e00-\u9fff]/g, '')
    .substring(0, 50)
}

// POST /api/accounts/fix-payment-codes - 修復沒有 payment_method_code 的帳戶
export async function POST() {
  try {
    // 取得所有沒有 payment_method_code 的帳戶
    const { data: accounts, error: fetchError } = await (supabaseServer
      .from('accounts') as any)
      .select('id, account_name, payment_method_code')
      .is('payment_method_code', null)

    if (fetchError) {
      return NextResponse.json(
        { ok: false, error: fetchError.message },
        { status: 500 }
      )
    }

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({
        ok: true,
        message: '沒有需要修復的帳戶',
        fixed: 0
      })
    }

    // 更新每個帳戶
    let fixed = 0
    for (const account of accounts) {
      const code = generatePaymentMethodCode(account.account_name)
      const { error: updateError } = await (supabaseServer
        .from('accounts') as any)
        .update({
          payment_method_code: code,
          display_name: account.account_name
        })
        .eq('id', account.id)

      if (!updateError) {
        fixed++
      }
    }

    return NextResponse.json({
      ok: true,
      message: `已修復 ${fixed} 個帳戶`,
      fixed
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
