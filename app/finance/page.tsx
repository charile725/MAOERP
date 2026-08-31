'use client'

import React from 'react'
import useSWR from 'swr'
import { SWR_KEYS, financeDashboardKey } from '@/lib/swr/keys'
import { formatCurrency } from '@/lib/utils'
import { getTaiwanDateString } from '@/lib/timezone'

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
  date: string
  today: {
    sales: number
    expenses: number
    netCashFlow: number
    expensesByAccount: { [key: string]: number }
    salesByAccount: { [key: string]: number }
  }
  arAging?: {
    total: number
    current: number
    days31_60: number
    days61_90: number
    over90: number
  }
}

const ACCOUNT_TYPE_LABELS = {
  cash: '現金',
  bank: '銀行',
  petty_cash: '零用金',
}

/**
 * 日期加減天數。
 * 一律用 UTC 運算：字串本來就是台灣日期，補 T00:00:00Z 當 UTC 解析再位移，
 * 才不會因為執行環境的時區而跳日。
 */
function shiftDate(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

function formatDateLabel(date: string): string {
  const [y, m, d] = date.split('-')
  return `${y}/${m}/${d}`
}

export default function FinanceDashboardPage() {
  const { data: authData } = useSWR<{ role: UserRole }>(SWR_KEYS.AUTH_ME)
  const userRole = authData?.role ?? null

  const today = getTaiwanDateString()
  const [selectedDate, setSelectedDate] = React.useState(today)
  const isToday = selectedDate === today

  const { data, isLoading: loading } = useSWR<FinanceData>(
    financeDashboardKey({ date: selectedDate })
  )

  const isAdmin = userRole === 'admin'

  // 帳戶餘額是「當下」的數字，跟看哪一天無關，只有現金流的進出會跟著日期跑
  const flowLabel = isToday ? '今日' : formatDateLabel(selectedDate)

  const dateBar = (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
      <span className="mr-1 text-sm font-medium text-gray-600 dark:text-gray-400">查看日期</span>
      <button
        onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}
        className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
        title="前一天"
      >
        ← 前一天
      </button>
      <input
        type="date"
        value={selectedDate}
        max={today}
        onChange={(e) => {
          if (e.target.value) setSelectedDate(e.target.value)
        }}
        className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
      />
      <button
        onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}
        disabled={isToday}
        className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700 dark:disabled:text-gray-600"
        title="後一天"
      >
        後一天 →
      </button>
      <button
        onClick={() => setSelectedDate(today)}
        disabled={isToday}
        className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-600"
      >
        今天
      </button>
      {!isToday && (
        <span className="text-sm text-amber-600 dark:text-amber-400">
          正在看 {formatDateLabel(selectedDate)} 的現金流
        </span>
      )}
    </div>
  )

  const header = (
    <div className="mb-6">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">現金流</h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        帳戶總餘額 + 應收帳款
      </p>
    </div>
  )

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
        <div className="mx-auto max-w-7xl">
          {header}
          {dateBar}
          <div className="rounded-lg bg-white dark:bg-gray-800 p-8 text-center text-gray-900 dark:text-gray-100 shadow">
            {loading ? '載入中...' : '載入失敗'}
          </div>
        </div>
      </div>
    )
  }

  const arTotal = data.arAging?.total || 0
  const netCashPosition = data.totals.total + arTotal

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="mx-auto max-w-7xl">
        {header}
        {dateBar}

        {isAdmin && (
          <>
            {/* 現金流總覽 */}
            <div className="mb-6 rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
              <div className="flex flex-col items-center gap-4 md:flex-row md:justify-between">
                {/* 帳戶總餘額 */}
                <div className="text-center md:text-left flex-1">
                  <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">帳戶總餘額</div>
                  <div className="text-3xl font-bold text-blue-600">{formatCurrency(data.totals.total)}</div>
                </div>

                <div className="text-2xl font-bold text-gray-400 hidden md:block">+</div>

                {/* 應收帳款 */}
                <div className="text-center flex-1">
                  <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">應收帳款</div>
                  <div className="text-3xl font-bold text-green-600">
                    {formatCurrency(arTotal)}
                  </div>
                </div>

                <div className="text-2xl font-bold text-gray-400 hidden md:block">=</div>

                {/* 淨現金部位 */}
                <div className="text-center md:text-right flex-1 border-t md:border-t-0 md:border-l border-gray-200 dark:border-gray-700 pt-4 md:pt-0 md:pl-6">
                  <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">淨現金部位</div>
                  <div className={`text-4xl font-bold ${netCashPosition >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatCurrency(netCashPosition)}
                  </div>
                </div>
              </div>
            </div>

            {/* 帳戶餘額卡片 */}
            <div className="mb-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
                <div className="mb-2 text-sm font-medium text-gray-600 dark:text-gray-400">現金餘額</div>
                <div className="text-3xl font-bold text-green-600">{formatCurrency(data.totals.cash)}</div>
                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">{data.accounts.cash.length} 個帳戶</div>
              </div>
              <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
                <div className="mb-2 text-sm font-medium text-gray-600 dark:text-gray-400">銀行餘額</div>
                <div className="text-3xl font-bold text-blue-600">{formatCurrency(data.totals.bank)}</div>
                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">{data.accounts.bank.length} 個帳戶</div>
              </div>
              <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
                <div className="mb-2 text-sm font-medium text-gray-600 dark:text-gray-400">零用金</div>
                <div className="text-3xl font-bold text-orange-600">{formatCurrency(data.totals.petty_cash)}</div>
                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">{data.accounts.petty_cash.length} 個帳戶</div>
              </div>
            </div>

            {/* 當日現金流 */}
            <div className="mb-6 rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
              <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">
                {flowLabel}現金流
              </h2>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
                  <div className="mb-1 text-sm font-medium text-green-800 dark:text-green-400">收入（銷售）</div>
                  <div className="text-2xl font-bold text-green-600">{formatCurrency(data.today.sales)}</div>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
                  <div className="mb-1 text-sm font-medium text-red-800 dark:text-red-400">支出</div>
                  <div className="text-2xl font-bold text-red-600">{formatCurrency(data.today.expenses)}</div>
                </div>
                <div className={`rounded-lg border p-4 ${data.today.netCashFlow >= 0
                  ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20'
                  : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
                  }`}>
                  <div className={`mb-1 text-sm font-medium ${data.today.netCashFlow >= 0 ? 'text-emerald-800 dark:text-emerald-400' : 'text-red-800 dark:text-red-400'}`}>
                    淨現金流
                  </div>
                  <div className={`text-2xl font-bold ${data.today.netCashFlow >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatCurrency(data.today.netCashFlow)}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* 員工只看零用金 */}
        {!isAdmin && (
          <div className="mb-6 max-w-md">
            <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
              <div className="mb-2 text-sm font-medium text-gray-600 dark:text-gray-400">零用金</div>
              <div className="text-3xl font-bold text-orange-600">{formatCurrency(data.totals.petty_cash)}</div>
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">{data.accounts.petty_cash.length} 個帳戶</div>
            </div>
          </div>
        )}

        {/* 各帳戶明細 */}
        <div className="space-y-6">
          {Object.entries(data.accounts).map(([type, accountList]) => {
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
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">帳戶名稱</th>
                        <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">餘額</th>
                        <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">{flowLabel}收入</th>
                        <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">{flowLabel}支出</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {accountList.map((account) => {
                        const todayExpense = data.today.expensesByAccount[account.id] || 0
                        const todaySales = data.today.salesByAccount?.[account.id] || 0
                        return (
                          <tr key={account.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                            <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">{account.account_name}</td>
                            <td className="px-6 py-4 text-right text-sm">
                              <span className={`font-semibold ${account.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
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
