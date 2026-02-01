import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// GET /api/customers/profit - Get profit/loss for all customers
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const dateFrom = searchParams.get('date_from')
    const dateTo = searchParams.get('date_to')

    // 直接查询
    let query = (supabaseServer
      .from('sales') as any)
      .select(`
        customer_code,
        total,
        subtotal,
        sale_date,
        sale_items (
          quantity,
          price,
          cost,
          store_credit_qty
        )
      `)
      .not('customer_code', 'is', null)

    // 添加日期筛选
    if (dateFrom) {
      query = query.gte('sale_date', dateFrom)
    }
    if (dateTo) {
      query = query.lte('sale_date', dateTo)
    }

    const { data: salesData, error: salesError } = await query

    if (salesError) {
      console.error('[Customers Profit API] Error:', salesError)
      return NextResponse.json({ ok: false, error: salesError.message }, { status: 500 })
    }

    // 按客户汇总
    const customerStats: Record<string, {
      total_sales: number
      total_cost: number
      order_count: number
    }> = {}

    for (const sale of salesData || []) {
      const code = sale.customer_code
      if (!code) continue

      if (!customerStats[code]) {
        customerStats[code] = { total_sales: 0, total_cost: 0, order_count: 0 }
      }

      // 使用 Gross Sales (subtotal) 計算營收
      const grossSales = sale.subtotal || (sale.sale_items || []).reduce(
        (sum: number, item: any) => sum + (item.price || 0) * (item.quantity || 0), 0
      )
      customerStats[code].total_sales += grossSales
      customerStats[code].order_count += 1

      // 计算成本（扣除已轉購物金的數量）
      for (const item of sale.sale_items || []) {
        const effectiveQty = (item.quantity || 0) - (item.store_credit_qty || 0)
        customerStats[code].total_cost += (item.cost || 0) * effectiveQty
      }
    }

    // 转换为数组格式
    const result = Object.entries(customerStats).map(([customer_code, stats]) => ({
      customer_code,
      total_sales: stats.total_sales,
      total_cost: stats.total_cost,
      net_profit: stats.total_sales - stats.total_cost,
      order_count: stats.order_count,
    }))

    return NextResponse.json({ ok: true, data: result })
  } catch (err) {
    console.error('[Customers Profit API] Error:', err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
