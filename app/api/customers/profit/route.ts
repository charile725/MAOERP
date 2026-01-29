import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// GET /api/customers/profit - Get profit/loss for all customers
export async function GET(request: NextRequest) {
  try {
    // 使用 SQL 查询计算每个客户的净损益
    // 1. 从 sales 表获取每个客户的总销售额
    // 2. 从 sale_items 表获取每个客户的总成本
    // 3. 净损益 = 销售额 - 成本

    const { data, error } = await supabaseServer.rpc('get_customer_profit_stats')

    if (error) {
      // 如果 RPC 不存在，使用备用查询
      if (error.message.includes('function') || error.code === '42883') {
        // 备用方案：直接查询
        const { data: salesData, error: salesError } = await (supabaseServer
          .from('sales') as any)
          .select(`
            customer_code,
            total,
            sale_items (
              quantity,
              cost
            )
          `)
          .not('customer_code', 'is', null)

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

          customerStats[code].total_sales += sale.total || 0
          customerStats[code].order_count += 1

          // 计算成本
          for (const item of sale.sale_items || []) {
            customerStats[code].total_cost += (item.cost || 0) * (item.quantity || 0)
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
      }

      console.error('[Customers Profit API] Error:', error)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, data })
  } catch (err) {
    console.error('[Customers Profit API] Error:', err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
