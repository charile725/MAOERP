'use client'

import React, { useState, useMemo } from 'react'
import useSWR from 'swr'
import { rawFetcher } from '@/lib/swr/fetcher'

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

// 按客戶分組的類型
type CustomerGroup = {
  customerCode: string | null
  customerName: string
  totalPending: number
  products: {
    productId: string
    itemCode: string
    name: string
    unit: string
    pendingQuantity: number
    saleNos: string[]
  }[]
}

export default function ShortageStatsPage() {
  const { data: result, isLoading: loading } = useSWR<{ data: ProductShortage[]; summary: Summary }>(
    '/api/shortage-stats',
    rawFetcher
  )
  const shortageStats = result?.data ?? []
  const summary = result?.summary ?? null

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [showOnlyShortage, setShowOnlyShortage] = useState(false)
  const [groupByCustomer, setGroupByCustomer] = useState(false)
  const [keyword, setKeyword] = useState('')

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
  const filteredStats = useMemo(() => {
    let result = shortageStats
    if (showOnlyShortage) {
      result = result.filter(p => p.shortage > 0)
    }
    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase()
      result = result.filter(p =>
        p.itemCode.toLowerCase().includes(kw) ||
        p.name.toLowerCase().includes(kw) ||
        p.customers.some(c =>
          c.customerName.toLowerCase().includes(kw) ||
          c.saleNo.toLowerCase().includes(kw)
        )
      )
    }
    return result
  }, [shortageStats, showOnlyShortage, keyword])

  // 按客戶分組的數據
  const customerGroups = useMemo(() => {
    const groupMap = new Map<string, CustomerGroup>()

    filteredStats.forEach(product => {
      product.customers.forEach(customer => {
        const key = customer.customerCode || 'WALK_IN'
        const existing = groupMap.get(key)

        if (existing) {
          // 查找是否已有該商品
          const existingProduct = existing.products.find(p => p.productId === product.productId)
          if (existingProduct) {
            existingProduct.pendingQuantity += customer.pendingQuantity
            if (!existingProduct.saleNos.includes(customer.saleNo)) {
              existingProduct.saleNos.push(customer.saleNo)
            }
          } else {
            existing.products.push({
              productId: product.productId,
              itemCode: product.itemCode,
              name: product.name,
              unit: product.unit,
              pendingQuantity: customer.pendingQuantity,
              saleNos: [customer.saleNo]
            })
          }
          existing.totalPending += customer.pendingQuantity
        } else {
          groupMap.set(key, {
            customerCode: customer.customerCode,
            customerName: customer.customerName,
            totalPending: customer.pendingQuantity,
            products: [{
              productId: product.productId,
              itemCode: product.itemCode,
              name: product.name,
              unit: product.unit,
              pendingQuantity: customer.pendingQuantity,
              saleNos: [customer.saleNo]
            }]
          })
        }
      })
    })

    return Array.from(groupMap.values()).sort((a, b) => b.totalPending - a.totalPending)
  }, [filteredStats])

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

        <div className="mb-4 flex flex-wrap items-center gap-4">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜尋品號、商品名稱、客戶、單號"
            className="rounded border border-gray-300 dark:border-gray-600 px-4 py-1.5 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 placeholder:text-gray-400 dark:placeholder:text-gray-500 w-64"
          />
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={groupByCustomer}
              onChange={(e) => {
                setGroupByCustomer(e.target.checked)
                setExpandedRows(new Set())
              }}
              className="h-4 w-4"
            />
            <span className="text-sm text-gray-900 dark:text-gray-100">按客戶分組</span>
          </label>
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
          ) : groupByCustomer ? (
            // 按客戶分組視圖
            customerGroups.length === 0 ? (
              <div className="p-8 text-center">
                <div className="text-4xl mb-4">📦</div>
                <div className="text-gray-900 dark:text-gray-100 font-semibold mb-2">沒有待出貨品項</div>
              </div>
            ) : (
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {customerGroups.map((group) => {
                  const key = group.customerCode || 'WALK_IN'
                  const isExpanded = expandedRows.has(key)

                  return (
                    <div key={key}>
                      <div
                        className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                        onClick={() => toggleRow(key)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-blue-600">
                            {isExpanded ? '▼' : '▶'}
                          </span>
                          <span className="font-semibold text-gray-900 dark:text-gray-100">
                            {group.customerName}
                          </span>
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            ({group.products.length} 項商品)
                          </span>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                            待出貨 {group.totalPending} 件
                          </div>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="bg-gray-50 dark:bg-gray-900 px-4 pb-4">
                          <table className="w-full text-sm">
                            <thead className="border-b">
                              <tr>
                                <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">品號</th>
                                <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">商品名稱</th>
                                <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">待出貨</th>
                                <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">相關單號</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                              {group.products
                                .sort((a, b) => b.pendingQuantity - a.pendingQuantity)
                                .map((product) => (
                                  <tr key={product.productId}>
                                    <td className="py-2 text-gray-900 dark:text-gray-100">{product.itemCode}</td>
                                    <td className="py-2 text-gray-900 dark:text-gray-100">{product.name}</td>
                                    <td className="py-2 text-right font-bold text-gray-900 dark:text-gray-100">
                                      {product.pendingQuantity} {product.unit}
                                    </td>
                                    <td className="py-2 text-gray-500 dark:text-gray-400">
                                      {product.saleNos.join(', ')}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
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
            // 按商品視圖
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
                            className={`inline-block rounded px-2 py-1 text-xs font-medium ${product.shortage > 0
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
                              <h4 className="mb-3 font-semibold text-gray-900 dark:text-gray-100">客戶欠貨統計</h4>
                              <table className="w-full">
                                <thead className="border-b">
                                  <tr>
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">客戶</th>
                                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">欠貨數量</th>
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">相關單號</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y dark:divide-gray-700">
                                  {(() => {
                                    const customerSummary = new Map<string, { name: string, total: number, saleNos: string[] }>()
                                    product.customers.forEach(c => {
                                      const key = c.customerCode || 'WALK_IN'
                                      const existing = customerSummary.get(key)
                                      if (existing) {
                                        existing.total += c.pendingQuantity
                                        if (!existing.saleNos.includes(c.saleNo)) {
                                          existing.saleNos.push(c.saleNo)
                                        }
                                      } else {
                                        customerSummary.set(key, {
                                          name: c.customerName,
                                          total: c.pendingQuantity,
                                          saleNos: [c.saleNo]
                                        })
                                      }
                                    })
                                    return Array.from(customerSummary.entries())
                                      .sort((a, b) => b[1].total - a[1].total)
                                      .map(([key, data]) => (
                                        <tr key={key}>
                                          <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{data.name}</td>
                                          <td className="px-4 py-3 text-right text-sm font-bold text-gray-900 dark:text-gray-100">
                                            {data.total} {product.unit}
                                          </td>
                                          <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                                            {data.saleNos.join(', ')}
                                          </td>
                                        </tr>
                                      ))
                                  })()}
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
