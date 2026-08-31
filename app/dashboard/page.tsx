'use client'

import { useState, useEffect, useMemo } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { formatCurrency } from '@/lib/utils'
import { SWR_KEYS } from '@/lib/swr/keys'
import CashFlowPanel from '@/components/CashFlowPanel'

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
  overdueAR: number
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
  arOverdueList?: Array<{ partner_code: string; balance: number; days_overdue: number }>
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
  manual_revenue?: number | null
  paid_sales: number
  unpaid_sales: number
  created_at: string
}

export default function DashboardPage() {
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0])
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])
  const [sourceFilter, setSourceFilter] = useState<'all' | 'pos' | 'live'>('all')

  // 報表模式（按日期 vs 按營業日）
  const [reportMode, setReportMode] = useState<'by_date' | 'by_business_day'>('by_business_day')
  const [selectedClosingId, setSelectedClosingId] = useState<string>('today_pos')
  const [costSort, setCostSort] = useState<{ key: 'product_name' | 'cost' | 'quantity' | 'total_cost'; dir: 'asc' | 'desc' }>({ key: 'total_cost', dir: 'desc' })

  // 營業日模式：用 SWR 獲取兩個通路的日結記錄
  const { data: posClosings = [] } = useSWR<BusinessDayClosing[]>(
    reportMode === 'by_business_day' ? '/api/business-day-closing?source=pos&list=true' : null
  )
  const { data: liveClosings = [] } = useSWR<BusinessDayClosing[]>(
    reportMode === 'by_business_day' ? '/api/business-day-closing?source=live&list=true' : null
  )

  // 合併日結記錄 + 加入今日虛擬選項
  const businessDayClosings = useMemo(() => {
    const allClosings = [...posClosings, ...liveClosings]
      .sort((a: any, b: any) => b.business_date.localeCompare(a.business_date))

    const today = new Date().toISOString().split('T')[0]
    const todayPreviews = [
      { id: 'today_pos', business_date: today, source: 'pos' as const, total_sales: 0, sales_count: 0 },
      { id: 'today_live', business_date: today, source: 'live' as const, total_sales: 0, sales_count: 0 },
    ]

    return [...todayPreviews as any[], ...allClosings.slice(0, 30)]
  }, [posClosings, liveClosings])

  // 切換模式時重置通路篩選
  useEffect(() => {
    if (reportMode === 'by_business_day') {
      setSourceFilter('pos')
    } else {
      setSourceFilter('all')
    }
  }, [reportMode])

  // 建立動態 SWR key
  const salesSwrKey = useMemo(() => {
    if (reportMode === 'by_business_day') {
      if (!selectedClosingId || businessDayClosings.length === 0) return null
      const selectedClosing = businessDayClosings.find((c: any) => c.id === selectedClosingId)
      if (!selectedClosing) return null
      const sourceParam = sourceFilter === 'all' ? '' : `&source=${selectedClosing.source}`
      return `/api/sales?business_date=${selectedClosing.business_date}${sourceParam}`
    } else {
      const sourceParam = sourceFilter !== 'all' ? `&source=${sourceFilter}` : ''
      return `/api/sales?date_from=${dateFrom}&date_to=${dateTo}${sourceParam}`
    }
  }, [reportMode, selectedClosingId, businessDayClosings, dateFrom, dateTo, sourceFilter])

  const expensesSwrKey = useMemo(() => {
    if (reportMode === 'by_business_day') {
      if (!selectedClosingId || businessDayClosings.length === 0) return null
      const selectedClosing = businessDayClosings.find((c: any) => c.id === selectedClosingId)
      if (!selectedClosing) return null
      return `/api/expenses?date_from=${selectedClosing.business_date}&date_to=${selectedClosing.business_date}`
    } else {
      return `/api/expenses?date_from=${dateFrom}&date_to=${dateTo}`
    }
  }, [reportMode, selectedClosingId, businessDayClosings, dateFrom, dateTo])

  // SWR hooks
  const { data: salesInRange = [], isLoading: salesLoading } = useSWR<any[]>(salesSwrKey)
  const { data: expensesInRange = [], isLoading: expensesLoading } = useSWR<any[]>(expensesSwrKey)
  const { data: extendedData = {} } = useSWR<any>(SWR_KEYS.FINANCE_DASHBOARD)
  const { data: depData } = useSWR<any>(SWR_KEYS.FIXED_ASSETS_SUMMARY)

  const loading = salesLoading || expensesLoading

  // 所有統計計算移到 useMemo
  const stats = useMemo<DashboardStats>(() => {
    const confirmedSales = salesInRange.filter((s: any) => s.status === 'confirmed')

    // 直播營業日不計算營收：營業額以日結手動輸入的金額為準（成本仍照 sale_items 計算）
    const selectedClosing: any = reportMode === 'by_business_day'
      ? businessDayClosings.find((c: any) => c.id === selectedClosingId)
      : null
    const liveRevenue: number | null = selectedClosing?.source === 'live'
      ? Number(selectedClosing.manual_revenue ?? selectedClosing.total_sales ?? 0)
      : null

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

    // 直播營業日：營收面一律採手動營業額，折扣／購物金／未收皆不適用
    const effGrossSales = liveRevenue ?? grossSales
    const effTotalDiscount = liveRevenue !== null ? 0 : totalDiscount
    const effStoreCreditUsed = liveRevenue !== null ? 0 : totalStoreCreditUsed
    const effAmountDue = liveRevenue ?? amountDue
    const effActualCollected = liveRevenue ?? actualCollected
    const effUncollected = liveRevenue !== null ? 0 : uncollected

    // Calculate total cost（追蹤實際總成本）
    const costBreakdownMap = new Map<string, { unitCost: number; totalCost: number; quantity: number; name: string }>()
    const totalCost = confirmedSales.reduce((sum: number, s: any) => {
      const saleCost = (s.sale_items || []).reduce(
        (itemSum: number, item: any) => {
          const effectiveQty = item.quantity - (item.store_credit_qty || 0)
          const unitCost = item.cost || 0
          const itemCost = unitCost * effectiveQty
          if (effectiveQty > 0) {
            const key = item.product_id || item.snapshot_name || 'unknown'
            if (costBreakdownMap.has(key)) {
              const existing = costBreakdownMap.get(key)!
              existing.quantity += effectiveQty
              existing.totalCost += itemCost
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
          return itemSum + itemCost + (item.store_credit_amount || 0)
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
    const grossProfit = effGrossSales - totalCost
    const netProfit = grossProfit - totalExpenses

    // AR/AP 數據
    const totalAR = extendedData.arAging?.total || 0
    const overdueAR = (extendedData.arAging?.days31_60 || 0) +
      (extendedData.arAging?.days61_90 || 0) +
      (extendedData.arAging?.over90 || 0)

    // 折舊數據
    const depSummary = depData?.summary
    const depreciation = depSummary ? {
      total_monthly: depSummary.total_monthly_depreciation,
      total_assets: depSummary.total_assets,
      total_remaining: depSummary.total_remaining_value
    } : { total_monthly: 0, total_assets: 0, total_remaining: 0 }

    return {
      grossSales: effGrossSales,
      totalDiscount: effTotalDiscount,
      totalStoreCreditUsed: effStoreCreditUsed,
      amountDue: effAmountDue,
      actualCollected: effActualCollected,
      uncollected: effUncollected,
      todaySales: effGrossSales,
      todayOrders: salesInRange.length,
      totalCost,
      totalExpenses,
      grossProfit,
      netProfit,
      totalAR,
      overdueAR,
      costBreakdown,
      arAging: extendedData.arAging,
      arOverdueList: extendedData.arOverdueList,
      profitTrend: extendedData.profitTrend,
      depreciation,
    }
  }, [salesInRange, expensesInRange, extendedData, depData, reportMode, businessDayClosings, selectedClosingId])

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
              onClick={() => setReportMode('by_business_day')}
              className={`flex-1 rounded-lg px-4 py-3 text-sm font-bold transition-all ${reportMode === 'by_business_day'
                ? 'bg-green-600 text-white shadow-md'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
            >
              按營業日查看
            </button>
            <button
              onClick={() => setReportMode('by_date')}
              className={`flex-1 rounded-lg px-4 py-3 text-sm font-bold transition-all ${reportMode === 'by_date'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
            >
              按日期查看
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
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto]">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                  選擇營業日
                </label>
                <select
                  value={selectedClosingId}
                  onChange={(e) => { setSelectedClosingId(e.target.value); setSourceFilter('pos') }}
                  className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none"
                  disabled={businessDayClosings.length === 0}
                >
                  {businessDayClosings.length === 0 ? (
                    <option>無日結記錄</option>
                  ) : (
                    businessDayClosings.map((closing) => {
                      const isToday = closing.id === 'today_pos' || closing.id === 'today_live'
                      const sourceLabel = closing.source === 'pos' ? '店裡' : '直播'
                      if (isToday) {
                        return (
                          <option key={closing.id} value={closing.id}>
                            {sourceLabel}（未日結）{closing.business_date}
                          </option>
                        )
                      }

                      return (
                        <option key={closing.id} value={closing.id}>
                          {sourceLabel} {closing.business_date} ({formatCurrency(closing.total_sales)} | {closing.sales_count} 筆)
                        </option>
                      )
                    })
                  )}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => setSourceFilter(sourceFilter === 'all' ? 'pos' : 'all')}
                  className={`rounded px-4 py-2 text-sm font-medium transition-colors ${sourceFilter === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                >
                  全部通路
                </button>
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

        {/* KPI Cards - Row 2: 應收帳款 / 固定資產攤提 */}
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
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






        {/* 現金流：報表頁一起看得到，日期自己選（跟上面的營收區間各自獨立） */}
        <CashFlowPanel collapsible />

        {/* Cost Breakdown - Collapsible */}
        {stats.costBreakdown && stats.costBreakdown.length > 0 && (() => {
          const sorted = [...stats.costBreakdown].sort((a, b) => {
            const v = costSort.key === 'product_name'
              ? a.product_name.localeCompare(b.product_name, 'zh-TW')
              : (a[costSort.key] as number) - (b[costSort.key] as number)
            return costSort.dir === 'asc' ? v : -v
          })
          const toggleSort = (key: typeof costSort.key) => {
            setCostSort(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'product_name' ? 'asc' : 'desc' })
          }
          const SortIcon = ({ col }: { col: typeof costSort.key }) => (
            <span className="ml-1 inline-block w-3 text-xs">
              {costSort.key === col ? (costSort.dir === 'asc' ? '▲' : '▼') : <span className="opacity-30">▼</span>}
            </span>
          )
          return (
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
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => toggleSort('product_name')}>
                        商品名稱<SortIcon col="product_name" />
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => toggleSort('cost')}>
                        單位成本<SortIcon col="cost" />
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => toggleSort('quantity')}>
                        銷售數量<SortIcon col="quantity" />
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => toggleSort('total_cost')}>
                        總成本<SortIcon col="total_cost" />
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {sorted.map((item, index) => (
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
          )
        })()}


      </div>
    </div>
  )
}
