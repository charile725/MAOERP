'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { formatCurrency } from '@/lib/utils'

type DashboardStats = {
  // 營收口徑
  grossSales: number // 交易額 (Gross Sales)
  totalDiscount: number // 折扣總額
  totalStoreCreditUsed: number // 購物金使用總額
  amountDue: number // 應收金額 (= grossSales - discount - store_credit)
  actualCollected: number // 實收金額 (只計算 is_paid=true)
  uncollected: number // 未收金額
  // 舊欄位保留向後兼容
  todaySales: number // = grossSales，將被棄用
  todayOrders: number
  totalCost: number
  totalExpenses: number
  grossProfit: number
  netProfit: number
  totalAR: number
  totalAP: number
  overdueAR: number
  overdueAP: number
  costBreakdown?: Array<{
    product_name: string
    cost: number
    quantity: number
    total_cost: number
  }>
  // 新增欄位
  arAging?: {
    current: number
    days31_60: number
    days61_90: number
    over90: number
    total: number
  }
  apAging?: {
    current: number
    days31_60: number
    days61_90: number
    over90: number
    total: number
  }
  arOverdueList?: Array<{ partner_code: string; balance: number; days_overdue: number }>
  apDueSoon?: Array<{ partner_code: string; balance: number; days_until_due: number }>
  apOverdueList?: Array<{ partner_code: string; balance: number; days_overdue: number }>
  inventory?: {
    totalValue: number
    totalQuantity: number
  }
  profitTrend?: Array<{
    date: string
    revenue: number
    cost: number
    grossProfit: number
    grossMargin: number
  }>
  depreciation?: {
    total_monthly: number
    total_assets: number
    total_remaining: number
  }
}

type RecentSale = {
  id: string
  sale_no: string
  total: number
  customer_code: string | null
  created_at: string
}

type BusinessDayClosing = {
  id: string
  source: 'pos' | 'live'
  closing_time: string
  business_date: string
  sales_count: number
  total_sales: number
  paid_sales: number
  unpaid_sales: number
  created_at: string
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    grossSales: 0,
    totalDiscount: 0,
    totalStoreCreditUsed: 0,
    amountDue: 0,
    actualCollected: 0,
    uncollected: 0,
    todaySales: 0, // 向後兼容
    todayOrders: 0,
    totalCost: 0,
    totalExpenses: 0,
    grossProfit: 0,
    netProfit: 0,
    totalAR: 0,
    totalAP: 0,
    overdueAR: 0,
    overdueAP: 0,
  })
  const [recentSales, setRecentSales] = useState<RecentSale[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0])
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])
  const [sourceFilter, setSourceFilter] = useState<'all' | 'pos' | 'live'>('all')

  // 新增：報表模式（按日期 vs 按營業日）
  const [reportMode, setReportMode] = useState<'by_date' | 'by_business_day'>('by_date')
  const [businessDayClosings, setBusinessDayClosings] = useState<BusinessDayClosing[]>([])
  const [selectedClosingId, setSelectedClosingId] = useState<string>('')

  useEffect(() => {
    fetchDashboardData()
  }, [dateFrom, dateTo, sourceFilter, reportMode, selectedClosingId])

  useEffect(() => {
    // 當切換到營業日模式時，獲取日結記錄列表
    if (reportMode === 'by_business_day') {
      fetchBusinessDayClosings()
    }
  }, [reportMode])

  const fetchBusinessDayClosings = async () => {
    try {
      // 同時獲取兩個通路的日結記錄
      const [posRes, liveRes] = await Promise.all([
        fetch('/api/business-day-closing?source=pos&list=true'),
        fetch('/api/business-day-closing?source=live&list=true')
      ])
      const [posData, liveData] = await Promise.all([posRes.json(), liveRes.json()])

      // 合併並按營業日期排序
      const allClosings = [
        ...(posData.ok ? posData.data : []),
        ...(liveData.ok ? liveData.data : [])
      ].sort((a, b) => b.business_date.localeCompare(a.business_date))

      setBusinessDayClosings(allClosings)
      if (allClosings.length > 0) {
        setSelectedClosingId(allClosings[0].id)
      }
    } catch (err) {
      console.error('Failed to fetch business day closings:', err)
    }
  }

  const fetchDashboardData = async () => {
    setLoading(true)
    try {
      // 建立查詢參數
      let salesUrl = ''
      let expensesUrl = ''

      if (reportMode === 'by_business_day') {
        if (!selectedClosingId || businessDayClosings.length === 0) {
          setLoading(false)
          return
        }

        const selectedClosing = businessDayClosings.find(c => c.id === selectedClosingId)
        if (!selectedClosing) {
          setLoading(false)
          return
        }

        // 使用 business_date 和 source 查詢該營業日的銷售
        const sourceParam = sourceFilter !== 'all' ? `&source=${sourceFilter}` : `&source=${selectedClosing.source}`

        salesUrl = `/api/sales?business_date=${selectedClosing.business_date}${sourceParam}`
        expensesUrl = `/api/expenses?date_from=${selectedClosing.business_date}&date_to=${selectedClosing.business_date}`
      } else {
        const sourceParam = sourceFilter !== 'all' ? `&source=${sourceFilter}` : ''
        salesUrl = `/api/sales?date_from=${dateFrom}&date_to=${dateTo}${sourceParam}`
        expensesUrl = `/api/expenses?date_from=${dateFrom}&date_to=${dateTo}`
      }

      // 平行呼叫所有 API
      const [salesRes, expensesRes, dashboardRes, depRes] = await Promise.all([
        fetch(salesUrl),
        fetch(expensesUrl),
        fetch('/api/finance/dashboard'),
        fetch('/api/fixed-assets/summary')
      ])

      const [salesData, expensesData, dashboardData, depData] = await Promise.all([
        salesRes.json(),
        expensesRes.json(),
        dashboardRes.json(),
        depRes.json()
      ])

      const salesInRange = salesData.ok ? salesData.data : []
      const expensesInRange = expensesData.ok ? expensesData.data : []
      const extendedData = dashboardData.ok ? dashboardData.data : {}

      // 設定最近銷售（直接用已查詢的資料）
      setRecentSales(salesInRange.slice(0, 10))

      // 繼續原有的統計邏輯
      const confirmedSales = salesInRange.filter((s: any) => s.status === 'confirmed')

      // Gross Sales (交易額/原始銷售額)
      const grossSales = confirmedSales.reduce((sum: number, s: any) => {
        if (s.subtotal) return sum + s.subtotal
        const itemsSubtotal = (s.sale_items || []).reduce(
          (itemSum: number, item: any) => itemSum + (item.price * item.quantity), 0
        )
        return sum + itemsSubtotal
      }, 0)

      const totalDiscount = confirmedSales.reduce((sum: number, s: any) => sum + (s.discount_amount || 0), 0)
      const totalStoreCreditUsed = confirmedSales.reduce((sum: number, s: any) => sum + (s.store_credit_used || 0), 0)
      const amountDue = confirmedSales.reduce((sum: number, s: any) => sum + s.total, 0)
      const actualCollected = confirmedSales
        .filter((s: any) => s.is_paid)
        .reduce((sum: number, s: any) => sum + s.total, 0)
      const uncollected = amountDue - actualCollected

      // Calculate total cost（追蹤實際總成本）
      const costBreakdownMap = new Map<string, { unitCost: number; totalCost: number; quantity: number; name: string }>()
      let totalStoreCreditGranted = 0
      const totalCost = confirmedSales.reduce((sum: number, s: any) => {
        const saleCost = (s.sale_items || []).reduce(
          (itemSum: number, item: any) => {
            const effectiveQty = item.quantity - (item.store_credit_qty || 0)
            const unitCost = item.cost || 0
            const itemCost = unitCost * effectiveQty
            const storeCreditCost = item.store_credit_amount || 0
            totalStoreCreditGranted += storeCreditCost
            if (effectiveQty > 0) {
              const key = item.product_id || item.snapshot_name || 'unknown'
              if (costBreakdownMap.has(key)) {
                const existing = costBreakdownMap.get(key)!
                existing.quantity += effectiveQty
                existing.totalCost += itemCost
                // 如果單位成本不同，用加權平均
                if (existing.unitCost !== unitCost && unitCost > 0) {
                  existing.unitCost = existing.totalCost / existing.quantity
                }
              } else {
                costBreakdownMap.set(key, {
                  unitCost: unitCost,
                  totalCost: itemCost,
                  quantity: effectiveQty,
                  name: item.snapshot_name || '未知商品'
                })
              }
            }
            return itemSum + itemCost + storeCreditCost
          },
          0
        )
        return sum + saleCost
      }, 0)

      const costBreakdown = Array.from(costBreakdownMap.values()).map(item => ({
        product_name: item.name,
        cost: item.unitCost,
        quantity: item.quantity,
        total_cost: item.totalCost
      }))

      const totalExpenses = expensesInRange.reduce((sum: number, e: any) => sum + e.amount, 0)
      const grossProfit = grossSales - totalCost
      const netProfit = grossProfit - totalExpenses

      // AR/AP 數據
      const totalAR = extendedData.arAging?.total || 0
      const overdueAR = (extendedData.arAging?.days31_60 || 0) +
        (extendedData.arAging?.days61_90 || 0) +
        (extendedData.arAging?.over90 || 0)
      const totalAP = extendedData.apAging?.total || 0
      const overdueAP = (extendedData.apAging?.days31_60 || 0) +
        (extendedData.apAging?.days61_90 || 0) +
        (extendedData.apAging?.over90 || 0)

      // 折舊數據
      const depreciation = depData.ok ? {
        total_monthly: depData.data.summary.total_monthly_depreciation,
        total_assets: depData.data.summary.total_assets,
        total_remaining: depData.data.summary.total_remaining_value
      } : { total_monthly: 0, total_assets: 0, total_remaining: 0 }

      setStats({
        grossSales,
        totalDiscount,
        totalStoreCreditUsed,
        amountDue,
        actualCollected,
        uncollected,
        todaySales: grossSales,
        todayOrders: salesInRange.length,
        totalCost,
        totalExpenses,
        grossProfit,
        netProfit,
        totalAR,
        totalAP,
        overdueAR,
        overdueAP,
        costBreakdown,
        arAging: extendedData.arAging,
        apAging: extendedData.apAging,
        arOverdueList: extendedData.arOverdueList,
        apDueSoon: extendedData.apDueSoon,
        apOverdueList: extendedData.apOverdueList,
        profitTrend: extendedData.profitTrend,
        depreciation,
      })
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-xl text-gray-900 dark:text-gray-100">載入中...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="mx-auto max-w-7xl">
        <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-100">營收報表</h1>

        {/* Report Mode Selector */}
        <div className="mb-6 rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setReportMode('by_date')}
              className={`flex-1 rounded-lg px-4 py-3 text-sm font-bold transition-all ${reportMode === 'by_date'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
            >
              按日期查看
            </button>
            <button
              onClick={() => setReportMode('by_business_day')}
              className={`flex-1 rounded-lg px-4 py-3 text-sm font-bold transition-all ${reportMode === 'by_business_day'
                ? 'bg-green-600 text-white shadow-md'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
            >
              按營業日查看
            </button>
          </div>
        </div>

        {/* Date Filter */}
        <div className="mb-6 rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
          {reportMode === 'by_date' ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                  起始日期
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                  結束日期
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                  銷售通路
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSourceFilter('all')}
                    className={`flex-1 rounded px-3 py-2 text-sm font-medium transition-colors ${sourceFilter === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                      }`}
                  >
                    全部
                  </button>
                  <button
                    onClick={() => setSourceFilter('pos')}
                    className={`flex-1 rounded px-3 py-2 text-sm font-medium transition-colors ${sourceFilter === 'pos'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                      }`}
                  >
                    店裡
                  </button>
                  <button
                    onClick={() => setSourceFilter('live')}
                    className={`flex-1 rounded px-3 py-2 text-sm font-medium transition-colors ${sourceFilter === 'live'
                      ? 'bg-pink-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                      }`}
                  >
                    直播
                  </button>
                </div>
              </div>
            </div>
          ) : (
            // 按營業日模式
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                  選擇營業日
                </label>
                <select
                  value={selectedClosingId}
                  onChange={(e) => setSelectedClosingId(e.target.value)}
                  className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none"
                  disabled={businessDayClosings.length === 0}
                >
                  {businessDayClosings.length === 0 ? (
                    <option>無日結記錄</option>
                  ) : (
                    businessDayClosings.map((closing) => {
                      const sourceLabel = closing.source === 'pos' ? '店裡' : '直播'

                      return (
                        <option key={closing.id} value={closing.id}>
                          {sourceLabel} {closing.business_date} ({formatCurrency(closing.total_sales)} | {closing.sales_count} 筆)
                        </option>
                      )
                    })
                  )}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                  顯示通路
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSourceFilter('all')}
                    className={`flex-1 rounded px-3 py-2 text-sm font-medium transition-colors ${sourceFilter === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                      }`}
                  >
                    全部
                  </button>
                  <button
                    onClick={() => setSourceFilter('pos')}
                    className={`flex-1 rounded px-3 py-2 text-sm font-medium transition-colors ${sourceFilter === 'pos'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                      }`}
                  >
                    店裡
                  </button>
                  <button
                    onClick={() => setSourceFilter('live')}
                    className={`flex-1 rounded px-3 py-2 text-sm font-medium transition-colors ${sourceFilter === 'live'
                      ? 'bg-pink-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                      }`}
                  >
                    直播
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* KPI Cards - Row 1: Revenue & Profit */}
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">交易額 (Gross Sales)</div>
            <div className="mt-2 text-3xl font-bold text-green-600">
              {formatCurrency(stats.grossSales)}
            </div>
            <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {stats.todayOrders} 筆訂單
              {(stats.totalDiscount > 0 || stats.totalStoreCreditUsed > 0) && (
                <span className="ml-2">
                  (折扣 {formatCurrency(stats.totalDiscount)}, 購物金 {formatCurrency(stats.totalStoreCreditUsed)})
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              應收 = 交易額 - 折扣 - 購物金
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-sm border-t pt-2">
              <div>
                <span className="text-gray-500 dark:text-gray-400">應收</span>
                <div className="font-semibold text-blue-600">{formatCurrency(stats.amountDue)}</div>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">實收</span>
                <div className="font-semibold text-green-600">{formatCurrency(stats.actualCollected)}</div>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">未收</span>
                <div className={`font-semibold ${stats.uncollected > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                  {formatCurrency(stats.uncollected)}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">期間成本</div>
            <div className="mt-2 text-3xl font-bold text-orange-600">
              {formatCurrency(stats.totalCost)}
            </div>
            <div className="mt-1 text-sm text-gray-900 dark:text-gray-100">
              毛利率: {stats.grossSales > 0 ? ((stats.grossProfit / stats.grossSales) * 100).toFixed(1) : 0}%
            </div>
          </div>

          <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">期間支出</div>
            <div className="mt-2 text-3xl font-bold text-red-600">
              {formatCurrency(stats.totalExpenses)}
            </div>
            <div className="mt-1 text-sm text-gray-900 dark:text-gray-100">
              會計支出
            </div>
          </div>

          <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">期間淨利</div>
            <div className={`mt-2 text-3xl font-bold ${stats.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(stats.netProfit)}
            </div>
            <div className="mt-1 text-sm text-gray-900 dark:text-gray-100">
              淨利率: {stats.grossSales > 0 ? ((stats.netProfit / stats.grossSales) * 100).toFixed(1) : 0}%
            </div>
          </div>
        </div>

        {/* KPI Cards - Row 2: AR/AP/庫存 */}
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">應收帳款</div>
            <div className="mt-2 text-3xl font-bold text-blue-600">
              {formatCurrency(stats.totalAR)}
            </div>
            {stats.overdueAR > 0 && (
              <div className="mt-1 text-sm text-red-600">
                逾期: {formatCurrency(stats.overdueAR)}
              </div>
            )}
          </div>

          <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">應付帳款</div>
            <div className="mt-2 text-3xl font-bold text-orange-600">
              {formatCurrency(stats.totalAP)}
            </div>
            {stats.overdueAP > 0 && (
              <div className="mt-1 text-sm text-red-600">
                逾期: {formatCurrency(stats.overdueAP)}
              </div>
            )}
          </div>

          <Link href="/fixed-assets" className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow hover:shadow-lg transition-shadow">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">每月攤提費用</div>
            <div className="mt-2 text-3xl font-bold text-orange-600">
              {formatCurrency(stats.depreciation?.total_monthly || 0)}
            </div>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              固定資產 {stats.depreciation?.total_assets || 0} 項 | 剩餘價值 {formatCurrency(stats.depreciation?.total_remaining || 0)}
            </div>
          </Link>
        </div>



        {/* 到期提醒 */}
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* AP 即將到期 */}
          {stats.apDueSoon && stats.apDueSoon.length > 0 && (
            <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow border-l-4 border-yellow-500">
              <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">應付帳款即將到期 (7天內)</h2>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {stats.apDueSoon.map((item, index) => (
                  <div key={index} className="flex justify-between items-center p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded">
                    <span className="text-sm text-gray-700 dark:text-gray-300">{item.partner_code}</span>
                    <div className="text-right">
                      <span className="font-semibold text-yellow-600">{formatCurrency(item.balance)}</span>
                      <span className="ml-2 text-xs text-gray-500">
                        ({item.days_until_due === 0 ? '今天' : `${item.days_until_due} 天後`})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AP 已逾期 */}
          {stats.apOverdueList && stats.apOverdueList.length > 0 && (
            <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow border-l-4 border-red-500">
              <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">應付帳款已逾期</h2>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {stats.apOverdueList.map((item, index) => (
                  <div key={index} className="flex justify-between items-center p-2 bg-red-50 dark:bg-red-900/20 rounded">
                    <span className="text-sm text-gray-700 dark:text-gray-300">{item.partner_code}</span>
                    <div className="text-right">
                      <span className="font-semibold text-red-600">{formatCurrency(item.balance)}</span>
                      <span className="ml-2 text-xs text-gray-500">(逾期 {item.days_overdue} 天)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>



        {/* Cost Breakdown - Collapsible */}
        {stats.costBreakdown && stats.costBreakdown.length > 0 && (
          <details className="mb-6 rounded-lg bg-white dark:bg-gray-800 shadow">
            <summary className="p-6 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg">
              <span className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                期間成本明細 ({stats.costBreakdown.length} 項, 合計 {formatCurrency(stats.totalCost)})
              </span>
            </summary>
            <div className="px-6 pb-6 overflow-x-auto">
              <table className="w-full">
                <thead className="border-b bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">商品名稱</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">單位成本</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">銷售數量</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">總成本</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {stats.costBreakdown.map((item, index) => (
                    <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{item.product_name}</td>
                      <td className="px-4 py-3 text-right text-sm text-gray-900 dark:text-gray-100">
                        {formatCurrency(item.cost)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-900 dark:text-gray-100">
                        {item.quantity}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {formatCurrency(item.total_cost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <td colSpan={3} className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
                      總計:
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-gray-900 dark:text-gray-100">
                      {formatCurrency(stats.totalCost)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </details>
        )}


      </div>
    </div>
  )
}
