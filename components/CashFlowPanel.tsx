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
  date: string
  today: {
    sales: number
    expenses: number
    netCashFlow: number
    expensesByAccount: { [key: string]: number }
    salesByAccount: { [key: string]: number }
  }
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

type Props = {
  /** 放在報表頁時用摺疊的樣子，省版面 */
  collapsible?: boolean
}

/**
 * 當天各帳戶的收入與支出。
 * 報表頁與現金流頁共用同一份，日期各自獨立（報表的區間篩選管的是營收，不是現金流）。
 */
export default function CashFlowPanel({ collapsible = false }: Props) {
  const { data: authData } = useSWR<{ role: UserRole }>(SWR_KEYS.AUTH_ME)
  const isAdmin = authData?.role === 'admin'

  const today = getTaiwanDateString()
  const [selectedDate, setSelectedDate] = React.useState(today)
  const isToday = selectedDate === today

  const { data, isLoading: loading } = useSWR<FinanceData>(
    financeDashboardKey({ date: selectedDate })
  )

  const dateBar = (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <button
        onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}
        className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
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
    </div>
  )

  let body: React.ReactNode

  if (loading || !data) {
    body = (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-900 dark:text-gray-100">
        {loading ? '載入中...' : '載入失敗'}
      </div>
    )
  } else {
    // 攤平成一張清單就好；員工只看得到零用金
    const rows = [
      ...data.accounts.cash,
      ...data.accounts.bank,
      ...data.accounts.petty_cash,
    ]
      .filter((account) => isAdmin || account.account_type === 'petty_cash')
      .map((account) => ({
        id: account.id,
        name: account.account_name,
        income: data.today.salesByAccount?.[account.id] || 0,
        expense: data.today.expensesByAccount?.[account.id] || 0,
      }))

    // 有些銷售／支出沒有指定帳戶，總計要用整天的數字，
    // 否則表格加起來會跟上面的卡片對不起來，錢像是憑空不見
    const totalIncome = isAdmin ? data.today.sales : rows.reduce((sum, r) => sum + r.income, 0)
    const totalExpense = isAdmin ? data.today.expenses : rows.reduce((sum, r) => sum + r.expense, 0)
    const net = totalIncome - totalExpense

    const unassignedIncome = totalIncome - rows.reduce((sum, r) => sum + r.income, 0)
    const unassignedExpense = totalExpense - rows.reduce((sum, r) => sum + r.expense, 0)
    if (unassignedIncome > 0 || unassignedExpense > 0) {
      rows.push({
        id: '__unassigned__',
        name: '未指定帳戶',
        income: Math.max(unassignedIncome, 0),
        expense: Math.max(unassignedExpense, 0),
      })
    }

    body = (
      <>
        <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-center">
            <div className="mb-1 text-sm text-gray-600 dark:text-gray-400">收入</div>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(totalIncome)}</div>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-center">
            <div className="mb-1 text-sm text-gray-600 dark:text-gray-400">支出</div>
            <div className="text-2xl font-bold text-red-600">{formatCurrency(totalExpense)}</div>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-center">
            <div className="mb-1 text-sm text-gray-600 dark:text-gray-400">淨額</div>
            <div className={`text-2xl font-bold ${net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatCurrency(net)}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full">
            <thead className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">帳戶</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">收入</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">支出</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                    沒有帳戶
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{row.name}</td>
                    <td className="px-4 py-3 text-right text-sm text-green-600">
                      {row.income > 0 ? formatCurrency(row.income) : <span className="text-gray-300 dark:text-gray-600">-</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-red-600">
                      {row.expense > 0 ? formatCurrency(row.expense) : <span className="text-gray-300 dark:text-gray-600">-</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </>
    )
  }

  const title = `現金流（${isToday ? '今天' : formatDateLabel(selectedDate)}）`

  if (collapsible) {
    return (
      <details open className="mb-6 rounded-lg bg-white dark:bg-gray-800 shadow">
        <summary className="cursor-pointer rounded-lg p-6 hover:bg-gray-50 dark:hover:bg-gray-700">
          <span className="text-xl font-semibold text-gray-900 dark:text-gray-100">{title}</span>
        </summary>
        <div className="px-6 pb-6">
          {dateBar}
          {body}
        </div>
      </details>
    )
  }

  return (
    <>
      {dateBar}
      {body}
    </>
  )
}
