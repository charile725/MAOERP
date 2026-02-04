'use client'

import React, { useState, useEffect } from 'react'
import { formatCurrency, formatDate } from '@/lib/utils'

type VendorOwed = {
  vendorCode: string
  vendorName: string
  purchaseNo: string
  purchaseDate: string
  quantity: number
  pendingQuantity: number
  cost: number
}

type ProductReceiving = {
  productId: string
  itemCode: string
  name: string
  unit: string
  stock: number
  totalPending: number
  totalPendingAmount: number
  vendors: VendorOwed[]
}

type Summary = {
  totalProducts: number
  totalPendingQty: number
  totalPendingAmount: number
}

export default function PurchaseReceivingStatsPage() {
  const [receivingStats, setReceivingStats] = useState<ProductReceiving[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchReceivingStats()
  }, [])

  const fetchReceivingStats = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/purchase-receiving-stats')
      const data = await res.json()
      if (data.ok) {
        setReceivingStats(data.data || [])
        setSummary(data.summary || null)
      }
    } catch (err) {
      console.error('Failed to fetch receiving stats:', err)
    } finally {
      setLoading(false)
    }
  }

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedRows(newExpanded)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">未收貨統計</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            進貨單中尚未收貨的品項
          </p>
        </div>

        {summary && (
          <div className="mb-4 grid grid-cols-3 gap-4">
            <div className="rounded-lg bg-white dark:bg-gray-800 shadow p-4">
              <div className="text-sm text-gray-500 dark:text-gray-400">待收貨品項</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{summary.totalProducts}</div>
            </div>
            <div className="rounded-lg bg-white dark:bg-gray-800 shadow p-4">
              <div className="text-sm text-gray-500 dark:text-gray-400">總待收貨數</div>
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{summary.totalPendingQty}</div>
            </div>
            <div className="rounded-lg bg-white dark:bg-gray-800 shadow p-4">
              <div className="text-sm text-gray-500 dark:text-gray-400">待收貨金額</div>
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{formatCurrency(summary.totalPendingAmount)}</div>
            </div>
          </div>
        )}

        <div className="rounded-lg bg-white dark:bg-gray-800 shadow">
          {loading ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">載入中...</div>
          ) : receivingStats.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-4xl mb-4">✅</div>
              <div className="text-gray-900 dark:text-gray-100 font-semibold mb-2">
                全部收貨完畢
              </div>
              <div className="text-gray-500 dark:text-gray-400 text-sm">
                目前沒有任何待收貨的商品
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">品號</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">商品名稱</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">待收貨</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">現有庫存</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">待收金額</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {receivingStats.map((product) => (
                    <React.Fragment key={product.productId}>
                      <tr
                        className="hover:bg-gray-50/50 dark:hover:bg-gray-700/30 cursor-pointer transition-colors"
                        onClick={() => toggleRow(product.productId)}
                      >
                        <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">
                          <div className="flex items-center gap-2">
                            <span className="text-blue-600">
                              {expandedRows.has(product.productId) ? '▼' : '▶'}
                            </span>
                            {product.itemCode}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                          {product.name}
                        </td>
                        <td className="px-6 py-4 text-right text-sm font-bold text-amber-600 dark:text-amber-400">
                          {product.totalPending} {product.unit}
                        </td>
                        <td className="px-6 py-4 text-right text-sm text-gray-900 dark:text-gray-100">
                          {product.stock} {product.unit}
                        </td>
                        <td className="px-6 py-4 text-right text-sm font-medium text-gray-900 dark:text-gray-100">
                          {formatCurrency(product.totalPendingAmount)}
                        </td>
                      </tr>
                      {expandedRows.has(product.productId) && (
                        <tr>
                          <td colSpan={5} className="bg-gray-50 dark:bg-gray-900 px-6 py-4">
                            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                              <h4 className="mb-3 font-semibold text-gray-900 dark:text-gray-100">進貨明細 - 哪家廠商</h4>
                              <table className="w-full">
                                <thead className="border-b">
                                  <tr>
                                    <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">廠商</th>
                                    <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">進貨單號</th>
                                    <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">進貨日期</th>
                                    <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">訂購數量</th>
                                    <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">待收貨</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y dark:divide-gray-700">
                                  {product.vendors.map((vendor, idx) => (
                                    <tr key={idx}>
                                      <td className="py-2 text-sm text-gray-900 dark:text-gray-100">{vendor.vendorName}</td>
                                      <td className="py-2 text-sm text-gray-500 dark:text-gray-400">{vendor.purchaseNo}</td>
                                      <td className="py-2 text-sm text-gray-500 dark:text-gray-400">{formatDate(vendor.purchaseDate)}</td>
                                      <td className="py-2 text-right text-sm text-gray-600 dark:text-gray-400">
                                        {vendor.quantity} {product.unit}
                                      </td>
                                      <td className="py-2 text-right text-sm font-medium text-amber-600 dark:text-amber-400">
                                        {vendor.pendingQuantity} {product.unit}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
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
