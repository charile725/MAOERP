import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { getTaiwanDateString } from '@/lib/timezone'

// Helper function to calculate days since a date
function daysSince(dateString: string): number {
  const date = new Date(dateString)
  const today = new Date()
  const diffTime = today.getTime() - date.getTime()
  return Math.floor(diffTime / (1000 * 60 * 60 * 24))
}

// GET /api/finance/dashboard?date=YYYY-MM-DD - 獲取財務總覽數據（date 不給就是今天）
export async function GET(request: NextRequest) {
  try {
    // 一律用台灣日期：Vercel 跑在 UTC，直接 new Date() 會讓台灣時間早上 8 點前算成前一天
    const today = getTaiwanDateString()

    // 現金流可以指定要看哪一天；格式不對就退回今天，不要讓亂填的參數把查詢打壞
    const requestedDate = request.nextUrl.searchParams.get('date')
    const targetDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
      ? requestedDate
      : today

    // 1. 獲取所有帳戶及其餘額
    const { data: accounts, error: accountsError } = await (supabaseServer
      .from('accounts') as any)
      .select('*')
      .eq('is_active', true)
      .order('account_type', { ascending: true })
      .order('account_name', { ascending: true })

    if (accountsError) {
      return NextResponse.json(
        { ok: false, error: accountsError.message },
        { status: 500 }
      )
    }

    // 2. 計算指定日期的支出
    const { data: todayExpenses, error: expensesError } = await (supabaseServer
      .from('expenses') as any)
      .select('amount, account_id')
      .eq('date', targetDate)

    if (expensesError) {
      return NextResponse.json(
        { ok: false, error: expensesError.message },
        { status: 500 }
      )
    }

    const todayExpensesTotal = todayExpenses?.reduce(
      (sum: number, exp: any) => sum + exp.amount,
      0
    ) || 0

    // 3. 計算指定日期的銷售收入
    const { data: todaySales, error: salesError } = await (supabaseServer
      .from('sales') as any)
      .select('total, payment_method, account_id, is_paid')
      .gte('sale_date', targetDate)
      .lte('sale_date', targetDate + 'T23:59:59')
      .eq('is_paid', true)

    const todaySalesTotal = salesError ? 0 : (todaySales?.reduce(
      (sum: number, sale: any) => sum + sale.total,
      0
    ) || 0)

    // 4. 按帳戶類型分組
    const accountsByType = {
      cash: accounts?.filter((a: any) => a.account_type === 'cash') || [],
      bank: accounts?.filter((a: any) => a.account_type === 'bank') || [],
      petty_cash: accounts?.filter((a: any) => a.account_type === 'petty_cash') || [],
    }

    // 5. 計算各類型總額
    const totals = {
      cash: accountsByType.cash.reduce((sum: number, a: any) => sum + a.balance, 0),
      bank: accountsByType.bank.reduce((sum: number, a: any) => sum + a.balance, 0),
      petty_cash: accountsByType.petty_cash.reduce((sum: number, a: any) => sum + a.balance, 0),
      total: accounts?.reduce((sum: number, a: any) => sum + a.balance, 0) || 0,
    }

    // 6. 當日淨現金流
    const todayNetCashFlow = todaySalesTotal - todayExpensesTotal

    // 7. 當日各帳戶支出統計
    const todayExpensesByAccount = todayExpenses?.reduce((acc: any, exp: any) => {
      if (exp.account_id) {
        acc[exp.account_id] = (acc[exp.account_id] || 0) + exp.amount
      }
      return acc
    }, {}) || {}

    // 8. 當日各帳戶收入統計
    const todaySalesByAccount = todaySales?.reduce((acc: any, sale: any) => {
      if (sale.account_id) {
        acc[sale.account_id] = (acc[sale.account_id] || 0) + sale.total
      }
      return acc
    }, {}) || {}

    // ========== 新增：AR 帳齡分析 ==========
    const { data: arAccounts } = await supabaseServer
      .from('partner_accounts')
      .select('balance, due_date, partner_code')
      .eq('partner_type', 'customer')
      .eq('direction', 'AR')
      .neq('status', 'paid')

    const arAging = {
      current: 0,      // 0-30 天
      days31_60: 0,    // 31-60 天
      days61_90: 0,    // 61-90 天
      over90: 0,       // 90 天以上
      total: 0
    }

    const arOverdueList: Array<{ partner_code: string; balance: number; days_overdue: number }> = []

      ; (arAccounts as any[])?.forEach(ar => {
        const daysOverdue = daysSince(ar.due_date)
        arAging.total += ar.balance

        if (daysOverdue <= 0) {
          arAging.current += ar.balance
        } else if (daysOverdue <= 30) {
          arAging.current += ar.balance
        } else if (daysOverdue <= 60) {
          arAging.days31_60 += ar.balance
        } else if (daysOverdue <= 90) {
          arAging.days61_90 += ar.balance
        } else {
          arAging.over90 += ar.balance
        }

        // 逾期清單（只列已逾期的）
        if (daysOverdue > 0) {
          arOverdueList.push({
            partner_code: ar.partner_code,
            balance: ar.balance,
            days_overdue: daysOverdue
          })
        }
      })

    // 排序逾期清單（逾期天數最多的排前面）
    arOverdueList.sort((a, b) => b.days_overdue - a.days_overdue)

    // ========== 新增：庫存總金額 ==========
    const { data: products } = await supabaseServer
      .from('products')
      .select('stock, avg_cost')
      .eq('is_active', true)

    const inventoryValue = (products as any[])?.reduce(
      (sum, p) => sum + (p.stock * (p.avg_cost || 0)),
      0
    ) || 0

    const inventoryCount = (products as any[])?.reduce(
      (sum, p) => sum + p.stock,
      0
    ) || 0

    // ========== 新增：近7天毛利率趨勢（優化：單次查詢）==========
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0]

    const { data: weekSales } = await (supabaseServer
      .from('sales') as any)
      .select('total, subtotal, sale_date, sale_items(cost, quantity, price, store_credit_qty, store_credit_amount)')
      .gte('sale_date', sevenDaysAgoStr)
      .lte('sale_date', today + 'T23:59:59')
      .eq('status', 'confirmed')

    // 在 JavaScript 中分組計算每日毛利率
    const dailyStats: Record<string, { revenue: number; cost: number }> = {}

    // 初始化最近 7 天
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      dailyStats[dateStr] = { revenue: 0, cost: 0 }
    }

    // 分組統計
    ; (weekSales as any[])?.forEach(sale => {
      const saleDate = sale.sale_date.split('T')[0]
      if (dailyStats[saleDate]) {
        // 使用 subtotal (Gross Sales) 計算營收，若無則從 sale_items 計算
        const grossSales = sale.subtotal || (sale.sale_items || []).reduce(
          (sum: number, item: any) => sum + (item.price * item.quantity), 0
        )
        dailyStats[saleDate].revenue += grossSales
        // 扣除已轉購物金的數量，並加上購物金轉換金額作為成本
        const saleCost = (sale.sale_items || []).reduce(
          (sum: number, item: any) => {
            const effectiveQty = item.quantity - (item.store_credit_qty || 0)
            return sum + (item.cost || 0) * effectiveQty + (item.store_credit_amount || 0)
          },
          0
        )
        dailyStats[saleDate].cost += saleCost
      }
    })

    const profitTrend = Object.entries(dailyStats).map(([date, stats]) => {
      const grossProfit = stats.revenue - stats.cost
      const grossMargin = stats.revenue > 0 ? (grossProfit / stats.revenue) * 100 : 0
      return {
        date,
        revenue: stats.revenue,
        cost: stats.cost,
        grossProfit,
        grossMargin: Math.round(grossMargin * 10) / 10
      }
    })

    return NextResponse.json({
      ok: true,
      data: {
        accounts: accountsByType,
        totals,
        date: targetDate,
        today: {
          sales: todaySalesTotal,
          expenses: todayExpensesTotal,
          netCashFlow: todayNetCashFlow,
          expensesByAccount: todayExpensesByAccount,
          salesByAccount: todaySalesByAccount,
        },
        // 新增數據
        arAging,
        arOverdueList: arOverdueList.slice(0, 10), // 前10筆
        inventory: {
          totalValue: inventoryValue,
          totalQuantity: inventoryCount
        },
        profitTrend,
      },
    })
  } catch (error) {
    console.error('Finance dashboard error:', error)
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
