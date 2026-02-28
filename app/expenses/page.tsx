'use client'

import React, { useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { useRouter } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SWR_KEYS, expensesKey } from '@/lib/swr/keys'
import { MoreHorizontal, Edit, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

type Expense = {
  id: number
  date: string
  category: string
  amount: number
  account_id: string | null
  note: string | null
  created_at: string
}

type Account = {
  id: string
  account_name: string
  account_type: string
  balance: number
}

type ExpenseWithAccount = Expense & {
  account?: Account
}

const EXPENSE_CATEGORIES = [
  '運費',
  '薪資支出',
  '租金支出',
  '文具用品',
  '旅費',
  '修繕費',
  '廣告費',
  '保險費',
  '交際費',
  '捐贈',
  '稅費',
  '伙食費',
  '職工福利',
  '傭金支出',
]

export default function ExpensesPage() {
  const router = useRouter()
  const { mutate: globalMutate } = useSWRConfig()
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [accountFilter, setAccountFilter] = useState<string>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [deleting, setDeleting] = useState<number | null>(null)

  // Auth
  const { data: authData } = useSWR<{ role: 'admin' | 'staff' }>(SWR_KEYS.AUTH_ME)
  const userRole = authData?.role ?? null
  const isAdmin = userRole === 'admin'

  // Accounts
  const { data: accounts = [] } = useSWR<Account[]>(SWR_KEYS.ACCOUNTS)

  // 員工只能看到零用金帳戶
  const availableAccounts = isAdmin ? accounts : accounts.filter(acc => acc.account_type === 'petty_cash')

  // Expenses
  const expenseSwrKey = expensesKey({
    ...(categoryFilter ? { category: categoryFilter } : {}),
    ...(accountFilter ? { account_id: accountFilter } : {}),
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
  })
  const { data: rawExpenses = [], isLoading: loading, mutate } = useSWR<any[]>(expenseSwrKey)
  // API 已經包含關聯的帳戶資訊（accounts 欄位），重命名為 account
  const expenses: ExpenseWithAccount[] = rawExpenses.map((expense: any) => ({
    ...expense,
    account: expense.accounts,
  }))

  const handleDelete = async (id: number, category: string) => {
    if (!confirm(`確定要刪除這筆「${category}」費用嗎？\n\n此操作無法復原。`)) {
      return
    }

    setDeleting(id)
    try {
      const res = await fetch(`/api/expenses/${id}`, {
        method: 'DELETE',
      })

      const data = await res.json()

      if (data.ok) {
        alert('刪除成功！')
        mutate()
        globalMutate(SWR_KEYS.ACCOUNTS)
      } else {
        alert(`刪除失敗：${data.error}`)
      }
    } catch (err) {
      alert('刪除失敗')
    } finally {
      setDeleting(null)
    }
  }

  // 員工只顯示零用金帳戶的費用
  const pettyAccountIds = new Set(accounts.filter(acc => acc.account_type === 'petty_cash').map(acc => acc.id))
  const displayedExpenses = isAdmin ? expenses : expenses.filter(exp => exp.account_id && pettyAccountIds.has(exp.account_id))
  const totalAmount = displayedExpenses.reduce((sum, exp) => sum + exp.amount, 0)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">會計記帳</h1>
          <button
            onClick={() => router.push('/expenses/new')}
            className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
          >
            + 新增費用
          </button>
        </div>

        {/* Filters */}
        <div className="mb-4 rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                費用類別
              </label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="">全部類別</option>
                {EXPENSE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                支出帳戶
              </label>
              <select
                value={accountFilter}
                onChange={(e) => setAccountFilter(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="">全部帳戶</option>
                {availableAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.account_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                起始日期
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none"
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
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="mb-4 rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-lg font-medium text-gray-900 dark:text-gray-100">總支出</span>
              <span className="text-2xl font-bold text-red-600">
                {formatCurrency(totalAmount)}
              </span>
            </div>
            {accountFilter && (
              <div className="flex items-center justify-between text-sm border-t pt-2">
                <span className="text-gray-600 dark:text-gray-400">
                  {accounts.find((a) => a.id === accountFilter)?.account_name} 支出
                </span>
                <span className="font-semibold text-red-600">
                  {formatCurrency(totalAmount)}
                </span>
              </div>
            )}
            {categoryFilter && (
              <div className="flex items-center justify-between text-sm border-t pt-2">
                <span className="text-gray-600 dark:text-gray-400">
                  {categoryFilter} 支出
                </span>
                <span className="font-semibold text-red-600">
                  {formatCurrency(totalAmount)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="rounded-lg bg-white dark:bg-gray-800 shadow">
          {loading ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">載入中...</div>
          ) : displayedExpenses.length === 0 ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">
              <p className="mb-4">尚未記錄任何費用</p>
              <button
                onClick={() => router.push('/expenses/new')}
                className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
              >
                新增第一筆費用
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">
                      日期
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">
                      類別
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">
                      支出帳戶
                    </th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
                      金額
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">
                      備註
                    </th>
                    <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {displayedExpenses.map((expense) => (
                    <tr key={expense.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                        {formatDate(expense.date)}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span className="inline-block rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800">
                          {expense.category}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {expense.account ? (
                          <span className="inline-block rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
                            {expense.account.account_name}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right text-sm font-semibold text-red-600">
                        {formatCurrency(expense.amount)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                        {expense.note || '-'}
                      </td>
                      <td className="px-6 py-4 text-center text-sm">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => router.push(`/expenses/${expense.id}/edit`)}>
                              <Edit className="mr-2 h-4 w-4" />
                              編輯
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDelete(expense.id, expense.category)}
                              disabled={deleting === expense.id}
                              className="text-red-600 focus:text-red-600"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              {deleting === expense.id ? '刪除中...' : '刪除'}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
