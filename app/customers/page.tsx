'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { Customer } from '@/types'
import { MoreHorizontal, Edit, Trash2, Wallet, TrendingUp, TrendingDown, History } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [activeFilter, setActiveFilter] = useState<boolean | null>(null)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [formData, setFormData] = useState<Partial<Customer>>({})
  const [error, setError] = useState('')
  const [processing, setProcessing] = useState(false)

  // 分頁狀態
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  // 购物金调整相关状态
  const [adjustingCustomer, setAdjustingCustomer] = useState<Customer | null>(null)
  const [adjustAmount, setAdjustAmount] = useState<string>('')
  const [adjustType, setAdjustType] = useState<'recharge' | 'deduct' | 'adjustment'>('recharge')
  const [adjustNote, setAdjustNote] = useState('')
  const [adjustError, setAdjustError] = useState('')

  // 購物金記錄相關狀態
  type BalanceLog = {
    id: string
    amount: number
    balance_before: number
    balance_after: number
    type: string
    ref_type: string | null
    ref_no: string | null
    note: string | null
    created_at: string
  }
  const [balanceLogsCustomer, setBalanceLogsCustomer] = useState<Customer | null>(null)
  const [balanceLogs, setBalanceLogs] = useState<BalanceLog[]>([])
  const [balanceLogsLoading, setBalanceLogsLoading] = useState(false)

  // 客户损益数据
  type CustomerProfit = {
    customer_code: string
    total_sales: number
    total_cost: number
    net_profit: number
    order_count: number
  }
  const [profitData, setProfitData] = useState<Record<string, CustomerProfit>>({})
  const [showProfit, setShowProfit] = useState(true)
  const [profitDateFrom, setProfitDateFrom] = useState('')
  const [profitDateTo, setProfitDateTo] = useState('')
  const [profitLoading, setProfitLoading] = useState(false)
  const [profitSortField, setProfitSortField] = useState<'net_profit' | 'total_sales' | 'total_cost' | null>('net_profit')
  const [profitSortDir, setProfitSortDir] = useState<'asc' | 'desc'>('desc')

  const fetchCustomers = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (keyword) params.set('keyword', keyword)
      if (activeFilter !== null) params.set('active', String(activeFilter))

      const res = await fetch(`/api/customers?${params}`)
      const data = await res.json()
      if (data.ok) {
        setCustomers(data.data || [])
      }
    } catch (err) {
      console.error('Failed to fetch customers:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchProfitData = async (dateFrom?: string, dateTo?: string) => {
    setProfitLoading(true)
    try {
      const params = new URLSearchParams()
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)

      const res = await fetch(`/api/customers/profit?${params}`)
      const data = await res.json()
      if (data.ok) {
        const profitMap: Record<string, CustomerProfit> = {}
        for (const item of data.data || []) {
          profitMap[item.customer_code] = item
        }
        setProfitData(profitMap)
      }
    } catch (err) {
      console.error('Failed to fetch profit data:', err)
    } finally {
      setProfitLoading(false)
    }
  }

  useEffect(() => {
    fetchCustomers()
    fetchProfitData()
  }, [activeFilter])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setCurrentPage(1) // 搜尋時重置到第一頁
    fetchCustomers()
  }

  // 排序和分頁計算
  const sortedCustomers = showProfit && profitSortField
    ? [...customers].sort((a, b) => {
      const profitA = profitData[a.customer_code]
      const profitB = profitData[b.customer_code]
      const valA = profitA?.[profitSortField] || 0
      const valB = profitB?.[profitSortField] || 0
      return profitSortDir === 'desc' ? valB - valA : valA - valB
    })
    : customers

  const totalPages = Math.ceil(sortedCustomers.length / pageSize)
  const paginatedCustomers = sortedCustomers.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const handleProfitSort = (field: 'net_profit' | 'total_sales' | 'total_cost') => {
    if (profitSortField === field) {
      setProfitSortDir(profitSortDir === 'desc' ? 'asc' : 'desc')
    } else {
      setProfitSortField(field)
      setProfitSortDir('desc')
    }
    setCurrentPage(1)
  }

  const openEditModal = (customer: Customer) => {
    setEditingCustomer(customer)
    setFormData(customer)
    setError('')
  }

  const closeEditModal = () => {
    setEditingCustomer(null)
    setFormData({})
    setError('')
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingCustomer) return

    setProcessing(true)
    setError('')

    try {
      const res = await fetch(`/api/customers?id=${editingCustomer.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      const data = await res.json()

      if (data.ok) {
        fetchCustomers()
        closeEditModal()
      } else {
        setError(data.error || '更新失敗')
      }
    } catch (err) {
      setError('更新失敗')
    } finally {
      setProcessing(false)
    }
  }

  const handleDelete = async (customer: Customer) => {
    if (!confirm(`確定要刪除客戶「${customer.customer_name}」嗎？\n\n此操作無法復原。`)) {
      return
    }

    try {
      const res = await fetch(`/api/customers?id=${customer.id}`, {
        method: 'DELETE',
      })

      const data = await res.json()

      if (data.ok) {
        fetchCustomers()
        alert('刪除成功')
      } else {
        alert(data.error || '刪除失敗')
      }
    } catch (err) {
      alert('刪除失敗')
    }
  }

  const openAdjustModal = (customer: Customer) => {
    setAdjustingCustomer(customer)
    setAdjustAmount('')
    setAdjustType('recharge')
    setAdjustNote('')
    setAdjustError('')
  }

  const closeAdjustModal = () => {
    setAdjustingCustomer(null)
    setAdjustAmount('')
    setAdjustType('recharge')
    setAdjustNote('')
    setAdjustError('')
  }

  const handleAdjustBalance = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!adjustingCustomer) return

    const amount = parseFloat(adjustAmount)
    if (isNaN(amount) || amount === 0) {
      setAdjustError('請輸入有效的金額')
      return
    }

    setProcessing(true)
    setAdjustError('')

    try {
      // 根据类型计算实际金额
      let finalAmount = amount
      if (adjustType === 'deduct') {
        finalAmount = -Math.abs(amount)
      } else if (adjustType === 'recharge') {
        finalAmount = Math.abs(amount)
      }

      const res = await fetch('/api/customers/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_code: adjustingCustomer.customer_code,
          amount: finalAmount,
          type: adjustType,
          note: adjustNote || undefined,
        }),
      })

      const data = await res.json()

      if (data.ok) {
        fetchCustomers()
        closeAdjustModal()
        alert('調整成功')
      } else {
        setAdjustError(data.error || '調整失敗')
      }
    } catch (err) {
      setAdjustError('調整失敗')
    } finally {
      setProcessing(false)
    }
  }

  const fetchBalanceLogs = async (customerCode: string) => {
    setBalanceLogsLoading(true)
    try {
      const res = await fetch(`/api/customers/balance-logs?customer_code=${customerCode}`)
      const data = await res.json()
      if (data.ok) {
        setBalanceLogs(data.data || [])
      }
    } catch (err) {
      console.error('Failed to fetch balance logs:', err)
    } finally {
      setBalanceLogsLoading(false)
    }
  }

  const openBalanceLogsModal = (customer: Customer) => {
    setBalanceLogsCustomer(customer)
    fetchBalanceLogs(customer.customer_code)
  }

  const closeBalanceLogsModal = () => {
    setBalanceLogsCustomer(null)
    setBalanceLogs([])
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">客戶管理</h1>
          <Link
            href="/customers/new"
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            + 新增客戶
          </Link>
        </div>

        {/* Filters */}
        <div className="mb-6 rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
          <form onSubmit={handleSearch} className="mb-4 flex gap-2">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜尋客戶名稱、編號、電話、地址"
              className="flex-1 rounded border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700 placeholder:text-gray-900 dark:placeholder:text-gray-400"
            />
            <button
              type="submit"
              className="rounded bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700"
            >
              搜尋
            </button>
          </form>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setActiveFilter(null)}
              className={`rounded px-4 py-1 font-medium ${activeFilter === null
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
            >
              全部
            </button>
            <button
              onClick={() => setActiveFilter(true)}
              className={`rounded px-4 py-1 font-medium ${activeFilter === true
                ? 'bg-green-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
            >
              啟用
            </button>
            <button
              onClick={() => setActiveFilter(false)}
              className={`rounded px-4 py-1 font-medium ${activeFilter === false
                ? 'bg-red-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
            >
              停用
            </button>
            <div className="border-l border-gray-300 dark:border-gray-600 mx-2"></div>
            <button
              onClick={() => setShowProfit(!showProfit)}
              className={`rounded px-4 py-1 font-medium flex items-center gap-1 ${showProfit
                ? 'bg-purple-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
            >
              {showProfit ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              損益
            </button>
          </div>

          {/* 损益日期区间筛选 */}
          {showProfit && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">損益區間：</span>
                <input
                  type="date"
                  value={profitDateFrom}
                  onChange={(e) => setProfitDateFrom(e.target.value)}
                  className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                />
                <span className="text-gray-500 dark:text-gray-400">~</span>
                <input
                  type="date"
                  value={profitDateTo}
                  onChange={(e) => setProfitDateTo(e.target.value)}
                  className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                />
                <button
                  onClick={() => fetchProfitData(profitDateFrom, profitDateTo)}
                  disabled={profitLoading}
                  className="rounded bg-purple-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:bg-gray-400"
                >
                  {profitLoading ? '載入中...' : '查詢'}
                </button>
                <button
                  onClick={() => {
                    setProfitDateFrom('')
                    setProfitDateTo('')
                    fetchProfitData()
                  }}
                  className="rounded bg-gray-200 dark:bg-gray-700 px-4 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  全部
                </button>
                {(profitDateFrom || profitDateTo) && (
                  <span className="text-sm text-purple-600 dark:text-purple-400 font-medium">
                    {profitDateFrom || '起始'} ~ {profitDateTo || '至今'}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Customers table */}
        <div className="rounded-lg bg-white dark:bg-gray-800 shadow">
          {loading ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">載入中...</div>
          ) : customers.length === 0 ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">沒有客戶資料</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">客戶編號</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">客戶名稱</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">電話</th>
                    {!showProfit && <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">門市地址</th>}
                    {!showProfit && <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">宅配地址</th>}
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-400">購物金</th>
                    {showProfit && (
                      <th
                        className="px-4 py-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 select-none"
                        onClick={() => handleProfitSort('total_sales')}
                      >
                        總銷售 {profitSortField === 'total_sales' && (profitSortDir === 'desc' ? '↓' : '↑')}
                      </th>
                    )}
                    {showProfit && (
                      <th
                        className="px-4 py-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 select-none"
                        onClick={() => handleProfitSort('total_cost')}
                      >
                        總成本 {profitSortField === 'total_cost' && (profitSortDir === 'desc' ? '↓' : '↑')}
                      </th>
                    )}
                    {showProfit && (
                      <th
                        className="px-4 py-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 select-none"
                        onClick={() => handleProfitSort('net_profit')}
                      >
                        淨損益 {profitSortField === 'net_profit' && (profitSortDir === 'desc' ? '↓' : '↑')}
                      </th>
                    )}
                    {!showProfit && <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">付款方式</th>}
                    {!showProfit && <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">LINE ID</th>}
                    <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-400">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {paginatedCustomers.map((customer) => {
                    const profit = profitData[customer.customer_code]
                    return (
                      <tr key={customer.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{customer.customer_code}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{customer.customer_name}</td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{customer.phone || '-'}</td>
                        {!showProfit && (
                          <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                            <div className="max-w-[200px] truncate" title={customer.store_address || ''}>
                              {customer.store_address || '-'}
                            </div>
                          </td>
                        )}
                        {!showProfit && (
                          <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                            <div className="max-w-[200px] truncate" title={customer.delivery_address || ''}>
                              {customer.delivery_address || '-'}
                            </div>
                          </td>
                        )}
                        <td className="px-4 py-3 text-sm text-right">
                          <span className={`font-bold ${customer.store_credit >= 0
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-red-600 dark:text-red-400'
                            }`}>
                            ${customer.store_credit?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                          </span>
                        </td>
                        {showProfit && (
                          <td className="px-4 py-3 text-sm text-right text-blue-600 dark:text-blue-400 font-medium">
                            ${profit?.total_sales?.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) || '0'}
                          </td>
                        )}
                        {showProfit && (
                          <td className="px-4 py-3 text-sm text-right text-orange-600 dark:text-orange-400 font-medium">
                            ${profit?.total_cost?.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) || '0'}
                          </td>
                        )}
                        {showProfit && (
                          <td className="px-4 py-3 text-sm text-right">
                            <span className={`font-bold ${(profit?.net_profit || 0) >= 0
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-red-600 dark:text-red-400'
                              }`}>
                              {(profit?.net_profit || 0) >= 0 ? '+' : ''}${profit?.net_profit?.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) || '0'}
                            </span>
                          </td>
                        )}
                        {!showProfit && (
                          <td className="px-4 py-3 text-sm text-center">
                            <span className="inline-block px-2 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                              {customer.payment_method === 'cash' && '現金'}
                              {customer.payment_method === 'card' && '刷卡'}
                              {customer.payment_method === 'transfer' && '轉帳'}
                              {customer.payment_method === 'cod' && '貨到付款'}
                              {!customer.payment_method && '-'}
                            </span>
                          </td>
                        )}
                        {!showProfit && <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{customer.line_id || '-'}</td>}
                        <td className="px-4 py-3 text-center text-sm">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openAdjustModal(customer)}>
                                <Wallet className="mr-2 h-4 w-4" />
                                調整購物金
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openBalanceLogsModal(customer)}>
                                <History className="mr-2 h-4 w-4" />
                                購物金記錄
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openEditModal(customer)}>
                                <Edit className="mr-2 h-4 w-4" />
                                編輯
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleDelete(customer)}
                                className="text-red-600 focus:text-red-600"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                刪除
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* 分頁控制 */}
          {!loading && customers.length > 0 && (
            <div className="px-6 py-4 border-t dark:border-gray-700 flex items-center justify-between">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                共 {customers.length} 筆資料，顯示第 {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, customers.length)} 筆
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setCurrentPage(1)
                  }}
                  className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                >
                  <option value={10}>10 筆/頁</option>
                  <option value={20}>20 筆/頁</option>
                  <option value={50}>50 筆/頁</option>
                  <option value={100}>100 筆/頁</option>
                </select>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="rounded px-3 py-1 text-sm font-medium bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  上一頁
                </button>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="rounded px-3 py-1 text-sm font-medium bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  下一頁
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white dark:bg-gray-800 p-6">
            <h2 className="mb-4 text-2xl font-semibold text-gray-900 dark:text-gray-100">編輯客戶</h2>

            {error && (
              <div className="mb-4 rounded bg-red-50 dark:bg-red-900 p-3 text-red-700 dark:text-red-200">{error}</div>
            )}

            <form onSubmit={handleUpdate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                    客戶編號 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.customer_code || ''}
                    onChange={(e) => setFormData({ ...formData, customer_code: e.target.value })}
                    className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                    客戶名稱 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.customer_name || ''}
                    onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                    className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">電話</label>
                  <input
                    type="text"
                    value={formData.phone || ''}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">LINE ID</label>
                  <input
                    type="text"
                    value={formData.line_id || ''}
                    onChange={(e) => setFormData({ ...formData, line_id: e.target.value })}
                    className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">付款方式</label>
                  <select
                    value={formData.payment_method || ''}
                    onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
                    className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                  >
                    <option value="">請選擇</option>
                    <option value="cash">現金</option>
                    <option value="card">刷卡</option>
                    <option value="transfer">轉帳</option>
                    <option value="cod">貨到付款</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">門市地址</label>
                <input
                  type="text"
                  value={formData.store_address || ''}
                  onChange={(e) => setFormData({ ...formData, store_address: e.target.value })}
                  className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                  placeholder="客戶店面地址"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">宅配地址</label>
                <input
                  type="text"
                  value={formData.delivery_address || ''}
                  onChange={(e) => setFormData({ ...formData, delivery_address: e.target.value })}
                  className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                  placeholder="宅配或郵寄地址"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">備註</label>
                <textarea
                  value={formData.note || ''}
                  onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                  rows={3}
                  className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">購物金餘額</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.store_credit ?? 0}
                    onChange={(e) => setFormData({ ...formData, store_credit: parseFloat(e.target.value) || 0 })}
                    className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                    disabled
                    title="請使用「調整購物金」按鈕進行修改"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">購物金請使用下方的「調整購物金」按鈕修改</p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">信用額度</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.credit_limit ?? 0}
                    onChange={(e) => setFormData({ ...formData, credit_limit: parseFloat(e.target.value) || 0 })}
                    className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">設為 0 表示不允許欠款</p>
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_active ?? true}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="h-4 w-4"
                  />
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">啟用</span>
                </label>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closeEditModal}
                  className="flex-1 rounded border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-800 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={processing}
                  className="flex-1 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-gray-300"
                >
                  {processing ? '更新中...' : '確認更新'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjust Balance Modal */}
      {adjustingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-6">
            <h2 className="mb-4 text-2xl font-semibold text-gray-900 dark:text-gray-100">調整購物金</h2>

            <div className="mb-4 rounded-lg bg-gray-50 dark:bg-gray-700 p-4">
              <div className="mb-2">
                <span className="text-sm font-medium text-gray-600 dark:text-gray-300">客戶：</span>
                <span className="ml-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {adjustingCustomer.customer_name} ({adjustingCustomer.customer_code})
                </span>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-600 dark:text-gray-300">當前餘額：</span>
                <span className={`ml-2 text-lg font-bold ${adjustingCustomer.store_credit >= 0
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400'
                  }`}>
                  ${adjustingCustomer.store_credit?.toFixed(2) || '0.00'}
                </span>
              </div>
              {adjustingCustomer.credit_limit > 0 && (
                <div className="mt-2">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300">信用額度：</span>
                  <span className="ml-2 text-sm text-gray-900 dark:text-gray-100">
                    ${adjustingCustomer.credit_limit.toFixed(2)}
                  </span>
                </div>
              )}
            </div>

            {adjustError && (
              <div className="mb-4 rounded bg-red-50 dark:bg-red-900/30 p-3 text-red-700 dark:text-red-200">{adjustError}</div>
            )}

            <form onSubmit={handleAdjustBalance} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                  調整類型 <span className="text-red-500">*</span>
                </label>
                <select
                  value={adjustType}
                  onChange={(e) => setAdjustType(e.target.value as any)}
                  className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                  required
                >
                  <option value="recharge">充值（增加購物金）</option>
                  <option value="deduct">扣減（減少購物金）</option>
                  <option value="adjustment">調整（可正可負）</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                  金額 <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                  placeholder="請輸入金額"
                  required
                />
                {adjustType === 'adjustment' && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">正數為增加，負數為減少</p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">備註</label>
                <textarea
                  value={adjustNote}
                  onChange={(e) => setAdjustNote(e.target.value)}
                  rows={3}
                  className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                  placeholder="選填"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closeAdjustModal}
                  className="flex-1 rounded border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={processing}
                  className="flex-1 rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:bg-gray-300 dark:disabled:bg-gray-600"
                >
                  {processing ? '處理中...' : '確認調整'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Balance Logs Modal */}
      {balanceLogsCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="w-full max-w-2xl max-h-[80vh] rounded-lg bg-white dark:bg-gray-800 p-6 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">購物金記錄</h2>
              <button
                onClick={closeBalanceLogsModal}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                ✕
              </button>
            </div>

            <div className="mb-4 rounded-lg bg-gray-50 dark:bg-gray-700 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300">客戶：</span>
                  <span className="ml-2 font-semibold text-gray-900 dark:text-gray-100">
                    {balanceLogsCustomer.customer_name} ({balanceLogsCustomer.customer_code})
                  </span>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300">當前餘額：</span>
                  <span className={`ml-2 text-lg font-bold ${balanceLogsCustomer.store_credit >= 0
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                    }`}>
                    ${balanceLogsCustomer.store_credit?.toFixed(2) || '0.00'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {balanceLogsLoading ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">載入中...</div>
              ) : balanceLogs.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">沒有購物金異動記錄</div>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">日期</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">類型</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-400">金額</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-400">餘額</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">備註</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {balanceLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString('zh-TW', {
                            year: 'numeric', month: '2-digit', day: '2-digit',
                            hour: '2-digit', minute: '2-digit'
                          })}
                        </td>
                        <td className="px-3 py-2 text-sm">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${log.type === 'recharge' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                            log.type === 'deduct' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                              log.type === 'sale' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
                                log.type === 'refund' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' :
                                  'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                            }`}>
                            {log.type === 'recharge' && '充值'}
                            {log.type === 'deduct' && '扣減'}
                            {log.type === 'sale' && '消費'}
                            {log.type === 'refund' && '退款'}
                            {log.type === 'adjustment' && '調整'}
                            {!['recharge', 'deduct', 'sale', 'refund', 'adjustment'].includes(log.type) && log.type}
                          </span>
                        </td>
                        <td className={`px-3 py-2 text-sm text-right font-medium ${log.amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                          }`}>
                          {log.amount >= 0 ? '+' : ''}{log.amount.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-sm text-right text-gray-900 dark:text-gray-100">
                          {log.balance_after?.toFixed(2) || '-'}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 max-w-[200px] truncate" title={log.note || ''}>
                          {log.ref_no && <span className="text-blue-600 dark:text-blue-400">{log.ref_no}</span>}
                          {log.ref_no && log.note && ' - '}
                          {log.note || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="mt-4 pt-4 border-t dark:border-gray-700">
              <button
                onClick={closeBalanceLogsModal}
                className="w-full rounded bg-gray-200 dark:bg-gray-700 px-4 py-2 font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
