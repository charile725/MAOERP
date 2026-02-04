'use client'

import React, { useState, useEffect } from 'react'

type CustomerOwed = {
  customerCode: string | null
  customerName: string
  saleNo: string
  quantity: number
  pendingQuantity: number
}

type ProductShortage = {
  productId: string
  itemCode: string
  name: string
  unit: string
  stock: number
  totalPending: number
  shortage: number
  customers: CustomerOwed[]
}

type Summary = {
  totalProducts: number
  shortageProducts: number
  totalPendingQty: number
  totalShortageQty: number
}

export default function ShortageStatsPage() {
  const [shortageStats, setShortageStats] = useState<ProductShortage[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [showOnlyShortage, setShowOnlyShortage] = useState(false)

  useEffect(() => {
    fetchShortageStats()
  }, [])

  const fetchShortageStats = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/shortage-stats')
      const data = await res.json()
      if (data.ok) {
        setShortageStats(data.data || [])
        setSummary(data.summary || null)
      }
    } catch (err) {
      console.error('Failed to fetch shortage stats:', err)
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

  // 根據篩選條件過濾
  const filteredStats = showOnlyShortage
    ? shortageStats.filter(p => p.shortage > 0)
    : shortageStats

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">欠貨統計</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            銷售訂單中尚未出貨的品項
          </p>
        </div>

        {summary && (
          <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-lg bg-white dark:bg-gray-800 shadow p-4">
              <div className="text-sm text-gray-500 dark:text-gray-400">待出貨品項</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{summary.totalProducts}</div>
            </div>
            <div className="rounded-lg bg-white dark:bg-gray-800 shadow p-4">
              <div className="text-sm text-gray-500 dark:text-gray-400">總待出貨數</div>
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{summary.totalPendingQty}</div>
            </div>
            <div className="rounded-lg bg-white dark:bg-gray-800 shadow p-4">
              <div className="text-sm text-gray-500 dark:text-gray-400">缺貨品項</div>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">{summary.shortageProducts}</div>
            </div>
            <div className="rounded-lg bg-white dark:bg-gray-800 shadow p-4">
              <div className="text-sm text-gray-500 dark:text-gray-400">總欠貨數</div>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">{summary.totalShortageQty}</div>
            </div>
          </div>
        )}

        <div className="mb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showOnlyShortage}
              onChange={(e) => setShowOnlyShortage(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-gray-900 dark:text-gray-100">只顯示缺貨品項</span>
          </label>
        </div>

        <div className="rounded-lg bg-white dark:bg-gray-800 shadow">
          {loading ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">載入中...</div>
          ) : filteredStats.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-4xl mb-4">{showOnlyShortage ? '✅' : '📦'}</div>
              <div className="text-gray-900 dark:text-gray-100 font-semibold mb-2">
                {showOnlyShortage ? '沒有缺貨' : '沒有待出貨品項'}
              </div>
              <div className="text-gray-500 dark:text-gray-400 text-sm">
                {showOnlyShortage ? '所有待出貨品項庫存充足' : '目前沒有任何需要出貨的商品'}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">品號</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">商品名稱</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">待出貨</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">庫存</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">欠貨</th>
                    <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">狀態</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredStats.map((product) => (
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
                        <td className="px-6 py-4 text-right text-sm text-gray-900 dark:text-gray-100">
                          {product.totalPending} {product.unit}
                        </td>
                        <td className="px-6 py-4 text-right text-sm text-gray-900 dark:text-gray-100">
                          {product.stock} {product.unit}
                        </td>
                        <td className="px-6 py-4 text-right text-sm font-bold">
                          <span className={product.shortage > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}>
                            {product.shortage > 0 ? `-${product.shortage}` : '0'} {product.unit}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center text-sm">
                          <span
                            className={`inline-block rounded px-2 py-1 text-xs font-medium ${
                              product.shortage > 0
                                ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
                                : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                            }`}
                          >
                            {product.shortage > 0 ? '缺貨' : '庫存足夠'}
                          </span>
                        </td>
                      </tr>
                      {expandedRows.has(product.productId) && (
                        <tr>
                          <td colSpan={6} className="bg-gray-50 dark:bg-gray-900 px-6 py-4">
                            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                              <h4 className="mb-3 font-semibold text-gray-900 dark:text-gray-100">訂單明細 - 誰要貨</h4>
                              <table className="w-full">
                                <thead className="border-b">
                                  <tr>
                                    <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">客戶</th>
                                    <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">銷售單號</th>
                                    <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">訂單數量</th>
                                    <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">待出貨</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y dark:divide-gray-700">
                                  {product.customers.map((customer, idx) => (
                                    <tr key={idx}>
                                      <td className="py-2 text-sm text-gray-900 dark:text-gray-100">{customer.customerName}</td>
                                      <td className="py-2 text-sm text-gray-500 dark:text-gray-400">{customer.saleNo}</td>
                                      <td className="py-2 text-right text-sm text-gray-600 dark:text-gray-400">
                                        {customer.quantity} {product.unit}
                                      </td>
                                      <td className="py-2 text-right text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {customer.pendingQuantity} {product.unit}
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
