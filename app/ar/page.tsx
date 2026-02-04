'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency, formatDate, formatPaymentMethod } from '@/lib/utils'

type ARAccount = {
  id: string
  partner_code: string
  ref_type: string
  ref_id: string
  ref_no: string
  sale_item_id: string | null
  amount: number
  received_paid: number
  balance: number
  due_date: string
  status: string
  created_at: string
  sale_item?: {
    id: string
    quantity: number
    price: number
    subtotal: number
    snapshot_name: string
    product_id: string
    products: {
      item_code: string
      unit: string
    }
  }
  sale_items?: Array<{
    id: string
    quantity: number
    price: number
    subtotal: number
    snapshot_name: string
    product_id: string
    products: {
      item_code: string
      unit: string
    }
  }>
  sales?: {
    id: string
    sale_no: string
    sale_date: string
    payment_method: string
  } | null
}

type CustomerGroup = {
  partner_code: string
  customer_name: string
  store_credit: number
  accounts: ARAccount[]
  total_balance: number
  unpaid_count: number
}

type PaymentAccount = {
  id: string
  account_name: string
  payment_method_code: string
  display_name: string | null
  is_active: boolean
}

export default function ARPageV2() {
  const router = useRouter()
  const [accessDenied, setAccessDenied] = useState(false)
  const [customerGroups, setCustomerGroups] = useState<CustomerGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set())
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set())
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  const [receiptAmount, setReceiptAmount] = useState('')
  const [receiptMethod, setReceiptMethod] = useState('cash')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [currentCustomer, setCurrentCustomer] = useState<string | null>(null)
  const [updatingPayment, setUpdatingPayment] = useState<string | null>(null)
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([])

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

  // 新增：篩選狀態
  const [filterOverdue, setFilterOverdue] = useState(false)
  const [filterMinAmount, setFilterMinAmount] = useState<number | null>(null)
  const [filterDueThisWeek, setFilterDueThisWeek] = useState(false)
  const [filterBySaleNo, setFilterBySaleNo] = useState(false)
  const [saleNoInput, setSaleNoInput] = useState('')
  const [groupMode, setGroupMode] = useState<'customer' | 'sale'>('customer')

  // 分頁狀態
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize] = useState(50)
  const [totalPages, setTotalPages] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  // 工具函數：計算逾期天數
  const getDaysOverdue = (dueDate: string) => {
    const due = new Date(dueDate)
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    due.setHours(0, 0, 0, 0)
    const diff = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
    return diff
  }

  // 工具函數：計算到期倒數
  const getDaysUntilDue = (dueDate: string) => {
    const due = new Date(dueDate)
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    due.setHours(0, 0, 0, 0)
    const diff = Math.floor((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    return diff
  }

  // 工具函數：格式化到期日顯示
  const formatDueDate = (dueDate: string, status: string) => {
    if (status === 'paid') return formatDate(dueDate)

    const days = getDaysUntilDue(dueDate)
    if (days < 0) {
      return `已逾期 ${Math.abs(days)} 天 🔴`
    } else if (days === 0) {
      return '今天到期 🟠'
    } else if (days <= 3) {
      return `還有 ${days} 天 🟠`
    } else if (days <= 7) {
      return `還有 ${days} 天`
    }
    return formatDate(dueDate)
  }

  // 取得付款帳戶列表
  const fetchPaymentAccounts = async () => {
    try {
      const res = await fetch('/api/accounts?active_only=true')
      const data = await res.json()
      if (data.ok) {
        // 過濾掉 pending（待定不應該用於收款）
        const accounts = (data.data || []).filter(
          (acc: PaymentAccount) => acc.payment_method_code !== 'pending'
        )
        setPaymentAccounts(accounts)
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

      const res = await fetch(`/api/ar?${params}`)
      const data = await res.json()

      if (data.pagination) {
        setTotalPages(data.pagination.totalPages)
        setTotalCount(data.pagination.total)
      }

      if (data.ok) {
        if (groupMode === 'sale') {
          // 按單號分組
          const groups: { [key: string]: CustomerGroup } = {}

          data.data.forEach((account: any) => {
            const saleNo = account.sales?.sale_no || account.ref_no || account.ref_id
            const key = saleNo

            if (!groups[key]) {
              groups[key] = {
                partner_code: saleNo,
                customer_name: `${saleNo} - ${account.customers?.customer_name || account.partner_code}`,
                store_credit: account.customers?.store_credit || 0,
                accounts: [],
                total_balance: 0,
                unpaid_count: 0
              }
            }

            groups[key].accounts.push({
              ...account,
              ref_no: saleNo,
              sale_item: account.sale_item || null,
              sale_items: account.sale_items || [],
              sales: account.sales || null
            })

            if (account.status !== 'paid') {
              groups[key].total_balance += account.balance
              groups[key].unpaid_count++
            }
          })

          const sortedGroups = Object.values(groups).sort((a, b) => {
            // 按單號排序，新的在前面
            return b.partner_code.localeCompare(a.partner_code)
          })

          setCustomerGroups(sortedGroups)
        } else {
          // 按客戶分組
          const groups: { [key: string]: CustomerGroup } = {}

          data.data.forEach((account: any) => {
            const key = account.partner_code

            if (!groups[key]) {
              groups[key] = {
                partner_code: account.partner_code,
                customer_name: account.customers?.customer_name || account.partner_code,
                store_credit: account.customers?.store_credit || 0,
                accounts: [],
                total_balance: 0,
                unpaid_count: 0
              }
            }

            groups[key].accounts.push({
              ...account,
              ref_no: account.sales?.sale_no || account.ref_no || account.ref_id,
              sale_item: account.sale_item || null,
              sale_items: account.sale_items || [],
              sales: account.sales || null
            })

            // 只計算未收清的金額
            if (account.status !== 'paid') {
              groups[key].total_balance += account.balance
              groups[key].unpaid_count++
            }
          })

          // 轉換為陣列並排序（風險排序：逾期金額 > 逾期天數 > 總金額）
          const sortedGroups = Object.values(groups).sort((a, b) => {
            // 計算逾期金額
            const getOverdueAmount = (group: CustomerGroup) => {
              return group.accounts
                .filter(acc => acc.status !== 'paid' && new Date(acc.due_date) < new Date())
                .reduce((sum, acc) => sum + acc.balance, 0)
            }

            // 計算最長逾期天數
            const getMaxOverdueDays = (group: CustomerGroup) => {
              const overdueDays = group.accounts
                .filter(acc => acc.status !== 'paid' && new Date(acc.due_date) < new Date())
                .map(acc => getDaysOverdue(acc.due_date))
              return overdueDays.length > 0 ? Math.max(...overdueDays) : 0
            }

            const aOverdue = getOverdueAmount(a)
            const bOverdue = getOverdueAmount(b)

            if (aOverdue !== bOverdue) return bOverdue - aOverdue

            const aMaxDays = getMaxOverdueDays(a)
            const bMaxDays = getMaxOverdueDays(b)

            if (aMaxDays !== bMaxDays) return bMaxDays - aMaxDays

            return b.total_balance - a.total_balance
          })

          // 應用篩選
          const filtered = sortedGroups.filter(group => {
            if (filterOverdue) {
              const hasOverdue = group.accounts.some(acc =>
                acc.status !== 'paid' && new Date(acc.due_date) < new Date()
              )
              if (!hasOverdue) return false
            }

            if (filterMinAmount !== null && group.total_balance < filterMinAmount) {
              return false
            }

            if (filterDueThisWeek) {
              const weekEnd = new Date()
              weekEnd.setDate(weekEnd.getDate() + 7)
              const hasDueThisWeek = group.accounts.some(acc => {
                const due = new Date(acc.due_date)
                return acc.status !== 'paid' && due <= weekEnd && due >= new Date()
              })
              if (!hasDueThisWeek) return false
            }

            return true
          })

          setCustomerGroups(filtered)
        } // end of customer grouping
      }
    } catch (err) {
      console.error('Failed to fetch AR:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAccounts()
    fetchPaymentAccounts()
  }, [groupMode])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchAccounts()
  }

  const toggleCustomer = (partnerCode: string) => {
    const newExpanded = new Set(expandedCustomers)
    if (newExpanded.has(partnerCode)) {
      newExpanded.delete(partnerCode)
    } else {
      newExpanded.add(partnerCode)
    }
    setExpandedCustomers(newExpanded)
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

  const selectAllForCustomer = (partnerCode: string, checked: boolean) => {
    const group = customerGroups.find(g => g.partner_code === partnerCode)
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

  const openReceiptModal = (partnerCode: string) => {
    setCurrentCustomer(partnerCode)
    setShowReceiptModal(true)
    setError('')
  }

  const getSelectedTotal = () => {
    let total = 0
    customerGroups.forEach(group => {
      group.accounts.forEach(account => {
        if (selectedAccounts.has(account.id)) {
          total += account.balance
        }
      })
    })
    return total
  }

  const getCurrentCustomerStoreCredit = () => {
    if (!currentCustomer) return 0
    const group = customerGroups.find(g => g.partner_code === currentCustomer)
    return group?.store_credit || 0
  }

  const handleReceipt = async () => {
    if (selectedAccounts.size === 0) {
      setError('請選擇至少一筆帳款')
      return
    }

    const amount = parseFloat(receiptAmount)
    const selectedTotal = getSelectedTotal()

    if (isNaN(amount) || amount <= 0) {
      setError('請輸入正確的金額')
      return
    }

    if (amount > selectedTotal) {
      setError('收款金額不能超過所選帳款總額')
      return
    }

    // 購物金餘額檢查
    if (receiptMethod === 'store_credit') {
      const storeCredit = getCurrentCustomerStoreCredit()
      if (amount > storeCredit) {
        setError(`購物金餘額不足，目前餘額: ${formatCurrency(storeCredit)}`)
        return
      }
    }

    setProcessing(true)
    setError('')

    try {
      // 按比例分配金額
      let remaining = amount
      const allocations = Array.from(selectedAccounts).map((accountId, index, arr) => {
        const account = customerGroups
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

      const res = await fetch('/api/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner_code: currentCustomer,
          method: receiptMethod,
          amount,
          allocations
        })
      })

      const data = await res.json()

      if (data.ok) {
        alert('收款成功！')
        setShowReceiptModal(false)
        setSelectedAccounts(new Set())
        setReceiptAmount('')
        setCurrentCustomer(null)
        fetchAccounts()
      } else {
        setError(data.error || '收款失敗')
      }
    } catch (err) {
      setError('收款失敗')
    } finally {
      setProcessing(false)
    }
  }

  const handleUpdatePaymentMethod = async (saleId: string, paymentMethod: string) => {
    setUpdatingPayment(saleId)
    try {
      const res = await fetch(`/api/sales/${saleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_method: paymentMethod })
      })

      const data = await res.json()

      if (data.ok) {
        // Update local state
        setCustomerGroups(prevGroups =>
          prevGroups.map(group => ({
            ...group,
            accounts: group.accounts.map(account =>
              account.sales?.id === saleId && account.sales
                ? { ...account, sales: { ...account.sales, payment_method: paymentMethod } }
                : account
            )
          }))
        )
      } else {
        alert('更新失敗: ' + (data.error || '未知錯誤'))
      }
    } catch (err) {
      alert('更新失敗')
    } finally {
      setUpdatingPayment(null)
    }
  }

  const totalUnpaid = customerGroups.reduce((sum, g) => sum + g.total_balance, 0)
  const totalCustomers = customerGroups.filter(g => g.unpaid_count > 0).length

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
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">應收帳款</h1>
        </div>

        {/* Summary */}
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
            <div className="text-sm text-gray-900 dark:text-gray-100">未收總額</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {formatCurrency(totalUnpaid)}
            </div>
            <div className="text-sm text-gray-900 dark:text-gray-100">{totalCustomers} 位客戶</div>
          </div>

          <div className="rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
            <div className="text-sm text-gray-900 dark:text-gray-100">已選擇</div>
            <div className="text-2xl font-bold text-blue-600">
              {formatCurrency(getSelectedTotal())}
            </div>
            <div className="text-sm text-gray-900 dark:text-gray-100">{selectedAccounts.size} 筆</div>
          </div>

          <div className="rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
            <div className="text-sm text-gray-900 dark:text-gray-100">單據總數</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {customerGroups.reduce((sum, g) => sum + g.unpaid_count, 0)}
            </div>
            <div className="text-sm text-gray-900 dark:text-gray-100">筆未收</div>
          </div>
        </div>

        {/* Search */}
        <div className="mb-6 rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
          <form onSubmit={handleSearch} className="mb-3 flex gap-2">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜尋客戶名稱、代碼或銷貨單號"
              className="flex-1 rounded border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700 placeholder:text-gray-900 dark:placeholder:text-gray-400"
            />
            <button
              type="submit"
              className="rounded bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700"
            >
              搜尋
            </button>
          </form>

          {/* 分組方式切換 */}
          <div className="mb-3 flex gap-2">
            <span className="text-sm text-gray-600 dark:text-gray-400 self-center">分組方式：</span>
            <button
              onClick={() => setGroupMode('customer')}
              className={`rounded px-3 py-1 text-sm font-medium transition-colors ${groupMode === 'customer'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
            >
              👤 按客戶
            </button>
            <button
              onClick={() => setGroupMode('sale')}
              className={`rounded px-3 py-1 text-sm font-medium transition-colors ${groupMode === 'sale'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
            >
              🔢 按單號
            </button>
          </div>

          {/* 快捷篩選 */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setFilterOverdue(!filterOverdue)
                setFilterMinAmount(null)
                setFilterDueThisWeek(false)
              }}
              className={`rounded px-3 py-1 text-sm font-medium transition-colors ${filterOverdue
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
            >
              🔴 只看逾期
            </button>
            <button
              onClick={() => {
                setFilterMinAmount(filterMinAmount === 10000 ? null : 10000)
                setFilterOverdue(false)
                setFilterDueThisWeek(false)
              }}
              className={`rounded px-3 py-1 text-sm font-medium transition-colors ${filterMinAmount === 10000
                ? 'bg-purple-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
            >
              💰 金額 &gt; 10,000
            </button>
            <button
              onClick={() => {
                setFilterDueThisWeek(!filterDueThisWeek)
                setFilterOverdue(false)
                setFilterMinAmount(null)
              }}
              className={`rounded px-3 py-1 text-sm font-medium transition-colors ${filterDueThisWeek
                ? 'bg-orange-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
            >
              📅 本週到期
            </button>
            <button
              onClick={() => {
                setFilterBySaleNo(!filterBySaleNo)
                if (!filterBySaleNo) {
                  setFilterOverdue(false)
                  setFilterMinAmount(null)
                  setFilterDueThisWeek(false)
                }
              }}
              className={`rounded px-3 py-1 text-sm font-medium transition-colors ${filterBySaleNo
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
            >
              🔢 按單號篩選
            </button>
            {(filterOverdue || filterMinAmount !== null || filterDueThisWeek || filterBySaleNo) && (
              <button
                onClick={() => {
                  setFilterOverdue(false)
                  setFilterMinAmount(null)
                  setFilterDueThisWeek(false)
                  setFilterBySaleNo(false)
                  setSaleNoInput('')
                }}
                className="rounded px-3 py-1 text-sm font-medium bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500"
              >
                清除篩選
              </button>
            )}
          </div>

          {/* 按單號篩選輸入框 */}
          {filterBySaleNo && (
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={saleNoInput}
                onChange={(e) => setSaleNoInput(e.target.value.toUpperCase())}
                placeholder="輸入銷售單號（如 S0001）"
                className="flex-1 rounded border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700 placeholder:text-gray-500 dark:placeholder:text-gray-400"
                autoFocus
              />
              <button
                onClick={() => {
                  if (saleNoInput.trim()) {
                    setKeyword(saleNoInput.trim())
                    fetchAccounts()
                  }
                }}
                className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
              >
                查詢
              </button>
            </div>
          )}
        </div>

        {/* Customer Groups */}
        <div className="rounded-lg bg-white dark:bg-gray-800 shadow">
          {loading ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">載入中...</div>
          ) : customerGroups.length === 0 ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">沒有應收帳款</div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {customerGroups.map((group) => {
                const isExpanded = expandedCustomers.has(group.partner_code)
                const unpaidAccounts = group.accounts.filter(a => a.status !== 'paid')
                const allSelected = unpaidAccounts.length > 0 &&
                  unpaidAccounts.every(a => selectedAccounts.has(a.id))

                // 計算逾期金額
                const overdueAmount = group.accounts
                  .filter(acc => acc.status !== 'paid' && new Date(acc.due_date) < new Date())
                  .reduce((sum, acc) => sum + acc.balance, 0)

                // 計算已收/總額百分比
                const totalAmount = group.accounts.reduce((sum, acc) => sum + acc.amount, 0)
                // 修正：如果 status 為 paid，使用 amount 作為已收金額；否則使用 received_paid
                const receivedAmount = group.accounts.reduce((sum, acc) => {
                  return sum + (acc.status === 'paid' ? acc.amount : acc.received_paid)
                }, 0)
                const receivedPercentage = totalAmount > 0 ? (receivedAmount / totalAmount) * 100 : 0

                // 找到最近的銷售日期
                const latestSaleDate = unpaidAccounts
                  .filter(acc => acc.sales?.sale_date)
                  .map(acc => acc.sales!.sale_date)
                  .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]

                return (
                  <div key={group.partner_code} className="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
                    {/* Customer Header */}
                    <div className="flex items-center gap-4 p-4 hover:bg-gray-50 dark:hover:bg-gray-700">
                      <div
                        className="flex-1 cursor-pointer dark:text-gray-100"
                        onClick={() => toggleCustomer(group.partner_code)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-blue-600">
                              {isExpanded ? '▼' : '▶'}
                            </span>
                            <span className="font-semibold text-gray-900 dark:text-gray-100">
                              {group.customer_name}
                            </span>
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                              ({group.partner_code})
                            </span>
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <div className="text-sm text-gray-500 dark:text-gray-400">未收款</div>
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
                          const customerSelectedAccounts = unpaidAccounts.filter(a => selectedAccounts.has(a.id))
                          if (customerSelectedAccounts.length > 0) {
                            openReceiptModal(group.partner_code)
                          }
                        }}
                        disabled={unpaidAccounts.filter(a => selectedAccounts.has(a.id)).length === 0}
                        className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:bg-gray-300"
                      >
                        收款
                      </button>
                    </div>

                    {/* Account Details */}
                    {isExpanded && (
                      <div className="bg-gray-50 dark:bg-gray-900 px-4 pb-4">
                        <table className="w-full table-fixed">
                          <thead className="border-b border-gray-200 dark:border-gray-700">
                            <tr>
                              <th className="pb-2 pl-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400" style={{ width: '40px' }}></th>
                              <th className="pb-2 pl-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400" style={{ width: '100px' }}>銷售單號</th>
                              <th className="pb-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">商品</th>
                              <th className="pb-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 pr-4" style={{ width: '80px' }}>數量</th>
                              <th className="pb-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 pr-6" style={{ width: '110px' }}>餘額</th>
                              <th className="pb-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400" style={{ width: '140px' }}>銷售日</th>
                              <th className="pb-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-400" style={{ width: '90px' }}>狀態</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {group.accounts.map((account) => {
                              const daysOverdue = getDaysOverdue(account.due_date)
                              const isOverdue = account.status !== 'paid' && daysOverdue > 0

                              return (
                                <tr key={account.id} className="hover:bg-white dark:hover:bg-gray-800">
                                  <td className="py-3 pl-2 align-top">
                                    <input
                                      type="checkbox"
                                      checked={selectedAccounts.has(account.id)}
                                      onChange={() => toggleAccount(account.id)}
                                      disabled={account.status === 'paid'}
                                      className="h-4 w-4"
                                    />
                                  </td>
                                  <td className="py-3 pl-2 text-sm text-gray-900 dark:text-gray-100 align-top">
                                    <div className="font-medium">{account.ref_no}</div>
                                  </td>
                                  <td className="py-3 text-sm text-gray-900 dark:text-gray-100 align-top">
                                    {account.sale_item ? (
                                      <div className="min-h-[44px] flex flex-col justify-center">
                                        <div className="font-medium">{account.sale_item.snapshot_name}</div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400">{account.sale_item.products.item_code}</div>
                                      </div>
                                    ) : account.sale_items && account.sale_items.length > 0 ? (
                                      <div>
                                        {account.sale_items.map((item, idx) => (
                                          <div key={item.id} className={`min-h-[44px] flex flex-col justify-center ${idx > 0 ? 'border-t border-gray-200 dark:border-gray-700' : ''}`}>
                                            <div className="font-medium">{item.snapshot_name}</div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400">{item.products.item_code}</div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-gray-400">-</span>
                                    )}
                                  </td>
                                  <td className="py-3 text-right text-sm align-top text-gray-900 dark:text-gray-100 pr-4">
                                    {account.sale_item ? (
                                      <div className="min-h-[44px] flex items-center justify-end">{account.sale_item.quantity} {account.sale_item.products.unit}</div>
                                    ) : account.sale_items && account.sale_items.length > 0 ? (
                                      <div>
                                        {account.sale_items.map((item, idx) => (
                                          <div key={item.id} className={`min-h-[44px] flex items-center justify-end ${idx > 0 ? 'border-t border-gray-200 dark:border-gray-700' : ''}`}>
                                            {item.quantity} {item.products.unit}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-gray-400">-</span>
                                    )}
                                  </td>
                                  <td className="py-3 text-right align-top pr-6">
                                    <div className="font-semibold text-base text-gray-900 dark:text-gray-100">
                                      {formatCurrency(account.balance)}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                      / {formatCurrency(account.amount)}
                                    </div>
                                  </td>
                                  <td className="py-3 align-top">
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                      {account.sales?.sale_date ? formatDate(account.sales.sale_date) : '-'}
                                    </div>
                                  </td>
                                  <td className="py-3 text-center align-top">
                                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${account.status === 'paid'
                                      ? 'text-green-700 dark:text-green-400'
                                      : account.status === 'partial'
                                        ? 'text-orange-600 dark:text-orange-400'
                                        : 'text-red-600 dark:text-red-400'
                                      }`}>
                                      {account.status === 'paid' ? '🟢' :
                                        account.status === 'partial' ? '🟠' : '🔴'}
                                      {account.status === 'paid' ? '已收清' :
                                        account.status === 'partial' ? '部分收款' : '未收'}
                                    </span>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
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
          <div className="mt-4 rounded-lg bg-white dark:bg-gray-800 p-4 shadow flex items-center justify-between">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              共 {totalCount} 筆資料，第 {currentPage} / {totalPages} 頁
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const newPage = currentPage - 1
                  setCurrentPage(newPage)
                  fetchAccounts(newPage)
                }}
                disabled={currentPage === 1}
                className="rounded px-3 py-1 text-sm font-medium bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                上一頁
              </button>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => {
                  const newPage = currentPage + 1
                  setCurrentPage(newPage)
                  fetchAccounts(newPage)
                }}
                disabled={currentPage === totalPages}
                className="rounded px-3 py-1 text-sm font-medium bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                下一頁
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Receipt Modal */}
      {showReceiptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-6">
            <h3 className="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">收款</h3>

            {error && (
              <div className="mb-4 rounded bg-red-50 dark:bg-red-900 p-3 text-red-700 dark:text-red-200">{error}</div>
            )}

            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                已選擇 {selectedAccounts.size} 筆帳款
              </label>
              <div className="rounded bg-gray-50 dark:bg-gray-700 p-3 text-lg font-bold text-gray-900 dark:text-gray-100">
                應收總額: {formatCurrency(getSelectedTotal())}
              </div>
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                收款金額 *
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={receiptAmount}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '' || /^\d*$/.test(v)) {
                    setReceiptAmount(v)
                  }
                }}
                className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                placeholder="輸入收款金額"
                autoFocus
              />
              <button
                onClick={() => setReceiptAmount(String(getSelectedTotal()))}
                className="mt-2 text-sm text-blue-600 hover:underline"
              >
                全額收款
              </button>
            </div>

            <div className="mb-6">
              <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                收款方式
              </label>
              <select
                value={receiptMethod}
                onChange={(e) => setReceiptMethod(e.target.value)}
                className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
              >
                {paymentAccounts.map((account) => (
                  <option key={account.id} value={account.payment_method_code}>
                    {account.display_name || account.account_name}
                  </option>
                ))}
                <option value="store_credit">購物金抵扣</option>
              </select>
              {receiptMethod === 'store_credit' && (
                <div className="mt-2 p-3 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-amber-800 dark:text-amber-200">客戶購物金餘額</span>
                    <span className="text-lg font-bold text-amber-600 dark:text-amber-400">
                      {formatCurrency(getCurrentCustomerStoreCredit())}
                    </span>
                  </div>
                  {parseFloat(receiptAmount) > getCurrentCustomerStoreCredit() && receiptAmount !== '' && (
                    <div className="mt-1 text-xs text-red-600 dark:text-red-400">
                      收款金額超過購物金餘額
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowReceiptModal(false)
                  setError('')
                  setReceiptAmount('')
                  setCurrentCustomer(null)
                }}
                className="flex-1 rounded border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
              >
                取消
              </button>
              <button
                onClick={handleReceipt}
                disabled={processing}
                className="flex-1 rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:bg-gray-300"
              >
                {processing ? '處理中...' : '確認收款'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
