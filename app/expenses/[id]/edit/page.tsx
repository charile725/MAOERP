'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'

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

type Account = {
  id: string
  account_name: string
  account_type: string
  balance: number
  is_active: boolean
}

type PageProps = {
  params: Promise<{ id: string }>
}

export default function EditExpensePage({ params }: PageProps) {
  const router = useRouter()
  const [id, setId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [userRole, setUserRole] = useState<'admin' | 'staff' | null>(null)
  const [formData, setFormData] = useState({
    date: '',
    category: EXPENSE_CATEGORIES[0],
    amount: '',
    account_id: '',
    note: '',
  })

  const isAdmin = userRole === 'admin'

  useEffect(() => {
    fetchUserRole()
    fetchAccounts()
    params.then((p) => {
      setId(p.id)
      fetchExpense(p.id)
    })
  }, [params])

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

  const fetchAccounts = async () => {
    try {
      const res = await fetch('/api/accounts?active_only=true')
      const data = await res.json()
      if (data.ok) {
        setAccounts(data.data || [])
      }
    } catch (err) {
      console.error('Failed to fetch accounts:', err)
    }
  }

  // 員工只能使用零用金帳戶
  const availableAccounts = isAdmin ? accounts : accounts.filter(acc => acc.account_type === 'petty_cash')

  const fetchExpense = async (expenseId: string) => {
    try {
      const res = await fetch(`/api/expenses/${expenseId}`)
      const data = await res.json()

      if (data.ok) {
        const expense = data.data
        setFormData({
          date: expense.date,
          category: expense.category,
          amount: expense.amount.toString(),
          account_id: expense.account_id || '',
          note: expense.note || '',
        })
      } else {
        setError('找不到該費用')
      }
    } catch (err) {
      setError('載入失敗')
    } finally {
      setFetching(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id) return

    setLoading(true)
    setError('')

    try {
      const res = await fetch(`/api/expenses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          amount: parseInt(formData.amount) || 0,
        }),
      })

      const data = await res.json()

      if (data.ok) {
        alert('費用已更新！')
        router.push('/expenses')
      } else {
        setError(data.error || '更新失敗')
      }
    } catch (err) {
      setError('更新失敗')
    } finally {
      setLoading(false)
    }
  }

  if (fetching) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 dark:bg-gray-900">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-lg bg-white p-8 text-center shadow dark:bg-gray-800 dark:text-gray-100">
            載入中...
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 dark:bg-gray-900">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">編輯費用</h1>
        </div>

        <div className="rounded-lg bg-white p-4 shadow dark:bg-gray-800 md:p-6">
          {error && (
            <div className="mb-4 rounded border border-red-400 bg-red-50 px-4 py-3 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Date */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100">
                日期 <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) =>
                  setFormData({ ...formData, date: e.target.value })
                }
                required
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>

            {/* Category */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100">
                費用類別 <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.category}
                onChange={(e) =>
                  setFormData({ ...formData, category: e.target.value })
                }
                required
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              >
                {EXPENSE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {/* Account */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100">
                支出帳戶 <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.account_id}
                onChange={(e) =>
                  setFormData({ ...formData, account_id: e.target.value })
                }
                required
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              >
                <option value="">請選擇帳戶</option>
                {availableAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.account_name} ({formatCurrency(acc.balance)})
                  </option>
                ))}
              </select>
            </div>

            {/* Amount */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100">
                金額 <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-gray-900 dark:text-gray-100">$</span>
                <input
                  type="number"
                  value={formData.amount}
                  onChange={(e) =>
                    setFormData({ ...formData, amount: e.target.value })
                  }
                  required
                  min="1"
                  step="1"
                  className="w-full rounded border border-gray-300 bg-white py-2 pl-8 pr-3 text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  placeholder="0"
                />
              </div>
              {formData.amount && (
                <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                  {formatCurrency(parseInt(formData.amount) || 0)}
                </p>
              )}
            </div>

            {/* Note */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100">
                備註
              </label>
              <textarea
                value={formData.note}
                onChange={(e) =>
                  setFormData({ ...formData, note: e.target.value })
                }
                rows={3}
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                placeholder="選填"
              />
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {loading ? '更新中...' : '更新費用'}
              </button>
              <button
                type="button"
                onClick={() => router.push('/expenses')}
                className="rounded border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                取消
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
