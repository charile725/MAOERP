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
        { ok: false, error: '分配金額與付款金額不符' },
        { status: 400 }
      )
    }

    // Verify all accounts are AP（批次查詢優化）
    const accountIds = draft.allocations.map(a => a.partner_account_id)
    const { data: accounts } = await (supabaseServer
      .from('partner_accounts') as any)
      .select('id, direction, balance')
      .in('id', accountIds)

    const accountMap = new Map((accounts || []).map((a: any) => [a.id, a]))

    for (const allocation of draft.allocations) {
      const account = accountMap.get(allocation.partner_account_id) as { id: string; direction: string; balance: number } | undefined

      if (!account) {
        return NextResponse.json(
          { ok: false, error: `Account not found: ${allocation.partner_account_id}` },
          { status: 400 }
        )
      }

      if (account.direction !== 'AP') {
        return NextResponse.json(
          { ok: false, error: '只能沖銷應付帳款' },
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

    // Create allocations
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

    // ===== 手動更新 AP 記錄的 received_paid 和 status =====
    // （資料庫沒有 trigger 自動處理，需要在應用層更新）
    const purchaseIdsToCheck = new Set<string>()

    for (const allocation of draft.allocations) {
      const { data: ap } = await (supabaseServer
        .from('partner_accounts') as any)
        .select('id, amount, received_paid, ref_type, ref_id')
        .eq('id', allocation.partner_account_id)
        .single()

      if (!ap) continue

      const newReceivedPaid = (ap.received_paid || 0) + allocation.amount
      const newStatus = newReceivedPaid >= ap.amount ? 'paid' : newReceivedPaid > 0 ? 'partial' : 'unpaid'

      await (supabaseServer
        .from('partner_accounts') as any)
        .update({
          received_paid: newReceivedPaid,
          status: newStatus,
        })
        .eq('id', allocation.partner_account_id)

      if (ap.ref_type === 'purchase') {
        purchaseIdsToCheck.add(ap.ref_id)
      }
    }

    // ===== 檢查進貨單是否已全部付清，更新 is_paid =====
    for (const purchaseId of Array.from(purchaseIdsToCheck)) {
      const { data: purchaseAPs } = await (supabaseServer
        .from('partner_accounts') as any)
        .select('amount, received_paid')
        .eq('ref_type', 'purchase')
        .eq('ref_id', purchaseId)

      if (!purchaseAPs) continue

      const allPaid = purchaseAPs.every((ap: any) => ap.received_paid >= ap.amount)
      if (!allPaid) continue

      await (supabaseServer
        .from('purchases') as any)
        .update({ is_paid: true })
        .eq('id', purchaseId)
    }

    return NextResponse.json({ ok: true, data: settlement }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
