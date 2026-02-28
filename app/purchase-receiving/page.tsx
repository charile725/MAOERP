'use client'

import React, { useState, useMemo } from 'react'
import useSWR from 'swr'
import { rawFetcher } from '@/lib/swr/fetcher'
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

// 按廠商分組的類型
type VendorGroup = {
  vendorCode: string
  vendorName: string
  totalPending: number
  totalPendingAmount: number
  products: {
    productId: string
    itemCode: string
    name: string
    unit: string
    pendingQuantity: number
    pendingAmount: number
    purchaseNos: string[]
  }[]
}

export default function PurchaseReceivingStatsPage() {
  const { data: result, isLoading: loading } = useSWR<{ data: ProductReceiving[]; summary: Summary }>(
    '/api/purchase-receiving-stats',
    rawFetcher
  )
  const receivingStats = result?.data ?? []
  const summary = result?.summary ?? null
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [groupByVendor, setGroupByVendor] = useState(false)
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

  // 根據搜尋關鍵字過濾
  const filteredStats = useMemo(() => {
    if (!keyword.trim()) return receivingStats
    const kw = keyword.trim().toLowerCase()
    return receivingStats.filter(p =>
      p.itemCode.toLowerCase().includes(kw) ||
      p.name.toLowerCase().includes(kw) ||
      p.vendors.some(v =>
        v.vendorName.toLowerCase().includes(kw) ||
        v.vendorCode.toLowerCase().includes(kw) ||
        v.purchaseNo.toLowerCase().includes(kw)
      )
    )
  }, [receivingStats, keyword])

  // 按廠商分組的數據
  const vendorGroups = useMemo(() => {
    const groupMap = new Map<string, VendorGroup>()

    filteredStats.forEach(product => {
      product.vendors.forEach(vendor => {
        const key = vendor.vendorCode
        const existing = groupMap.get(key)
        const pendingAmount = vendor.pendingQuantity * vendor.cost

        if (existing) {
          const existingProduct = existing.products.find(p => p.productId === product.productId)
          if (existingProduct) {
            existingProduct.pendingQuantity += vendor.pendingQuantity
            existingProduct.pendingAmount += pendingAmount
            if (!existingProduct.purchaseNos.includes(vendor.purchaseNo)) {
              existingProduct.purchaseNos.push(vendor.purchaseNo)
            }
          } else {
            existing.products.push({
              productId: product.productId,
              itemCode: product.itemCode,
              name: product.name,
              unit: product.unit,
              pendingQuantity: vendor.pendingQuantity,
              pendingAmount: pendingAmount,
              purchaseNos: [vendor.purchaseNo]
            })
          }
          existing.totalPending += vendor.pendingQuantity
          existing.totalPendingAmount += pendingAmount
        } else {
          groupMap.set(key, {
            vendorCode: vendor.vendorCode,
            vendorName: vendor.vendorName,
            totalPending: vendor.pendingQuantity,
            totalPendingAmount: pendingAmount,
            products: [{
              productId: product.productId,
              itemCode: product.itemCode,
              name: product.name,
              unit: product.unit,
              pendingQuantity: vendor.pendingQuantity,
              pendingAmount: pendingAmount,
              purchaseNos: [vendor.purchaseNo]
            }]
          })
        }
      })
    })

    return Array.from(groupMap.values()).sort((a, b) => b.totalPendingAmount - a.totalPendingAmount)
  }, [filteredStats])

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

        <div className="mb-4 flex flex-wrap items-center gap-4">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜尋品號、商品名稱、廠商、單號"
            className="rounded border border-gray-300 dark:border-gray-600 px-4 py-1.5 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700 placeholder:text-gray-400 dark:placeholder:text-gray-500 w-64"
          />
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={groupByVendor}
              onChange={(e) => {
                setGroupByVendor(e.target.checked)
                setExpandedRows(new Set())
              }}
              className="h-4 w-4"
            />
            <span className="text-sm text-gray-900 dark:text-gray-100">按廠商分組</span>
          </label>
        </div>

        <div className="rounded-lg bg-white dark:bg-gray-800 shadow">
          {loading ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">載入中...</div>
          ) : groupByVendor ? (
            // 按廠商分組視圖
            vendorGroups.length === 0 ? (
              <div className="p-8 text-center">
                <div className="text-4xl mb-4">✅</div>
                <div className="text-gray-900 dark:text-gray-100 font-semibold mb-2">全部收貨完畢</div>
              </div>
            ) : (
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {vendorGroups.map((group) => {
                  const isExpanded = expandedRows.has(group.vendorCode)

                  return (
                    <div key={group.vendorCode}>
                      <div
                        className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                        onClick={() => toggleRow(group.vendorCode)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-blue-600">
                            {isExpanded ? '▼' : '▶'}
                          </span>
                          <span className="font-semibold text-gray-900 dark:text-gray-100">
                            {group.vendorName}
                          </span>
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            ({group.products.length} 項商品)
                          </span>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold text-amber-600 dark:text-amber-400">
                            {formatCurrency(group.totalPendingAmount)}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            待收 {group.totalPending} 件
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
                                <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">待收貨</th>
                                <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">金額</th>
                                <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">相關單號</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                              {group.products
                                .sort((a, b) => b.pendingAmount - a.pendingAmount)
                                .map((product) => (
                                  <tr key={product.productId}>
                                    <td className="py-2 text-gray-900 dark:text-gray-100">{product.itemCode}</td>
                                    <td className="py-2 text-gray-900 dark:text-gray-100">{product.name}</td>
                                    <td className="py-2 text-right font-bold text-amber-600 dark:text-amber-400">
                                      {product.pendingQuantity} {product.unit}
                                    </td>
                                    <td className="py-2 text-right text-gray-900 dark:text-gray-100">
                                      {formatCurrency(product.pendingAmount)}
                                    </td>
                                    <td className="py-2 text-gray-500 dark:text-gray-400">
                                      {product.purchaseNos.join(', ')}
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
              <div className="text-4xl mb-4">✅</div>
              <div className="text-gray-900 dark:text-gray-100 font-semibold mb-2">
                全部收貨完畢
              </div>
              <div className="text-gray-500 dark:text-gray-400 text-sm">
                目前沒有任何待收貨的商品
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
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">待收貨</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">現有庫存</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">待收金額</th>
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
                              <h4 className="mb-3 font-semibold text-gray-900 dark:text-gray-100">廠商待收統計</h4>
                              <table className="w-full">
                                <thead className="border-b">
                                  <tr>
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">廠商</th>
                                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">待收數量</th>
                                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">金額</th>
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">相關單號</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y dark:divide-gray-700">
                                  {(() => {
                                    // 按廠商汇总
                                    const vendorSummary = new Map<string, { name: string, total: number, amount: number, purchaseNos: string[] }>()
                                    product.vendors.forEach(v => {
                                      const existing = vendorSummary.get(v.vendorCode)
                                      const amount = v.pendingQuantity * v.cost
                                      if (existing) {
                                        existing.total += v.pendingQuantity
                                        existing.amount += amount
                                        if (!existing.purchaseNos.includes(v.purchaseNo)) {
                                          existing.purchaseNos.push(v.purchaseNo)
                                        }
                                      } else {
                                        vendorSummary.set(v.vendorCode, {
                                          name: v.vendorName,
                                          total: v.pendingQuantity,
                                          amount: amount,
                                          purchaseNos: [v.purchaseNo]
                                        })
                                      }
                                    })
                                    return Array.from(vendorSummary.entries())
                                      .sort((a, b) => b[1].amount - a[1].amount)
                                      .map(([key, data]) => (
                                        <tr key={key}>
                                          <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{data.name}</td>
                                          <td className="px-4 py-3 text-right text-sm font-bold text-amber-600 dark:text-amber-400">
                                            {data.total} {product.unit}
                                          </td>
                                          <td className="px-4 py-3 text-right text-sm text-gray-900 dark:text-gray-100">
                                            {formatCurrency(data.amount)}
                                          </td>
                                          <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                                            {data.purchaseNos.join(', ')}
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
