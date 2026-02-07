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

export default function FinanceDashboardPage() {
  const [data, setData] = useState<FinanceData | null>(null)
  const [loading, setLoading] = useState(true)
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

  useEffect(() => {
    fetchUserRole()
    fetchFinanceData()
  }, [])

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
