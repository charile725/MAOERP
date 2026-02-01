'use client'

import React, { useState, useEffect } from 'react'
import { formatCurrency } from '@/lib/utils'

type UserRole = 'admin' | 'staff'

type Account = {
  id: string
  account_name: string
  account_type: 'cash' | 'bank' | 'petty_cash'
  balance: number
  is_active: boolean
}

type FinanceData = {
  accounts: {
    cash: Account[]
    bank: Account[]
    petty_cash: Account[]
  }
  totals: {
    cash: number
    bank: number
    petty_cash: number
    total: number
  }
  today: {
    sales: number
    expenses: number
    netCashFlow: number
    expensesByAccount: { [key: string]: number }
    salesByAccount: { [key: string]: number }
  }
}

const ACCOUNT_TYPE_LABELS = {
  cash: '現金',
  bank: '銀行',
  petty_cash: '零用金',
}

type ClosingStats = {
  business_date: string
  already_closed: boolean
  current_stats: {
    sales_count: number
    total_sales: number
    total_cash: number
    total_card: number
    total_transfer: number
    total_cod: number
    sales_by_account: { [key: string]: number }
  }
}

export default function FinanceDashboardPage() {
  const [data, setData] = useState<FinanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [closingSource, setClosingSource] = useState<'pos' | 'live'>('pos')
  const [closingStats, setClosingStats] = useState<ClosingStats | null>(null)
  const [closingNote, setClosingNote] = useState('')
  const [isClosing, setIsClosing] = useState(false)
  const [closingBusinessDate, setClosingBusinessDate] = useState<string>(() => {
    const now = new Date()
    const tw = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    return tw.toISOString().split('T')[0]
  })
  const [userRole, setUserRole] = useState<UserRole | null>(null)

  const isAdmin = userRole === 'admin'

  const fetchUserRole = async () => {
    try {
      const res = await fetch('/api/auth/me')
      const result = await res.json()
      if (result.ok && result.data) {
        setUserRole(result.data.role)
      }
    } catch (err) {
      console.error('Failed to fetch user role:', err)
    }
  }

  const fetchFinanceData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/finance/dashboard')
      const result = await res.json()
      if (result.ok) {
        setData(result.data)
      }
    } catch (err) {
      console.error('Failed to fetch finance data:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchClosingStats = async (source: 'pos' | 'live', date?: string) => {
    try {
      const dateParam = date || closingBusinessDate
      const res = await fetch(`/api/business-day-closing?source=${source}&business_date=${dateParam}`)
      const result = await res.json()
      if (result.ok) {
        setClosingStats(result.data)
      }
    } catch (err) {
      console.error('Failed to fetch closing stats:', err)
    }
  }

  useEffect(() => {
    fetchUserRole()
    fetchFinanceData()
    fetchClosingStats(closingSource)
  }, [])

  useEffect(() => {
    fetchClosingStats(closingSource)
  }, [closingSource])

  const handleClosing = async () => {
    if (closingStats?.already_closed) {
      alert(`${closingBusinessDate} 已經日結過了，無法重複日結`)
      return
    }
    if (!confirm(`確定要對 ${closingBusinessDate} 執行${closingSource === 'pos' ? '店裡' : '直播'}日結嗎？`)) {
      return
    }

    setIsClosing(true)
    try {
      const res = await fetch('/api/business-day-closing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: closingSource,
          note: closingNote,
          business_date: closingBusinessDate,
        }),
      })

      const result = await res.json()
      if (result.ok) {
        alert('日結完成！')
        setClosingNote('')
        fetchClosingStats(closingSource)
        fetchFinanceData()
      } else {
        alert(`日結失敗：${result.error}`)
      }
    } catch (err) {
      console.error('Failed to perform closing:', err)
      alert('日結失敗，請稍後再試')
    } finally {
      setIsClosing(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-lg bg-white dark:bg-gray-800 p-8 text-center text-gray-900 dark:text-gray-100 shadow">
            載入中...
          </div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-lg bg-white dark:bg-gray-800 p-8 text-center text-gray-900 dark:text-gray-100 shadow">
            載入失敗
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">財務總覽</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            即時查看各帳戶餘額與今日現金流
          </p>
        </div>

        {/* 總覽卡片 */}
        <div className={`mb-6 grid gap-4 ${isAdmin ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-1 lg:grid-cols-1 max-w-md'}`}>
          {/* 現金餘額 - 僅管理員可見 */}
          {isAdmin && (
            <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
              <div className="mb-2 text-sm font-medium text-gray-600 dark:text-gray-400">
                現金餘額
              </div>
              <div className="text-3xl font-bold text-green-600">
                {formatCurrency(data.totals.cash)}
              </div>
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {data.accounts.cash.length} 個帳戶
              </div>
            </div>
          )}

          {/* 銀行餘額 - 僅管理員可見 */}
          {isAdmin && (
            <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
              <div className="mb-2 text-sm font-medium text-gray-600 dark:text-gray-400">
                銀行餘額
              </div>
              <div className="text-3xl font-bold text-blue-600">
                {formatCurrency(data.totals.bank)}
              </div>
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {data.accounts.bank.length} 個帳戶
              </div>
            </div>
          )}

          {/* 零用金 - 所有人可見 */}
          <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
            <div className="mb-2 text-sm font-medium text-gray-600 dark:text-gray-400">
              零用金
            </div>
            <div className="text-3xl font-bold text-orange-600">
              {formatCurrency(data.totals.petty_cash)}
            </div>
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {data.accounts.petty_cash.length} 個帳戶
            </div>
          </div>

          {/* 今日淨現金流 - 僅管理員可見 */}
          {isAdmin && (
            <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
              <div className="mb-2 text-sm font-medium text-gray-600 dark:text-gray-400">
                今日淨現金流
              </div>
              <div
                className={`text-3xl font-bold ${
                  data.today.netCashFlow >= 0 ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {formatCurrency(data.today.netCashFlow)}
              </div>
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                收入 {formatCurrency(data.today.sales)} - 支出 {formatCurrency(data.today.expenses)}
              </div>
            </div>
          )}
        </div>

        {/* 今日現金流詳情 - 僅管理員可見 */}
        {isAdmin && (
          <div className="mb-6 rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
            <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">
              今日現金流詳情
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
                <div className="mb-1 text-sm font-medium text-green-800 dark:text-green-400">
                  今日收入（銷售）
                </div>
                <div className="text-2xl font-bold text-green-600">
                  {formatCurrency(data.today.sales)}
                </div>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
                <div className="mb-1 text-sm font-medium text-red-800 dark:text-red-400">
                  今日支出
                </div>
                <div className="text-2xl font-bold text-red-600">
                  {formatCurrency(data.today.expenses)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 日結功能 - 僅管理員可見 */}
        {isAdmin && (
        <div className="mb-6 rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
          <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">
            營業日結算
          </h2>

          {/* 來源選擇 */}
          <div className="mb-4 flex gap-4">
            <button
              onClick={() => setClosingSource('pos')}
              className={`flex-1 rounded-lg px-4 py-3 font-medium transition-colors ${
                closingSource === 'pos'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              店裡收銀（POS）
            </button>
            <button
              onClick={() => setClosingSource('live')}
              className={`flex-1 rounded-lg px-4 py-3 font-medium transition-colors ${
                closingSource === 'live'
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              直播銷售（Live）
            </button>
          </div>

          {/* 日期選擇 */}
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              營業日期
            </label>
            <input
              type="date"
              value={closingBusinessDate}
              onChange={(e) => {
                setClosingBusinessDate(e.target.value)
                fetchClosingStats(closingSource, e.target.value)
              }}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>

          {/* 已日結警告 */}
          {closingStats?.already_closed && (
            <div className="mb-4 rounded-lg border-2 border-red-300 bg-red-50 p-3 dark:border-red-700 dark:bg-red-900/20">
              <div className="font-semibold text-red-800 dark:text-red-300">
                {closingBusinessDate} 已經日結過了，無法重複日結
              </div>
            </div>
          )}

          {closingStats && (
            <div className="mb-4 space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-700">
                  <div className="text-xs text-gray-600 dark:text-gray-400">銷售筆數</div>
                  <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {closingStats.current_stats.sales_count} 筆
                  </div>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-700">
                  <div className="text-xs text-gray-600 dark:text-gray-400">總銷售額</div>
                  <div className="text-lg font-bold text-green-600">
                    {formatCurrency(closingStats.current_stats.total_sales)}
                  </div>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-700">
                  <div className="text-xs text-gray-600 dark:text-gray-400">現金收入</div>
                  <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {formatCurrency(closingStats.current_stats.total_cash)}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-700">
                  <div className="text-xs text-gray-600 dark:text-gray-400">刷卡收入</div>
                  <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {formatCurrency(closingStats.current_stats.total_card)}
                  </div>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-700">
                  <div className="text-xs text-gray-600 dark:text-gray-400">轉帳收入</div>
                  <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {formatCurrency(closingStats.current_stats.total_transfer)}
                  </div>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-700">
                  <div className="text-xs text-gray-600 dark:text-gray-400">貨到付款</div>
                  <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {formatCurrency(closingStats.current_stats.total_cod)}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              備註（選填）
            </label>
            <input
              type="text"
              value={closingNote}
              onChange={(e) => setClosingNote(e.target.value)}
              placeholder="例如：早班、晚班、值班人員等"
              className="w-full rounded-lg border border-gray-300 px-4 py-2 text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>

          <button
            onClick={handleClosing}
            disabled={isClosing || !closingStats || closingStats.already_closed}
            className="w-full rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {isClosing ? '處理中...' : closingStats?.already_closed ? '已日結' : `執行${closingSource === 'pos' ? '店裡' : '直播'}日結`}
          </button>
        </div>
        )}

        {/* 各帳戶明細 */}
        <div className="space-y-6">
          {Object.entries(data.accounts).map(([type, accountList]) => {
            // 員工只能看到零用金帳戶
            if (!isAdmin && type !== 'petty_cash') return null
            if (accountList.length === 0) return null

            const typeKey = type as keyof typeof ACCOUNT_TYPE_LABELS
            const totalBalance = accountList.reduce((sum, acc) => sum + acc.balance, 0)

            return (
              <div key={type} className="rounded-lg bg-white dark:bg-gray-800 shadow">
                <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {ACCOUNT_TYPE_LABELS[typeKey]}帳戶
                    </h2>
                    <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
                      總計：{formatCurrency(totalBalance)}
                    </span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b bg-gray-50 dark:bg-gray-900">
                      <tr>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">
                          帳戶名稱
                        </th>
                        <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
                          餘額
                        </th>
                        <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
                          今日收入
                        </th>
                        <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
                          今日支出
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {accountList.map((account) => {
                        const todayExpense = data.today.expensesByAccount[account.id] || 0
                        const todaySales = data.today.salesByAccount?.[account.id] || 0
                        return (
                          <tr
                            key={account.id}
                            className="hover:bg-gray-50 dark:hover:bg-gray-700"
                          >
                            <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">
                              {account.account_name}
                            </td>
                            <td className="px-6 py-4 text-right text-sm">
                              <span
                                className={`font-semibold ${
                                  account.balance >= 0 ? 'text-green-600' : 'text-red-600'
                                }`}
                              >
                                {formatCurrency(account.balance)}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right text-sm text-green-600">
                              {todaySales > 0 ? formatCurrency(todaySales) : '-'}
                            </td>
                            <td className="px-6 py-4 text-right text-sm text-red-600">
                              {todayExpense > 0 ? formatCurrency(todayExpense) : '-'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
