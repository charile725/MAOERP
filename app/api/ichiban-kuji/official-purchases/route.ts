import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { updateAccountBalance } from '@/lib/account-service'
import { getTaiwanTime, getTaiwanDateString } from '@/lib/timezone'

// GET /api/ichiban-kuji/official-purchases
export async function GET(request: NextRequest) {
  try {
    await requireRole('admin')

    // 查詢所有官方套
    const { data: kujis, error } = await (supabaseServer
      .from('ichiban_kuji') as any)
      .select('id, name, total_cost, vendor_code, is_received, is_active, created_at, total_draws')
      .eq('set_type', 'official')
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    if (!kujis || kujis.length === 0) {
      return NextResponse.json({ ok: true, data: [] })
    }

    // 查詢對應的 AP 狀態
    const kujiIds = kujis.map((k: any) => k.id)
    const { data: apRecords } = await (supabaseServer
      .from('partner_accounts') as any)
      .select('ref_id, status, id, amount, received_paid')
      .eq('ref_type', 'ichiban_kuji')
      .in('ref_id', kujiIds)

    const apMap = new Map<string, any>()
    for (const ap of apRecords || []) {
      apMap.set(ap.ref_id, ap)
    }

    // 查詢廠商名稱
    const vendorCodes = [...new Set(kujis.map((k: any) => k.vendor_code).filter(Boolean))]
    let vendorMap = new Map<string, string>()
    if (vendorCodes.length > 0) {
      const { data: vendors } = await (supabaseServer
        .from('vendors') as any)
        .select('vendor_code, vendor_name')
        .in('vendor_code', vendorCodes)

      for (const v of vendors || []) {
        vendorMap.set(v.vendor_code, v.vendor_name)
      }
    }

    const result = kujis.map((k: any) => {
      const ap = apMap.get(k.id)
      return {
        id: k.id,
        name: k.name,
        total_cost: k.total_cost || 0,
        vendor_code: k.vendor_code || '',
        vendor_name: vendorMap.get(k.vendor_code) || k.vendor_code || '-',
        is_received: k.is_received !== false,
        is_active: k.is_active,
        created_at: k.created_at,
        total_draws: k.total_draws || 0,
        ap_status: ap?.status || undefined,
        ap_id: ap?.id || undefined,
        ap_amount: ap?.amount || 0,
        ap_paid: ap?.received_paid || 0,
      }
    })

    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    return NextResponse.json({ ok: false, error: '系統錯誤' }, { status: 500 })
  }
}

// POST /api/ichiban-kuji/official-purchases - 付款
export async function POST(request: NextRequest) {
  try {
    await requireRole('admin')

    const body = await request.json()
    const { kuji_id, account_id, amount, note } = body

    if (!kuji_id || !account_id || !amount || amount <= 0) {
      return NextResponse.json(
        { ok: false, error: '請提供一番賞ID、帳戶ID和正確金額' },
        { status: 400 }
      )
    }

    // 查詢一番賞
    const { data: kuji, error: kujiError } = await (supabaseServer
      .from('ichiban_kuji') as any)
      .select('id, name, vendor_code, total_cost, set_type')
      .eq('id', kuji_id)
      .single()

    if (kujiError || !kuji) {
      return NextResponse.json({ ok: false, error: '找不到一番賞' }, { status: 404 })
    }

    if (kuji.set_type !== 'official') {
      return NextResponse.json({ ok: false, error: '只有官方賞可以付款' }, { status: 400 })
    }

    // 查詢對應的 AP
    const { data: ap, error: apError } = await (supabaseServer
      .from('partner_accounts') as any)
      .select('id, amount, received_paid, status')
      .eq('ref_type', 'ichiban_kuji')
      .eq('ref_id', kuji_id)
      .single()

    if (apError || !ap) {
      return NextResponse.json({ ok: false, error: '找不到對應的應付帳款' }, { status: 404 })
    }

    const remaining = ap.amount - (ap.received_paid || 0)
    if (amount > remaining + 0.01) {
      return NextResponse.json(
        { ok: false, error: `付款金額 ${amount} 超過未付餘額 ${remaining}` },
        { status: 400 }
      )
    }

    const payAmount = Math.min(amount, remaining)

    // 1. 建立 settlement
    const { data: settlement, error: stlError } = await (supabaseServer
      .from('settlements') as any)
      .insert({
        partner_type: 'vendor',
        partner_code: kuji.vendor_code,
        trans_date: getTaiwanDateString(),
        direction: 'payment',
        method: 'transfer',
        amount: payAmount,
        account_id: account_id,
        note: note || `官方賞付款 - ${kuji.name}`,
      })
      .select()
      .single()

    if (stlError || !settlement) {
      return NextResponse.json(
        { ok: false, error: `建立付款紀錄失敗: ${stlError?.message}` },
        { status: 500 }
      )
    }

    // 2. 建立 settlement_allocation
    const { error: allocError } = await (supabaseServer
      .from('settlement_allocations') as any)
      .insert({
        settlement_id: settlement.id,
        partner_account_id: ap.id,
        amount: payAmount,
      })

    if (allocError) {
      return NextResponse.json(
        { ok: false, error: `建立分配紀錄失敗: ${allocError.message}` },
        { status: 500 }
      )
    }

    // 3. 更新 AP 狀態
    const newReceivedPaid = (ap.received_paid || 0) + payAmount
    const newStatus = newReceivedPaid >= ap.amount ? 'paid' : 'partial'

    await (supabaseServer
      .from('partner_accounts') as any)
      .update({
        received_paid: newReceivedPaid,
        status: newStatus,
      })
      .eq('id', ap.id)

    // 4. 更新帳戶餘額 + 寫入交易明細
    const accountResult = await updateAccountBalance({
      supabase: supabaseServer,
      accountId: account_id,
      amount: payAmount,
      direction: 'decrease',
      transactionType: 'purchase_payment',
      referenceId: settlement.id,
      referenceNo: kuji.name,
      note: note || `官方賞付款 - ${kuji.name}`,
    })

    if (!accountResult.success && accountResult.error) {
      return NextResponse.json(
        { ok: false, error: `帳戶更新失敗: ${accountResult.error}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      data: {
        settlement_id: settlement.id,
        paid_amount: payAmount,
        ap_status: newStatus,
        account_warning: accountResult.warning,
      }
    })
  } catch (error) {
    return NextResponse.json({ ok: false, error: '系統錯誤' }, { status: 500 })
  }
}
