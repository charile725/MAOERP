'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'

type APAccount = {
  id: string
  partner_code: string
  ref_type: string
  ref_id: string
  ref_no: string
  purchase_item_id: string | null
  amount: number
  received_paid: number
  balance: number
  due_date: string
  status: string
  created_at: string
  purchase_item?: {
    id: string
    quantity: number
    cost: number
    subtotal: number
    product_id: string
    products: {
      name: string
      item_code: string
      unit: string
    }
  }
  purchases?: {
    id: string
    purchase_no: string
  } | null
}

type VendorGroup = {
  partner_code: string
  vendor_name: string
  accounts: APAccount[]
  total_balance: number
  unpaid_count: number
}

type PaymentAccount = {
  id: string
  account_name: string
  display_name: string
  payment_method_code: string
  balance: number
  sort_order: number
}

export default function APPageV2() {
  const router = useRouter()
  const [accessDenied, setAccessDenied] = useState(false)
  const [vendorGroups, setVendorGroups] = useState<VendorGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set())
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set())
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentAccountId, setPaymentAccountId] = useState('')
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([])
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [currentVendor, setCurrentVendor] = useState<string | null>(null)

  // 分頁狀態
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [totalPages, setTotalPages] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  // 權限檢查
  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        if (!data.ok || data.data?.role !== 'admin') {
          setAccessDenied(true)
          setTimeout(() => router.push('/'), 2000)
        }
      })
      .catch(() => {
        setAccessDenied(true)
        setTimeout(() => router.push('/'), 2000)
      })
  }, [router])

  // 載入付款帳戶列表
  const fetchPaymentAccounts = async () => {
    try {
      const res = await fetch('/api/accounts?active_only=true')
      const data = await res.json()
      if (data.ok) {
        // 顯示所有活躍帳戶（排除 pending）
        const accounts = (data.data as PaymentAccount[])
          .filter(a => a.payment_method_code !== 'pending')
          .sort((a, b) => a.sort_order - b.sort_order)
        setPaymentAccounts(accounts)
        // 預設選擇第一個帳戶
        if (accounts.length > 0 && !paymentAccountId) {
          setPaymentAccountId(accounts[0].id)
        }
      }
    } catch (err) {
      console.error('Failed to fetch payment accounts:', err)
    }
  }

  const fetchAccounts = async (page = currentPage) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (keyword) params.set('keyword', keyword)
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))

      const res = await fetch(`/api/ap?${params}`)
      const data = await res.json()

      if (data.pagination) {
        setTotalPages(data.pagination.totalPages)
        setTotalCount(data.pagination.total)
      }

      if (data.ok) {
        // 按廠商分組
        const groups: { [key: string]: VendorGroup } = {}

        data.data.forEach((account: any) => {
          const key = account.partner_code

          if (!groups[key]) {
            groups[key] = {
              partner_code: account.partner_code,
              vendor_name: account.vendors?.vendor_name || account.partner_code,
              accounts: [],
              total_balance: 0,
              unpaid_count: 0
            }
          }

          groups[key].accounts.push({
            ...account,
            ref_no: account.purchases?.purchase_no || account.ref_id
          })

          if (account.status !== 'paid') {
            groups[key].total_balance += account.balance
            groups[key].unpaid_count += 1
          }
        })

        setVendorGroups(Object.values(groups))
      }
    } catch (err) {
      console.error('Failed to fetch AP:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAccounts()
    fetchPaymentAccounts()
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchAccounts()
  }

  const toggleVendor = (partnerCode: string) => {
    const newExpanded = new Set(expandedVendors)
    if (newExpanded.has(partnerCode)) {
      newExpanded.delete(partnerCode)
    } else {
      newExpanded.add(partnerCode)
    }
    setExpandedVendors(newExpanded)
  }

  const toggleAccount = (accountId: string) => {
    const newSelected = new Set(selectedAccounts)
    if (newSelected.has(accountId)) {
      newSelected.delete(accountId)
    } else {
      newSelected.add(accountId)
    }
    setSelectedAccounts(newSelected)
  }

  const selectAllForVendor = (partnerCode: string, checked: boolean) => {
    const group = vendorGroups.find(g => g.partner_code === partnerCode)
    if (!group) return

    const newSelected = new Set(selectedAccounts)

    group.accounts
      .filter(a => a.status !== 'paid')
      .forEach(account => {
        if (checked) {
          newSelected.add(account.id)
        } else {
          newSelected.delete(account.id)
        }
      })

    setSelectedAccounts(newSelected)
  }

  const openPaymentModal = (partnerCode: string) => {
    setCurrentVendor(partnerCode)
    setShowPaymentModal(true)
    setError('')
  }

  const getSelectedTotal = () => {
    let total = 0
    vendorGroups.forEach(group => {
      group.accounts.forEach(account => {
        if (selectedAccounts.has(account.id)) {
          total += account.balance
        }
      })
    })
    return total
  }

  const handlePayment = async () => {
    if (selectedAccounts.size === 0) {
      setError('請選擇至少一筆帳款')
      return
    }

    const amount = parseFloat(paymentAmount)
    const selectedTotal = getSelectedTotal()

    if (isNaN(amount) || amount <= 0) {
      setError('請輸入正確的金額')
      return
    }

    if (amount > selectedTotal) {
      setError('付款金額不能超過所選帳款總額')
      return
    }

    if (!paymentAccountId) {
      setError('請選擇付款帳戶')
      return
    }

    // 取得選擇的帳戶資訊
    const selectedPaymentAccount = paymentAccounts.find(a => a.id === paymentAccountId)
    if (!selectedPaymentAccount) {
      setError('找不到選擇的付款帳戶')
      return
    }

    setProcessing(true)
    setError('')

    try {
      // 按比例分配金額
      let remaining = amount
      const allocations = Array.from(selectedAccounts).map((accountId, index, arr) => {
        const account = vendorGroups
          .flatMap(g => g.accounts)
          .find(a => a.id === accountId)!

        const isLast = index === arr.length - 1
        const allocatedAmount = isLast
          ? remaining
          : Math.min(account.balance, remaining)

        remaining -= allocatedAmount

        return {
          partner_account_id: accountId,
          amount: allocatedAmount
        }
      }).filter(a => a.amount > 0)

      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner_code: currentVendor,
          method: selectedPaymentAccount.payment_method_code || 'cash',
          account_id: paymentAccountId,
          amount,
          allocations
        })
      })

      const data = await res.json()

      if (data.ok) {
        alert('付款成功！帳戶餘額已更新')
        setShowPaymentModal(false)
        setSelectedAccounts(new Set())
        setPaymentAmount('')
        setCurrentVendor(null)
        fetchAccounts()
        fetchPaymentAccounts() // 重新載入帳戶餘額
      } else {
        setError(data.error || '付款失敗')
      }
    } catch (err) {
      setError('付款失敗')
    } finally {
      setProcessing(false)
    }
  }

  const totalUnpaid = vendorGroups.reduce((sum, g) => sum + g.total_balance, 0)
  const totalVendors = vendorGroups.filter(g => g.unpaid_count > 0).length

  // 權限不足時顯示提示
  if (accessDenied) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🚫</div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">權限不足</h1>
          <p className="text-gray-600 dark:text-gray-400">您沒有權限訪問此頁面，正在返回首頁...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">應付帳款</h1>
        </div>

        {/* Summary */}
        <div className="mb-4 sm:mb-6 grid grid-cols-3 gap-2 sm:gap-4">
          <div className="rounded-lg bg-white dark:bg-gray-800 p-3 sm:p-4 shadow">
            <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">未付總額</div>
            <div className="text-base sm:text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">
              {formatCurrency(totalUnpaid)}
            </div>
            <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">{totalVendors} 家廠商</div>
          </div>

          <div className="rounded-lg bg-white dark:bg-gray-800 p-3 sm:p-4 shadow">
            <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">已選擇</div>
            <div className="text-base sm:text-2xl font-bold text-blue-600 truncate">
              {formatCurrency(getSelectedTotal())}
            </div>
            <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">{selectedAccounts.size} 筆</div>
          </div>

          <div className="rounded-lg bg-white dark:bg-gray-800 p-3 sm:p-4 shadow">
            <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">單據總數</div>
            <div className="text-base sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
              {vendorGroups.reduce((sum, g) => sum + g.unpaid_count, 0)}
            </div>
            <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">筆未付</div>
          </div>
        </div>

        {/* Search */}
        <div className="mb-4 sm:mb-6 rounded-lg bg-white dark:bg-gray-800 p-3 sm:p-4 shadow">
          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜尋廠商名稱或代碼"
              className="flex-1 rounded border border-gray-300 dark:border-gray-600 px-3 sm:px-4 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700 placeholder:text-gray-500 dark:placeholder:text-gray-400 min-h-[44px]"
            />
            <button
              type="submit"
              className="rounded bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700 min-h-[44px]"
            >
              搜尋
            </button>
          </form>
        </div>

        {/* Vendor Groups */}
        <div className="rounded-lg bg-white dark:bg-gray-800 shadow">
          {loading ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">載入中...</div>
          ) : vendorGroups.length === 0 ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">沒有應付帳款</div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {vendorGroups.map((group) => {
                const isExpanded = expandedVendors.has(group.partner_code)
                const unpaidAccounts = group.accounts.filter(a => a.status !== 'paid')
                const allSelected = unpaidAccounts.length > 0 &&
                  unpaidAccounts.every(a => selectedAccounts.has(a.id))

                return (
                  <div key={group.partner_code}>
                    {/* Vendor Header */}
                    <div className="flex items-center gap-4 p-4 hover:bg-gray-50 dark:hover:bg-gray-700">
                      <div
                        className="flex-1 cursor-pointer dark:text-gray-100"
                        onClick={() => toggleVendor(group.partner_code)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-blue-600">
                              {isExpanded ? '▼' : '▶'}
                            </span>
                            <span className="font-semibold text-gray-900 dark:text-gray-100">
                              {group.vendor_name}
                            </span>
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                              ({group.partner_code})
                            </span>
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <div className="text-sm text-gray-500 dark:text-gray-400">未付款</div>
                              <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                                {formatCurrency(group.total_balance)}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {group.unpaid_count} 筆單據
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          const vendorSelectedAccounts = unpaidAccounts.filter(a => selectedAccounts.has(a.id))
                          if (vendorSelectedAccounts.length > 0) {
                            openPaymentModal(group.partner_code)
                          }
                        }}
                        disabled={unpaidAccounts.filter(a => selectedAccounts.has(a.id)).length === 0}
                        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
                      >
                        付款
                      </button>
                    </div>

                    {/* Account Details */}
                    {isExpanded && (
                      <div className="bg-gray-50 dark:bg-gray-900 px-2 sm:px-4 pb-4">
                        {/* Mobile Card Layout */}
                        <div className="sm:hidden space-y-3">
                          {group.accounts.map((account) => {
                            const isOverdue = account.status !== 'paid' &&
                              new Date(account.due_date) < new Date()

                            return (
                              <div key={account.id} className="bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm border border-gray-200 dark:border-gray-700">
                                <div className="flex items-start justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={selectedAccounts.has(account.id)}
                                      onChange={() => toggleAccount(account.id)}
                                      disabled={account.status === 'paid'}
                                      className="h-5 w-5"
                                    />
                                    <div>
                                      <div className="font-medium text-gray-900 dark:text-gray-100">{account.ref_no}</div>
                                      {account.purchase_item && (
                                        <div className="text-xs text-gray-500">{account.purchase_item.products.name}</div>
                                      )}
                                    </div>
                                  </div>
                                  <span className={`inline-block rounded px-2 py-1 text-xs ${
                                    account.status === 'paid'
                                      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                      : account.status === 'partial'
                                      ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                                      : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                                  }`}>
                                    {account.status === 'paid' ? '已付清' :
                                     account.status === 'partial' ? '部分' : '未付'}
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                                  <div>
                                    <span className="text-gray-500 dark:text-gray-400">餘額：</span>
                                    <span className="font-semibold text-gray-900 dark:text-gray-100">{formatCurrency(account.balance)}</span>
                                  </div>
                                  <div>
                                    <span className="text-gray-500 dark:text-gray-400">到期：</span>
                                    <span className={isOverdue ? 'text-red-500 font-medium' : 'text-gray-900 dark:text-gray-100'}>
                                      {formatDate(account.due_date)}
                                    </span>
                                  </div>
                                </div>
                                <button
                                  onClick={() => {
                                    setSelectedAccounts(new Set([account.id]))
                                    openPaymentModal(group.partner_code)
                                  }}
                                  disabled={account.status === 'paid'}
                                  className="w-full rounded bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed min-h-[44px]"
                                >
                                  付款
                                </button>
                              </div>
                            )
                          })}
                        </div>

                        {/* Desktop Table Layout */}
                        <div className="hidden sm:block overflow-x-auto">
                          <table className="w-full">
                            <thead className="border-b border-gray-200 dark:border-gray-700">
                              <tr>
                                <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100"></th>
                                <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">進貨單號</th>
                                <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">商品</th>
                                <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">數量</th>
                                <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">應付金額</th>
                                <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">已付金額</th>
                                <th className="pb-2 pr-4 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">餘額</th>
                                <th className="pb-2 pl-4 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">到期日</th>
                                <th className="pb-2 text-center text-xs font-semibold text-gray-900 dark:text-gray-100">狀態</th>
                                <th className="pb-2 text-center text-xs font-semibold text-gray-900 dark:text-gray-100">操作</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                              {group.accounts.map((account) => {
                                const isOverdue = account.status !== 'paid' &&
                                  new Date(account.due_date) < new Date()

                                return (
                                  <tr key={account.id} className="hover:bg-white dark:hover:bg-gray-800">
                                    <td className="py-2">
                                      <input
                                        type="checkbox"
                                        checked={selectedAccounts.has(account.id)}
                                        onChange={() => toggleAccount(account.id)}
                                        disabled={account.status === 'paid'}
                                        className="h-4 w-4"
                                      />
                                    </td>
                                    <td className="py-2 text-sm text-gray-900 dark:text-gray-100">
                                      {account.ref_no}
                                    </td>
                                    <td className="py-2 text-sm text-gray-900 dark:text-gray-100">
                                      {account.purchase_item ? (
                                        <div>
                                          <div className="font-medium">{account.purchase_item.products.name}</div>
                                          <div className="text-xs text-gray-500 dark:text-gray-400">{account.purchase_item.products.item_code}</div>
                                        </div>
                                      ) : (
                                        <span className="text-gray-400">-</span>
                                      )}
                                    </td>
                                    <td className="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                                      {account.purchase_item ? (
                                        `${account.purchase_item.quantity} ${account.purchase_item.products.unit}`
                                      ) : (
                                        <span className="text-gray-400">-</span>
                                      )}
                                    </td>
                                    <td className="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                                      {formatCurrency(account.amount)}
                                    </td>
                                    <td className="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                                      {formatCurrency(account.received_paid)}
                                    </td>
                                    <td className="py-2 pr-4 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
                                      {formatCurrency(account.balance)}
                                    </td>
                                    <td className={`py-2 pl-4 text-sm ${isOverdue ? 'font-semibold text-red-500' : 'text-gray-900 dark:text-gray-100'}`}>
                                      {formatDate(account.due_date)}
                                      {isOverdue && ' (逾期)'}
                                    </td>
                                    <td className="py-2 text-center">
                                      <span className={`inline-block rounded px-2 py-1 text-xs ${
                                        account.status === 'paid'
                                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                          : account.status === 'partial'
                                          ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                                          : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                                      }`}>
                                        {account.status === 'paid' ? '已付清' :
                                         account.status === 'partial' ? '部分付款' : '未付'}
                                      </span>
                                    </td>
                                    <td className="py-2 text-center">
                                      <button
                                        onClick={() => {
                                          setSelectedAccounts(new Set([account.id]))
                                          openPaymentModal(group.partner_code)
                                        }}
                                        disabled={account.status === 'paid'}
                                        className="rounded bg-blue-500 px-3 py-1 text-xs font-medium text-white hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
                                      >
                                        付款
                                      </button>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 分頁控制 */}
        {!loading && totalPages > 1 && (
          <div className="mt-4 rounded-lg bg-white dark:bg-gray-800 p-3 sm:p-4 shadow flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4 w-full sm:w-auto">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                共 {totalCount} 筆，第 {currentPage}/{totalPages} 頁
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400">每頁</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setCurrentPage(1)
                    fetchAccounts(1)
                  }}
                  className="rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 min-h-[44px]"
                >
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
                <span className="text-sm text-gray-600 dark:text-gray-400">筆</span>
              </div>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto justify-center">
              <button
                onClick={() => {
                  const newPage = currentPage - 1
                  setCurrentPage(newPage)
                  fetchAccounts(newPage)
                }}
                disabled={currentPage === 1}
                className="flex-1 sm:flex-none rounded px-4 py-2 text-sm font-medium bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
              >
                上一頁
              </button>
              <span className="text-sm text-gray-600 dark:text-gray-400 px-2">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => {
                  const newPage = currentPage + 1
                  setCurrentPage(newPage)
                  fetchAccounts(newPage)
                }}
                disabled={currentPage === totalPages}
                className="flex-1 sm:flex-none rounded px-4 py-2 text-sm font-medium bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
              >
                下一頁
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-6">
            <h3 className="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">付款</h3>

            {error && (
              <div className="mb-4 rounded bg-red-50 dark:bg-red-900 p-3 text-red-700 dark:text-red-200">{error}</div>
            )}

            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                已選擇 {selectedAccounts.size} 筆帳款
              </label>
              <div className="rounded bg-gray-50 dark:bg-gray-700 p-3 text-lg font-bold text-gray-900 dark:text-gray-100">
                應付總額: {formatCurrency(getSelectedTotal())}
              </div>
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                付款金額 *
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={paymentAmount}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '' || /^\d*$/.test(v)) {
                    setPaymentAmount(v)
                  }
                }}
                className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                placeholder="輸入付款金額"
                autoFocus
              />
              <button
                onClick={() => setPaymentAmount(String(getSelectedTotal()))}
                className="mt-2 text-sm text-blue-600 hover:underline"
              >
                全額付款
              </button>
            </div>

            <div className="mb-6">
              <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                付款帳戶 *
              </label>
              <select
                value={paymentAccountId}
                onChange={(e) => setPaymentAccountId(e.target.value)}
                className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
              >
                {paymentAccounts.length === 0 ? (
                  <option value="">載入中...</option>
                ) : (
                  paymentAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.account_name} (餘額: {formatCurrency(account.balance)})
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowPaymentModal(false)
                  setError('')
                  setPaymentAmount('')
                  setCurrentVendor(null)
                }}
                className="flex-1 rounded border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
              >
                取消
              </button>
              <button
                onClick={handlePayment}
                disabled={processing}
                className="flex-1 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-gray-300"
              >
                {processing ? '處理中...' : '確認付款'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
