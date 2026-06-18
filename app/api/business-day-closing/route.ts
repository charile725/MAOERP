import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// 取得台灣日期 YYYY-MM-DD
function getTaiwanDate(): string {
  const now = new Date()
  const taiwanTime = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return taiwanTime.toISOString().split('T')[0]
}

// GET /api/business-day-closing - 獲取指定營業日統計，或列出所有日結記錄
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const source = searchParams.get('source') || 'pos'
    const list = searchParams.get('list') === 'true'
    const businessDate = searchParams.get('business_date') || getTaiwanDate()

    if (source !== 'pos' && source !== 'live') {
      return NextResponse.json(
        { ok: false, error: '來源參數無效，必須是 "pos" 或 "live"' },
        { status: 400 }
      )
    }

    // 如果是列表模式，返回所有日結記錄
    if (list) {
      const { data: closings, error } = await (supabaseServer
        .from('business_day_closings') as any)
        .select('*')
        .eq('source', source)
        .order('business_date', { ascending: false })
        .limit(50)

      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 500 }
        )
      }

      return NextResponse.json({
        ok: true,
        data: closings || [],
      })
    }

    // 1. 檢查該營業日是否已日結
    const { data: existingClosing } = await (supabaseServer
      .from('business_day_closings') as any)
      .select('id, business_date, closing_time')
      .eq('source', source)
      .eq('business_date', businessDate)
      .single()

    const alreadyClosed = !!existingClosing

    // 2. 計算該營業日的銷售統計（用 sale_date 查詢）
    const { data: sales, error: salesError } = await (supabaseServer
      .from('sales') as any)
      .select('id, total, payment_method, account_id, is_paid, source, sale_no, created_at, store_credit_used')
      .eq('sale_date', businessDate)
      .eq('source', source)
      .eq('status', 'confirmed')

    if (salesError) {
      console.error('[日結 GET] 查詢錯誤:', salesError)
      return NextResponse.json(
        { ok: false, error: salesError.message },
        { status: 500 }
      )
    }

    // 2.5 查詢轉購物金的銷售（用於計算假營業額）
    const { data: storeCreditSales } = await (supabaseServer
      .from('sales') as any)
      .select('id, total, sale_no, created_at')
      .eq('sale_date', businessDate)
      .eq('source', source)
      .eq('status', 'store_credit')

    let storeCreditOriginalTotal = 0
    if (storeCreditSales && storeCreditSales.length > 0) {
      const saleIds = storeCreditSales.map((s: any) => s.id)
      const { data: corrections } = await (supabaseServer
        .from('sale_corrections') as any)
        .select('sale_id, original_total, store_credit_granted')
        .in('sale_id', saleIds)
        .eq('correction_type', 'to_store_credit')

      if (corrections) {
        storeCreditOriginalTotal = corrections.reduce((sum: number, c: any) => sum + (c.original_total || 0), 0)
      }
    }

    // 3. 統計各種付款方式
    const stats = {
      sales_count: sales?.length || 0,
      total_sales: 0,
      total_cash: 0,
      total_card: 0,
      total_transfer: 0,
      total_cod: 0,
      fake_total_sales: 0,
      store_credit_converted: storeCreditOriginalTotal,
      store_credit_count: storeCreditSales?.length || 0,
      store_credit_used: 0,
      store_credit_granted: 0,
      paid_count: 0,
      paid_sales: 0,
      paid_cash: 0,
      paid_card: 0,
      paid_transfer: 0,
      paid_cod: 0,
      unpaid_count: 0,
      unpaid_sales: 0,
      unpaid_cash: 0,
      unpaid_card: 0,
      unpaid_transfer: 0,
      unpaid_cod: 0,
      sales_by_account: {} as { [key: string]: number },
    }

    sales?.forEach((sale: any) => {
      stats.total_sales += sale.total
      stats.store_credit_used += sale.store_credit_used || 0

      if (sale.payment_method === 'cash') {
        stats.total_cash += sale.total
      } else if (sale.payment_method === 'card') {
        stats.total_card += sale.total
      } else if (sale.payment_method === 'cod') {
        stats.total_cod += sale.total
      } else if (sale.payment_method.startsWith('transfer_')) {
        stats.total_transfer += sale.total
      }

      if (sale.is_paid) {
        stats.paid_count += 1
        stats.paid_sales += sale.total

        if (sale.payment_method === 'cash') {
          stats.paid_cash += sale.total
        } else if (sale.payment_method === 'card') {
          stats.paid_card += sale.total
        } else if (sale.payment_method === 'cod') {
          stats.paid_cod += sale.total
        } else if (sale.payment_method.startsWith('transfer_')) {
          stats.paid_transfer += sale.total
        }
      } else {
        stats.unpaid_count += 1
        stats.unpaid_sales += sale.total

        if (sale.payment_method === 'cash') {
          stats.unpaid_cash += sale.total
        } else if (sale.payment_method === 'card') {
          stats.unpaid_card += sale.total
        } else if (sale.payment_method === 'cod') {
          stats.unpaid_cod += sale.total
        } else if (sale.payment_method.startsWith('transfer_')) {
          stats.unpaid_transfer += sale.total
        }
      }
    })

    stats.fake_total_sales = stats.total_sales + storeCreditOriginalTotal

    // 帳戶明細：從 account_transactions 取，fallback 到 sale.account_id
    const saleIds = (sales || []).map((s: any) => s.id)
    const coveredSaleIds = new Set<string>()

    if (saleIds.length > 0) {
      const { data: txns } = await (supabaseServer
        .from('account_transactions') as any)
        .select('account_id, amount, ref_id')
        .in('ref_id', saleIds)
        .eq('transaction_type', 'sale')
        .eq('ref_type', 'sale')

      txns?.forEach((t: any) => {
        if (t.account_id && t.ref_id) {
          stats.sales_by_account[t.account_id] = (stats.sales_by_account[t.account_id] || 0) + t.amount
          coveredSaleIds.add(t.ref_id)
        }
      })

      // 補充：AR 收款（customer_payment）金額
      const { data: arAccounts } = await (supabaseServer
        .from('partner_accounts') as any)
        .select('id')
        .in('ref_id', saleIds)
        .eq('ref_type', 'sale')
        .eq('direction', 'AR')

      const paIds = (arAccounts || []).map((a: any) => a.id as string)
      if (paIds.length > 0) {
        const { data: allocations } = await (supabaseServer
          .from('settlement_allocations') as any)
          .select('settlement_id, amount')
          .in('partner_account_id', paIds)

        const allocSettlementIds = [...new Set((allocations || []).map((a: any) => a.settlement_id as string))]
        if (allocSettlementIds.length > 0) {
          const { data: receiptTxns } = await (supabaseServer
            .from('account_transactions') as any)
            .select('ref_id, account_id')
            .in('ref_id', allocSettlementIds)
            .eq('transaction_type', 'customer_payment')

          const settlementAccountMap = new Map<string, string>(
            (receiptTxns || []).map((t: any) => [t.ref_id as string, t.account_id as string])
          )

          ;(allocations || []).forEach((alloc: any) => {
            const accountId = settlementAccountMap.get(alloc.settlement_id)
            if (accountId && alloc.amount) {
              stats.sales_by_account[accountId] = (stats.sales_by_account[accountId] || 0) + alloc.amount
            }
          })
        }
      }
    }

    // Fallback：有 account_id 但無 account_transactions 的已收款銷售
    ;(sales || []).forEach((sale: any) => {
      if (sale.is_paid && sale.account_id && !coveredSaleIds.has(sale.id)) {
        stats.sales_by_account[sale.account_id] = (stats.sales_by_account[sale.account_id] || 0) + sale.total
      }
    })

    // 補足差額：已收款但無法對應帳戶的部分
    const trackedTotalGet = Object.values(stats.sales_by_account).reduce((s: number, v) => s + (v as number), 0)
    const gapGet = Math.round((stats.paid_sales - trackedTotalGet) * 100) / 100
    if (gapGet > 0.01) {
      stats.sales_by_account['__untracked__'] = gapGet
    }

    // 計算購物金轉出（查詢該營業日所有銷售的 sale_corrections，不限 status）
    const { data: allDaySales } = await (supabaseServer
      .from('sales') as any)
      .select('id')
      .eq('sale_date', businessDate)
      .eq('source', source)

    if (allDaySales && allDaySales.length > 0) {
      const allDaySaleIds = allDaySales.map((s: any) => s.id)
      const { data: scCorrections } = await (supabaseServer
        .from('sale_corrections') as any)
        .select('store_credit_granted')
        .in('sale_id', allDaySaleIds)
        .eq('correction_type', 'to_store_credit')

      if (scCorrections) {
        stats.store_credit_granted = scCorrections.reduce(
          (sum: number, c: any) => sum + (c.store_credit_granted || 0), 0
        )
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        business_date: businessDate,
        already_closed: alreadyClosed,
        current_stats: stats,
      },
    })
  } catch (error) {
    console.error('Business day closing GET error:', error)
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}

// POST /api/business-day-closing - 執行日結
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { source, note, business_date } = body

    if (!source || (source !== 'pos' && source !== 'live')) {
      return NextResponse.json(
        { ok: false, error: '來源參數無效，必須是 "pos" 或 "live"' },
        { status: 400 }
      )
    }

    const businessDate = business_date || getTaiwanDate()

    // 1. 檢查是否已日結
    const { data: existingClosing } = await (supabaseServer
      .from('business_day_closings') as any)
      .select('id')
      .eq('source', source)
      .eq('business_date', businessDate)
      .single()

    if (existingClosing) {
      return NextResponse.json(
        { ok: false, error: `${businessDate} 已經日結過了，無法重複日結` },
        { status: 409 }
      )
    }

    // 2. 計算該營業日銷售統計（用 sale_date 查詢）
    const { data: sales, error: salesError } = await (supabaseServer
      .from('sales') as any)
      .select('total, payment_method, account_id, is_paid, source, sale_no, created_at')
      .eq('sale_date', businessDate)
      .eq('source', source)
      .eq('status', 'confirmed')
      .gt('total', 0)

    if (salesError) {
      console.error('[日結 POST] 查詢錯誤:', salesError)
      return NextResponse.json(
        { ok: false, error: salesError.message },
        { status: 500 }
      )
    }

    // 3. 統計各種付款方式
    const stats = {
      sales_count: sales?.length || 0,
      total_sales: 0,
      total_cash: 0,
      total_card: 0,
      total_transfer: 0,
      total_cod: 0,
      paid_count: 0,
      paid_sales: 0,
      paid_cash: 0,
      paid_card: 0,
      paid_transfer: 0,
      paid_cod: 0,
      unpaid_count: 0,
      unpaid_sales: 0,
      unpaid_cash: 0,
      unpaid_card: 0,
      unpaid_transfer: 0,
      unpaid_cod: 0,
      sales_by_account: {} as { [key: string]: number },
    }

    sales?.forEach((sale: any) => {
      stats.total_sales += sale.total

      if (sale.payment_method === 'cash') {
        stats.total_cash += sale.total
      } else if (sale.payment_method === 'card') {
        stats.total_card += sale.total
      } else if (sale.payment_method === 'cod') {
        stats.total_cod += sale.total
      } else if (sale.payment_method.startsWith('transfer_')) {
        stats.total_transfer += sale.total
      }

      if (sale.is_paid) {
        stats.paid_count += 1
        stats.paid_sales += sale.total

        if (sale.payment_method === 'cash') {
          stats.paid_cash += sale.total
        } else if (sale.payment_method === 'card') {
          stats.paid_card += sale.total
        } else if (sale.payment_method === 'cod') {
          stats.paid_cod += sale.total
        } else if (sale.payment_method.startsWith('transfer_')) {
          stats.paid_transfer += sale.total
        }
      } else {
        stats.unpaid_count += 1
        stats.unpaid_sales += sale.total

        if (sale.payment_method === 'cash') {
          stats.unpaid_cash += sale.total
        } else if (sale.payment_method === 'card') {
          stats.unpaid_card += sale.total
        } else if (sale.payment_method === 'cod') {
          stats.unpaid_cod += sale.total
        } else if (sale.payment_method.startsWith('transfer_')) {
          stats.unpaid_transfer += sale.total
        }
      }
    })

    // 帳戶明細：從 account_transactions 取，fallback 到 sale.account_id
    const postSaleIds = (sales || []).map((s: any) => s.id)
    const postCoveredSaleIds = new Set<string>()

    if (postSaleIds.length > 0) {
      const { data: txns } = await (supabaseServer
        .from('account_transactions') as any)
        .select('account_id, amount, ref_id')
        .in('ref_id', postSaleIds)
        .eq('transaction_type', 'sale')
        .eq('ref_type', 'sale')

      txns?.forEach((t: any) => {
        if (t.account_id && t.ref_id) {
          stats.sales_by_account[t.account_id] = (stats.sales_by_account[t.account_id] || 0) + t.amount
          postCoveredSaleIds.add(t.ref_id)
        }
      })

      // 補充：AR 收款（customer_payment）金額
      const { data: arAccounts } = await (supabaseServer
        .from('partner_accounts') as any)
        .select('id')
        .in('ref_id', postSaleIds)
        .eq('ref_type', 'sale')
        .eq('direction', 'AR')

      const paIds = (arAccounts || []).map((a: any) => a.id as string)
      if (paIds.length > 0) {
        const { data: allocations } = await (supabaseServer
          .from('settlement_allocations') as any)
          .select('settlement_id, amount')
          .in('partner_account_id', paIds)

        const allocSettlementIds = [...new Set((allocations || []).map((a: any) => a.settlement_id as string))]
        if (allocSettlementIds.length > 0) {
          const { data: receiptTxns } = await (supabaseServer
            .from('account_transactions') as any)
            .select('ref_id, account_id')
            .in('ref_id', allocSettlementIds)
            .eq('transaction_type', 'customer_payment')

          const settlementAccountMap = new Map<string, string>(
            (receiptTxns || []).map((t: any) => [t.ref_id as string, t.account_id as string])
          )

          ;(allocations || []).forEach((alloc: any) => {
            const accountId = settlementAccountMap.get(alloc.settlement_id)
            if (accountId && alloc.amount) {
              stats.sales_by_account[accountId] = (stats.sales_by_account[accountId] || 0) + alloc.amount
            }
          })
        }
      }
    }

    // Fallback：有 account_id 但無 account_transactions 的已收款銷售
    ;(sales || []).forEach((sale: any) => {
      if (sale.is_paid && sale.account_id && !postCoveredSaleIds.has(sale.id)) {
        stats.sales_by_account[sale.account_id] = (stats.sales_by_account[sale.account_id] || 0) + sale.total
      }
    })

    // 補足差額：已收款但無法對應帳戶的部分
    const trackedTotalPost = Object.values(stats.sales_by_account).reduce((s: number, v) => s + (v as number), 0)
    const gapPost = Math.round((stats.paid_sales - trackedTotalPost) * 100) / 100
    if (gapPost > 0.01) {
      stats.sales_by_account['__untracked__'] = gapPost
    }

    // 4. 插入日結記錄
    const now = new Date()
    const taiwanTime = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    const closingTime = taiwanTime.toISOString()

    const { data: closing, error: closingError } = await (supabaseServer
      .from('business_day_closings') as any)
      .insert({
        source: source,
        closing_time: closingTime,
        business_date: businessDate,
        sales_count: stats.sales_count,
        total_sales: stats.total_sales,
        total_cash: stats.total_cash,
        total_card: stats.total_card,
        total_transfer: stats.total_transfer,
        total_cod: stats.total_cod,
        paid_count: stats.paid_count,
        paid_sales: stats.paid_sales,
        paid_cash: stats.paid_cash,
        paid_card: stats.paid_card,
        paid_transfer: stats.paid_transfer,
        paid_cod: stats.paid_cod,
        unpaid_count: stats.unpaid_count,
        unpaid_sales: stats.unpaid_sales,
        unpaid_cash: stats.unpaid_cash,
        unpaid_card: stats.unpaid_card,
        unpaid_transfer: stats.unpaid_transfer,
        unpaid_cod: stats.unpaid_cod,
        sales_by_account: stats.sales_by_account,
        note: note || null,
      })
      .select()
      .single()

    if (closingError) {
      // 可能是 unique constraint violation
      if (closingError.code === '23505') {
        return NextResponse.json(
          { ok: false, error: `${businessDate} 已經日結過了，無法重複日結` },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { ok: false, error: closingError.message },
        { status: 500 }
      )
    }

    // 5. 日結成功後，更新當前營業日為下一天
    const nextBusinessDate = new Date(businessDate)
    nextBusinessDate.setDate(nextBusinessDate.getDate() + 1)
    const nextDateStr = nextBusinessDate.toISOString().split('T')[0]

    const { error: updateError } = await (supabaseServer
      .from('business_day_settings') as any)
      .upsert({
        source: source,
        current_business_date: nextDateStr,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'source'
      })

    if (updateError) {
      console.warn('[日結] 更新營業日設定失敗:', updateError.message)
      // 不影響日結結果，只記錄警告
    }

    return NextResponse.json(
      {
        ok: true,
        data: closing,
        next_business_date: nextDateStr
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Business day closing POST error:', error)
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
