import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { settlementSchema } from '@/lib/schemas'
import { fromZodError } from 'zod-validation-error'
import { updateAccountBalance } from '@/lib/account-service'
import { getTaiwanDateString } from '@/lib/timezone'

// POST /api/payments - Create payment (vendor payment)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Add direction for payment
    const data = {
      ...body,
      partner_type: 'vendor',
      direction: 'payment',
    }

    // Validate input
    const validation = settlementSchema.safeParse(data)
    if (!validation.success) {
      const error = fromZodError(validation.error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      )
    }

    const draft = validation.data

    // Verify total amount matches allocations
    const allocationsTotal = draft.allocations.reduce((sum, a) => sum + a.amount, 0)
    if (Math.abs(allocationsTotal - draft.amount) > 0.01) {
      return NextResponse.json(
        { ok: false, error: 'Allocation total does not match settlement amount' },
        { status: 400 }
      )
    }

    // Verify all accounts are AP
    for (const allocation of draft.allocations) {
      const { data: account } = await (supabaseServer
        .from('partner_accounts') as any)
        .select('direction, balance')
        .eq('id', allocation.partner_account_id)
        .single()

      if (!account) {
        return NextResponse.json(
          { ok: false, error: `Account not found: ${allocation.partner_account_id}` },
          { status: 400 }
        )
      }

      if (account.direction !== 'AP') {
        return NextResponse.json(
          { ok: false, error: 'Can only apply payments to AP accounts' },
          { status: 400 }
        )
      }

      if (allocation.amount > account.balance) {
        return NextResponse.json(
          { ok: false, error: `Allocation amount exceeds account balance` },
          { status: 400 }
        )
      }
    }

    // Create settlement（使用台灣時間）
    const { data: settlement, error: settlementError } = await (supabaseServer
      .from('settlements') as any)
      .insert({
        partner_type: draft.partner_type,
        partner_code: draft.partner_code,
        trans_date: getTaiwanDateString(),
        direction: draft.direction,
        method: draft.method || 'cash',
        amount: draft.amount,
        note: draft.note || null,
        account_id: draft.account_id || null,  // 儲存用戶選擇的帳戶
      })
      .select()
      .single()

    if (settlementError) {
      return NextResponse.json(
        { ok: false, error: settlementError.message },
        { status: 500 }
      )
    }

    // 更新帳戶餘額
    const accountId = draft.account_id || null
    const paymentMethod = draft.method || 'cash'

    const accountUpdate = await updateAccountBalance({
      supabase: supabaseServer,
      accountId,
      paymentMethod,
      amount: draft.amount,
      direction: 'decrease', // 付款 = 現金流出
      transactionType: 'purchase_payment', // 付款給供應商
      referenceId: settlement.id,
      note: draft.note
    })

    if (!accountUpdate.success && !accountUpdate.warning) {
      // 更新失敗，回滾 settlement
      await (supabaseServer.from('settlements') as any).delete().eq('id', settlement.id)
      return NextResponse.json(
        { ok: false, error: `更新帳戶失敗: ${accountUpdate.error}` },
        { status: 500 }
      )
    }

    // 儲存 account_id 到 settlement（如果是自動解析的）
    if (accountUpdate.accountId && !draft.account_id) {
      await (supabaseServer.from('settlements') as any)
        .update({ account_id: accountUpdate.accountId })
        .eq('id', settlement.id)
    }

    // Create allocations (trigger will handle updating partner_accounts)
    const { error: allocationsError } = await (supabaseServer
      .from('settlement_allocations') as any)
      .insert(
        draft.allocations.map((a) => ({
          settlement_id: settlement.id,
          partner_account_id: a.partner_account_id,
          amount: a.amount,
        }))
      )

    if (allocationsError) {
      // Rollback settlement
      await (supabaseServer.from('settlements') as any).delete().eq('id', settlement.id)
      return NextResponse.json(
        { ok: false, error: allocationsError.message },
        { status: 500 }
      )
    }

    // 檢查並更新進貨單的付款狀態
    // 找出這次付款涉及的所有進貨單
    const { data: paidAccounts } = await (supabaseServer
      .from('partner_accounts') as any)
      .select('ref_id, ref_type, status')
      .in('id', draft.allocations.map(a => a.partner_account_id))

    if (paidAccounts) {
      // 找出所有相關的進貨單 ID
      const purchaseIds = [...new Set(
        paidAccounts
          .filter((a: any) => a.ref_type === 'purchase')
          .map((a: any) => a.ref_id)
      )]

      // 對每個進貨單，檢查是否所有 AP 都已付清
      for (const purchaseId of purchaseIds) {
        const { data: remainingAP } = await (supabaseServer
          .from('partner_accounts') as any)
          .select('id, status')
          .eq('ref_type', 'purchase')
          .eq('ref_id', purchaseId)
          .neq('status', 'paid')

        // 如果沒有未付的 AP，更新進貨單為已付款
        if (!remainingAP || remainingAP.length === 0) {
          await (supabaseServer
            .from('purchases') as any)
            .update({ is_paid: true })
            .eq('id', purchaseId)
          console.log(`[Payment] Updated purchase ${purchaseId} to is_paid=true`)
        }
      }
    }

    return NextResponse.json({ ok: true, data: settlement }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
