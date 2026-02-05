'use client'

import React, { useState, useEffect, use } from 'react'
import { formatCurrency, formatDate } from '@/lib/utils'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'

type Account = {
    id: string
    account_name: string
    account_type: 'cash' | 'bank' | 'petty_cash'
    balance: number
    is_active: boolean
    updated_at: string
}

type Transaction = {
    id: string
    created_at: string
    transaction_type: string
    amount: number
    balance_before: number
    balance_after: number
    ref_type: string
    ref_id: string
    ref_no: string | null
    note: string | null
    // Enriched fields
    customer_name?: string | null
    customer_code?: string | null
    vendor_name?: string | null
    vendor_code?: string | null
    original_payment_method?: string | null
}

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
    sale: '銷售收入',
    expense: '支出',
    purchase_payment: '採購付款',
    customer_payment: '客戶收款',
    adjustment: '餘額調整',
    settlement: '結算',
    transfer_out: '轉出',
    transfer_in: '轉入',
}

export default function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params)
    const [account, setAccount] = useState<Account | null>(null)
    const [transactions, setTransactions] = useState<Transaction[]>([])
    const [loading, setLoading] = useState(true)

    // Filtering & Pagination State
    const [dateRange, setDateRange] = useState({
        startDate: '',
        endDate: ''
    })
    const [pageSize, setPageSize] = useState(20)
    const [pagination, setPagination] = useState({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0
    })

    useEffect(() => {
        fetchAccountInfo()
    }, [id])

    useEffect(() => {
        fetchTransactions()
    }, [id, pagination.page, pagination.limit, dateRange])

    const fetchAccountInfo = async () => {
        try {
            const accRes = await fetch(`/api/accounts/${id}`)
            const accData = await accRes.json()
            if (accData.ok) {
                setAccount(accData.data)
            }
        } catch (err) {
            console.error('Failed to fetch account:', err)
        }
    }

    const fetchTransactions = async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams({
                page: pagination.page.toString(),
                limit: pagination.limit.toString(),
            })

            if (dateRange.startDate) params.append('startDate', dateRange.startDate)
            if (dateRange.endDate) params.append('endDate', dateRange.endDate)

            const txRes = await fetch(`/api/accounts/${id}/transactions?${params.toString()}`)
            const txData = await txRes.json()

            if (txData.ok) {
                setTransactions(txData.data || [])
                setPagination(prev => ({
                    ...prev,
                    total: txData.meta?.total || 0,
                    totalPages: txData.meta?.totalPages || 0
                }))
            }
        } catch (err) {
            console.error('Failed to fetch transactions:', err)
        } finally {
            setLoading(false)
        }
    }

    const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target
        setDateRange(prev => ({ ...prev, [name]: value }))
        setPagination(prev => ({ ...prev, page: 1 })) // Reset to page 1 on filter change
    }

    const clearDates = () => {
        setDateRange({ startDate: '', endDate: '' })
        setPagination(prev => ({ ...prev, page: 1 }))
    }

    if (!account && !loading) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8 text-center">
                <div className="text-red-600">找不到帳戶</div>
                <Link href="/accounts" className="mt-4 inline-block text-blue-600 hover:underline">
                    返回帳戶列表
                </Link>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
            <div className="mx-auto max-w-7xl">
                {/* Header */}
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4">
                        <Link
                            href="/accounts"
                            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                        >
                            ← 返回
                        </Link>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                            {account?.account_name} <span className="text-base font-normal text-gray-500">交易明細</span>
                        </h1>
                    </div>
                    <div className="text-right">
                        <div className="text-sm text-gray-500 dark:text-gray-400">目前餘額</div>
                        <div className={`text-2xl font-bold ${account?.balance && account.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(account?.balance || 0)}
                        </div>
                    </div>
                </div>

                {/* Filters */}
                <div className="mb-6 flex flex-wrap items-end gap-4 rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                            開始日期
                        </label>
                        <div className="relative">
                            <input
                                type="date"
                                name="startDate"
                                value={dateRange.startDate}
                                onChange={handleDateChange}
                                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                            結束日期
                        </label>
                        <div className="relative">
                            <input
                                type="date"
                                name="endDate"
                                value={dateRange.endDate}
                                onChange={handleDateChange}
                                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                            />
                        </div>
                    </div>
                    {(dateRange.startDate || dateRange.endDate) && (
                        <Button variant="outline" onClick={clearDates} className="mb-[1px]">
                            清除篩選
                        </Button>
                    )}
                </div>

                {/* Transactions Table */}
                <div className="rounded-lg bg-white dark:bg-gray-800 shadow overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-gray-500 dark:text-gray-400">
                            <thead className="bg-gray-50 dark:bg-gray-900 text-xs uppercase text-gray-700 dark:text-gray-300">
                                <tr>
                                    <th className="px-6 py-3">時間</th>
                                    <th className="px-6 py-3">類型</th>
                                    <th className="px-6 py-3">單號</th>
                                    <th className="px-6 py-3">客戶 / 廠商</th>
                                    <th className="px-6 py-3">備註</th>
                                    <th className="px-6 py-3 text-right">金額</th>
                                    <th className="px-6 py-3 text-right">變動後餘額</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                {loading && transactions.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                                            載入中...
                                        </td>
                                    </tr>
                                ) : transactions.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                                            尚無符合條件的交易記錄
                                        </td>
                                    </tr>
                                ) : (
                                    transactions.map((tx) => {
                                        const balanceBefore = tx.balance_before;
                                        const change = tx.balance_after - balanceBefore;
                                        // Fallback logic if balance_before is missing: assume sale/customer_payment is +
                                        const isPositive = ['sale', 'customer_payment', 'adjustment_increase', 'transfer_in'].includes(tx.transaction_type) || change >= 0;

                                        // Determine customer or vendor display
                                        const partyName = tx.customer_name || tx.vendor_name || null
                                        const partyCode = tx.customer_code || tx.vendor_code || null

                                        return (
                                            <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    {formatDate(tx.created_at)}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${['sale', 'customer_payment', 'transfer_in'].includes(tx.transaction_type)
                                                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                                                        : ['expense', 'purchase_payment', 'transfer_out'].includes(tx.transaction_type)
                                                            ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
                                                            : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                                                        }`}>
                                                        {TRANSACTION_TYPE_LABELS[tx.transaction_type] || tx.transaction_type}
                                                    </span>
                                                    {tx.original_payment_method && tx.original_payment_method !== 'cash' && (
                                                        <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300">
                                                            {tx.original_payment_method === 'pending' ? '待確定' : tx.original_payment_method}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                        {tx.ref_no || '-'}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    {partyName || partyCode ? (
                                                        <div>
                                                            <div className="text-sm text-gray-900 dark:text-gray-100">
                                                                {partyName || partyCode}
                                                            </div>
                                                            {partyName && partyCode && partyName !== partyCode && (
                                                                <div className="text-xs text-gray-500">
                                                                    {partyCode}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-gray-400">-</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4">
                                                    {tx.note ? (
                                                        <div className="text-xs text-gray-500 dark:text-gray-400 max-w-[200px] truncate" title={tx.note}>
                                                            {tx.note}
                                                        </div>
                                                    ) : (
                                                        <span className="text-gray-400">-</span>
                                                    )}
                                                </td>
                                                <td className={`px-6 py-4 text-right font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                                                    {isPositive ? '+' : ''}{formatCurrency(tx.amount)}
                                                </td>
                                                <td className="px-6 py-4 text-right text-gray-900 dark:text-gray-100">
                                                    {formatCurrency(tx.balance_after)}
                                                </td>
                                            </tr>
                                        )
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination Controls */}
                    <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 sm:px-6">
                        <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                            <div className="flex items-center gap-4">
                                <p className="text-sm text-gray-700 dark:text-gray-300">
                                    顯示第 <span className="font-medium">{(pagination.page - 1) * pagination.limit + 1}</span> 到 <span className="font-medium">{Math.min(pagination.page * pagination.limit, pagination.total)}</span> 筆，共 <span className="font-medium">{pagination.total}</span> 筆
                                </p>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-gray-600 dark:text-gray-400">每頁</span>
                                    <select
                                        value={pageSize}
                                        onChange={(e) => {
                                            const newSize = Number(e.target.value)
                                            setPageSize(newSize)
                                            setPagination(prev => ({ ...prev, page: 1, limit: newSize }))
                                        }}
                                        className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                                    >
                                        <option value={20}>20</option>
                                        <option value={50}>50</option>
                                    </select>
                                    <span className="text-sm text-gray-600 dark:text-gray-400">筆</span>
                                </div>
                            </div>
                            <div>
                                <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                                        disabled={pagination.page === 1}
                                        className="rounded-l-md px-2 py-2"
                                    >
                                        <span className="sr-only">Previous</span>
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                    {/* Simplified Pagination showing current page */}
                                    <span className="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 dark:text-white dark:ring-gray-600">
                                        {pagination.page} / {pagination.totalPages || 1}
                                    </span>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPagination(prev => ({ ...prev, page: Math.min(prev.totalPages, prev.page + 1) }))}
                                        disabled={pagination.page >= pagination.totalPages}
                                        className="rounded-r-md px-2 py-2"
                                    >
                                        <span className="sr-only">Next</span>
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                </nav>
                            </div>
                        </div>
                        {/* Mobile Pagination */}
                        <div className="flex flex-1 justify-between sm:hidden">
                            <Button
                                variant="outline"
                                onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                                disabled={pagination.page === 1}
                            >
                                上一頁
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => setPagination(prev => ({ ...prev, page: Math.min(prev.totalPages, prev.page + 1) }))}
                                disabled={pagination.page >= pagination.totalPages}
                            >
                                下一頁
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
