'use client'

import React, { useState, useEffect } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { formatCurrency } from '@/lib/utils'
import { SWR_KEYS } from '@/lib/swr/keys'
import Link from 'next/link'
import { MoreHorizontal, Edit, Trash2, FileText } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useSubmitGuard } from '@/hooks/useSubmitGuard'
import NumberInput from '@/components/NumberInput'

type Account = {
  id: string
  account_name: string
  account_type: 'cash' | 'bank' | 'petty_cash'
  payment_method_code: string | null
  display_name: string | null
  balance: number
  is_active: boolean
  created_at: string
  updated_at: string
}

const ACCOUNT_TYPE_LABELS = {
  cash: '現金',
  bank: '銀行',
  petty_cash: '零用金',
}

export default function AccountsPage() {
  const { data: accounts = [], isLoading: loading, mutate } = useSWR<Account[]>(SWR_KEYS.ACCOUNTS)
  const { mutate: globalMutate } = useSWRConfig()
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const { isSubmitting, guardSubmit, stopSubmitting } = useSubmitGuard()
  const [formData, setFormData] = useState({
    account_name: '',
    account_type: 'cash' as 'cash' | 'bank' | 'petty_cash',
    balance: 0,
    is_active: true,
  })

  // Transfer State
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [transferData, setTransferData] = useState({
    fromAccountId: '',
    toAccountId: '',
    amount: 0,
    date: new Date().toISOString().split('T')[0],
    note: ''
  })

  // Adjustment State
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false)
  const [adjustmentData, setAdjustmentData] = useState({
    accountId: '',
    accountName: '',
    amount: '',  // Use string to allow typing negative numbers
    date: new Date().toISOString().split('T')[0],
    note: ''
  })

  useEffect(() => {
    // 自動修復沒有 payment_method_code 的帳戶
    fetch('/api/accounts/fix-payment-codes', { method: 'POST' }).then(() => mutate())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdjustment = (account: Account) => {
    setAdjustmentData({
      accountId: account.id,
      accountName: account.account_name,
      amount: '',  // Reset to empty string
      date: new Date().toISOString().split('T')[0],
      note: ''
    })
    setShowAdjustmentModal(true)
  }

  const submitAdjustment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!guardSubmit()) return
    try {
      const res = await fetch('/api/accounts/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: adjustmentData.accountId,
          amount: parseFloat(adjustmentData.amount) || 0,
          date: adjustmentData.date,
          note: adjustmentData.note
        })
      })
      const data = await res.json()
      if (data.ok) {
        alert('餘額調整成功！')
        setShowAdjustmentModal(false)
        mutate()
        globalMutate(SWR_KEYS.ACCOUNTS_ACTIVE)
      } else {
        alert(`調整失敗: ${data.error}`)
      }
    } catch (err) {
      alert('調整發生錯誤')
    } finally {
      stopSubmitting()
    }
  }

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!guardSubmit()) return
    try {
      const res = await fetch('/api/accounts/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transferData)
      })
      const data = await res.json()
      if (data.ok) {
        alert('轉帳成功！')
        setShowTransferModal(false)
        setTransferData({
          fromAccountId: '',
          toAccountId: '',
          amount: 0,
          date: new Date().toISOString().split('T')[0],
          note: ''
        })
        mutate()
        globalMutate(SWR_KEYS.ACCOUNTS_ACTIVE)
      } else {
        alert(`轉帳失敗: ${data.error}`)
      }
    } catch (err) {
      alert('轉帳發生錯誤')
    } finally {
      stopSubmitting()
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!guardSubmit()) return

    const url = editingAccount ? `/api/accounts/${editingAccount.id}` : '/api/accounts'
    const method = editingAccount ? 'PATCH' : 'POST'

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      const data = await res.json()

      if (data.ok) {
        alert(editingAccount ? '更新成功！' : '新增成功！')
        setShowAddForm(false)
        setEditingAccount(null)
        resetForm()
        mutate()
        globalMutate(SWR_KEYS.ACCOUNTS_ACTIVE)
      } else {
        alert(`操作失敗：${data.error}`)
      }
    } catch (err) {
      alert('操作失敗')
    } finally {
      stopSubmitting()
    }
  }

  const handleEdit = (account: Account) => {
    setEditingAccount(account)
    setFormData({
      account_name: account.account_name,
      account_type: account.account_type,
      balance: 0, // Not used for edit anymore
      is_active: account.is_active,
    })
    setShowAddForm(true)
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`確定要刪除帳戶「${name}」嗎？\n\n此操作無法復原。`)) {
      return
    }

    try {
      const res = await fetch(`/api/accounts/${id}`, {
        method: 'DELETE',
      })

      const data = await res.json()

      if (data.ok) {
        alert('刪除成功！')
        mutate()
        globalMutate(SWR_KEYS.ACCOUNTS_ACTIVE)
      } else {
        alert(`刪除失敗：${data.error}`)
      }
    } catch (err) {
      alert('刪除失敗')
    }
  }

  const resetForm = () => {
    setFormData({
      account_name: '',
      account_type: 'cash',
      balance: 0,
      is_active: true,
    })
  }

  const cancelEdit = () => {
    setShowAddForm(false)
    setEditingAccount(null)
    resetForm()
  }

  const groupedAccounts = {
    cash: accounts.filter((a) => a.account_type === 'cash'),
    bank: accounts.filter((a) => a.account_type === 'bank'),
    petty_cash: accounts.filter((a) => a.account_type === 'petty_cash'),
  }

  const totalBalance = accounts.reduce((sum, acc) => sum + acc.balance, 0)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">帳戶管理</h1>
          <div className="flex gap-4">
            <button
              onClick={() => setShowTransferModal(true)}
              className="rounded bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700"
            >
              資金轉帳
            </button>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
            >
              {showAddForm ? '取消' : '+ 新增帳戶'}
            </button>
          </div>
        </div>

        {/* Adjustment Modal */}
        {showAdjustmentModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAdjustmentModal(false)}>
            <div
              className="mx-4 w-full max-w-lg rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">
                餘額調整 - {adjustmentData.accountName}
              </h2>
              <form onSubmit={submitAdjustment} className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                    調整金額 (正數增加，負數減少)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={adjustmentData.amount}
                    onChange={(e) => {
                      // Allow empty, negative sign, and numbers
                      const value = e.target.value
                      if (value === '' || value === '-' || /^-?\d*\.?\d*$/.test(value)) {
                        setAdjustmentData({ ...adjustmentData, amount: value })
                      }
                    }}
                    className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none"
                    placeholder="輸入金額"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    例如：輸入 500 表示增加 $500；輸入 -500 表示減少 $500
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                    日期
                  </label>
                  <input
                    type="date"
                    required
                    value={adjustmentData.date}
                    onChange={(e) => setAdjustmentData({ ...adjustmentData, date: e.target.value })}
                    className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                    備註
                  </label>
                  <input
                    type="text"
                    value={adjustmentData.note}
                    onChange={(e) => setAdjustmentData({ ...adjustmentData, note: e.target.value })}
                    className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none"
                    placeholder="例如：期初開帳、盤點調整"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? '處理中...' : '確認調整'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAdjustmentModal(false)}
                    className="flex-1 rounded bg-gray-500 px-4 py-2 text-white hover:bg-gray-600"
                  >
                    取消
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Transfer Modal */}
        {showTransferModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowTransferModal(false)}>
            <div
              className="mx-4 w-full max-w-lg rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">
                資金轉帳 (零用金儲值)
              </h2>
              <form onSubmit={handleTransfer} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                      轉出帳戶 (From)
                    </label>
                    <select
                      required
                      value={transferData.fromAccountId}
                      onChange={(e) => setTransferData({ ...transferData, fromAccountId: e.target.value })}
                      className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">請選擇帳戶</option>
                      {accounts.map(acc => (
                        <option key={acc.id} value={acc.id} disabled={acc.id === transferData.toAccountId}>
                          {acc.account_name} (${formatCurrency(acc.balance)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                      轉入帳戶 (To)
                    </label>
                    <select
                      required
                      value={transferData.toAccountId}
                      onChange={(e) => setTransferData({ ...transferData, toAccountId: e.target.value })}
                      className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">請選擇帳戶</option>
                      {accounts.map(acc => (
                        <option key={acc.id} value={acc.id} disabled={acc.id === transferData.fromAccountId}>
                          {acc.account_name} (${formatCurrency(acc.balance)})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                    金額
                  </label>
                  <NumberInput
                    required
                    min="1"
                    value={transferData.amount}
                    onChange={(v) => setTransferData({ ...transferData, amount: v })}
                    emptyValue={0}
                    className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                    日期
                  </label>
                  <input
                    type="date"
                    required
                    value={transferData.date}
                    onChange={(e) => setTransferData({ ...transferData, date: e.target.value })}
                    className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                    備註
                  </label>
                  <input
                    type="text"
                    value={transferData.note}
                    onChange={(e) => setTransferData({ ...transferData, note: e.target.value })}
                    className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none"
                    placeholder="例如：零用金補充"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? '處理中...' : '確認轉帳'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTransferModal(false)}
                    className="flex-1 rounded bg-gray-500 px-4 py-2 text-white hover:bg-gray-600"
                  >
                    取消
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Add/Edit Modal */}
        {showAddForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={cancelEdit}>
            <div
              className="mx-4 w-full max-w-lg rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">
                {editingAccount ? '編輯帳戶' : '新增帳戶'}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                    帳戶名稱 *
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={formData.account_name}
                    onChange={(e) =>
                      setFormData({ ...formData, account_name: e.target.value })
                    }
                    className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none"
                    placeholder="例如：國泰銀行、富邦銀行"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                    帳戶類型 *
                  </label>
                  <select
                    required
                    value={formData.account_type}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        account_type: e.target.value as 'cash' | 'bank' | 'petty_cash',
                      })
                    }
                    className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="cash">現金</option>
                    <option value="bank">銀行</option>
                    <option value="petty_cash">零用金</option>
                  </select>
                </div>

                {/* Balance input removed - Use Adjustment instead */}

                <div className="flex items-center">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100">
                    <input
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={(e) =>
                        setFormData({ ...formData, is_active: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    啟用
                  </label>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? '處理中...' : (editingAccount ? '更新' : '新增')}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="flex-1 rounded bg-gray-500 px-4 py-2 text-white hover:bg-gray-600"
                  >
                    取消
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="mb-4 rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
          <div className="flex items-center justify-between">
            <span className="text-lg font-medium text-gray-900 dark:text-gray-100">總餘額</span>
            <span className="text-2xl font-bold text-green-600">
              {formatCurrency(totalBalance)}
            </span>
          </div>
        </div>

        {/* Accounts List */}
        {loading ? (
          <div className="rounded-lg bg-white dark:bg-gray-800 p-8 text-center text-gray-900 dark:text-gray-100 shadow">
            載入中...
          </div>
        ) : accounts.length === 0 ? (
          <div className="rounded-lg bg-white dark:bg-gray-800 p-8 text-center text-gray-900 dark:text-gray-100 shadow">
            <p className="mb-4">尚未建立任何帳戶</p>
            <button
              onClick={() => setShowAddForm(true)}
              className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            >
              新增第一個帳戶
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedAccounts).map(([type, accountList]) => {
              if (accountList.length === 0) return null

              return (
                <div
                  key={type}
                  className="rounded-lg bg-white dark:bg-gray-800 shadow"
                >
                  <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-3">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {ACCOUNT_TYPE_LABELS[type as keyof typeof ACCOUNT_TYPE_LABELS]}
                    </h2>
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
                          <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">
                            狀態
                          </th>
                          <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">
                            操作
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {accountList.map((account) => (
                          <tr
                            key={account.id}
                            className="hover:bg-gray-50 dark:hover:bg-gray-700"
                          >
                            <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                              {account.account_name}
                            </td>
                            <td className="px-6 py-4 text-right text-sm font-semibold">
                              <span
                                className={
                                  account.balance >= 0 ? 'text-green-600' : 'text-red-600'
                                }
                              >
                                {formatCurrency(account.balance)}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-center text-sm">
                              <span
                                className={`inline-block rounded px-2 py-1 text-xs font-medium ${account.is_active
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-gray-100 text-gray-800'
                                  }`}
                              >
                                {account.is_active ? '啟用' : '停用'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-center text-sm">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" className="h-8 w-8 p-0">
                                    <span className="sr-only">Open menu</span>
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <Link href={`/accounts/${account.id}`} className="w-full">
                                    <DropdownMenuItem className="cursor-pointer">
                                      <FileText className="mr-2 h-4 w-4" />
                                      查看明細
                                    </DropdownMenuItem>
                                  </Link>
                                  <DropdownMenuItem
                                    onClick={() => handleAdjustment(account)}
                                    className="cursor-pointer text-blue-600 focus:text-blue-600"
                                  >
                                    <Edit className="mr-2 h-4 w-4" />
                                    餘額調整
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleEdit(account)}
                                    className="cursor-pointer"
                                  >
                                    <Edit className="mr-2 h-4 w-4" />
                                    編輯
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleDelete(account.id, account.account_name)}
                                    className="cursor-pointer text-red-600 focus:text-red-600"
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    刪除
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
