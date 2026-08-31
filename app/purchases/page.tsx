'use client'

import React, { useState, useMemo } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SWR_KEYS, purchasesKey } from '@/lib/swr/keys'

type PurchaseItem = {
  id: string
  quantity: number
  cost: number
  subtotal?: number  // 小計（優先使用，避免小數點問題）
  product_id: string
  products: {
    name: string
    item_code: string
    unit: string
  }
}

type Purchase = {
  id: string
  purchase_no: string
  vendor_code: string
  purchase_date: string
  total: number
  created_at: string
  note?: string
  item_count?: number
  total_quantity?: number
  avg_cost?: number
  vendors?: {
    vendor_name: string
  }
  purchase_items?: PurchaseItem[]
}

type VendorGroup = {
  vendor_code: string
  vendor_name: string
  purchases: Purchase[]
  total_amount: number
  total_items: number
  total_quantity: number
}

// 扁平化的商品項目（包含進貨單資訊）
type FlattenedItem = {
  id: string
  purchase_id: string
  purchase_no: string
  purchase_date: string
  product_id: string
  item_code: string
  product_name: string
  unit: string
  quantity: number
  cost: number
  subtotal?: number  // 小計（優先使用，避免小數點問題）
}

type VendorItemGroup = {
  vendor_code: string
  vendor_name: string
  items: FlattenedItem[]
  total_amount: number
  total_quantity: number
}

type ProductPurchaseStats = {
  product_name: string
  item_code: string
  total_quantity: number
  total_cost: number
  vendor_purchases: {
    vendor_name: string
    vendor_code: string
    quantity: number
    purchase_count: number
  }[]
}

export default function PurchasesPage() {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set())
  const [groupByVendor, setGroupByVendor] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(20)

  // Auth
  const { data: authData } = useSWR<{ role: 'admin' | 'staff' }>(SWR_KEYS.AUTH_ME)
  const userRole = authData?.role ?? null
  const isAdmin = userRole === 'admin'

  // Purchases data via SWR
  const purchaseParams: Record<string, string> = {}
  if (searchKeyword) purchaseParams.keyword = searchKeyword
  if (dateFrom) purchaseParams.date_from = dateFrom
  if (dateTo) purchaseParams.date_to = dateTo

  const { data: purchases = [], isLoading: loading, mutate } = useSWR<Purchase[]>(purchasesKey(purchaseParams))

  // Compute product stats when keyword is active
  const productStats = useMemo<ProductPurchaseStats | null>(() => {
    if (!searchKeyword || purchases.length === 0) return null

    const stats: { [key: string]: ProductPurchaseStats } = {}
    const vendorMap: { [productKey: string]: { [vendorKey: string]: { vendor_name: string, vendor_code: string, quantity: number, purchase_count: number } } } = {}
    const kw = searchKeyword.toLowerCase()

    purchases.forEach((purchase: Purchase) => {
      if (purchase.purchase_items) {
        purchase.purchase_items.forEach((item: PurchaseItem) => {
          const matchesKeyword =
            item.products?.name?.toLowerCase().includes(kw) ||
            item.products?.item_code?.toLowerCase().includes(kw)
          if (!matchesKeyword) return

          const productKey = `${item.product_id}`
          const vendorKey = purchase.vendor_code

          if (!stats[productKey]) {
            stats[productKey] = {
              product_name: item.products.name,
              item_code: item.products.item_code,
              total_quantity: 0,
              total_cost: 0,
              vendor_purchases: []
            }
            vendorMap[productKey] = {}
          }

          stats[productKey].total_quantity += item.quantity
          stats[productKey].total_cost += item.subtotal || Math.round(item.quantity * item.cost)

          if (!vendorMap[productKey][vendorKey]) {
            vendorMap[productKey][vendorKey] = {
              vendor_name: purchase.vendors?.vendor_name || purchase.vendor_code,
              vendor_code: purchase.vendor_code,
              quantity: 0,
              purchase_count: 0
            }
          }
          vendorMap[productKey][vendorKey].quantity += item.quantity
          vendorMap[productKey][vendorKey].purchase_count += 1
        })
      }
    })

    Object.keys(stats).forEach(productKey => {
      stats[productKey].vendor_purchases = Object.values(vendorMap[productKey])
        .sort((a, b) => b.quantity - a.quantity)
    })

    const firstProduct = Object.values(stats)[0]
    return firstProduct || null
  }, [purchases, searchKeyword])

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedRows(newExpanded)
  }

  const toggleVendor = (vendorCode: string) => {
    const newExpanded = new Set(expandedVendors)
    if (newExpanded.has(vendorCode)) {
      newExpanded.delete(vendorCode)
    } else {
      newExpanded.add(vendorCode)
    }
    setExpandedVendors(newExpanded)
  }

  const displayedPurchases = purchases

  // 按廠商分組（舊版，保留但不使用）
  const vendorGroups = useMemo(() => {
    if (!groupByVendor) return []

    const groups: { [key: string]: VendorGroup } = {}

    displayedPurchases.forEach((purchase) => {
      const key = purchase.vendor_code

      if (!groups[key]) {
        groups[key] = {
          vendor_code: purchase.vendor_code,
          vendor_name: purchase.vendors?.vendor_name || purchase.vendor_code,
          purchases: [],
          total_amount: 0,
          total_items: 0,
          total_quantity: 0
        }
      }

      groups[key].purchases.push(purchase)
      groups[key].total_amount += purchase.total || 0
      groups[key].total_items += purchase.item_count || 0
      groups[key].total_quantity += purchase.total_quantity || 0
    })

    // 按廠商名稱排序
    return Object.values(groups).sort((a, b) =>
      a.vendor_name.localeCompare(b.vendor_name, 'zh-TW')
    )
  }, [displayedPurchases, groupByVendor])

  // 按廠商分組 - 直接顯示商品明細
  const vendorItemGroups = useMemo(() => {
    if (!groupByVendor) return []

    const groups: { [key: string]: VendorItemGroup } = {}

    displayedPurchases.forEach((purchase) => {
      const key = purchase.vendor_code

      if (!groups[key]) {
        groups[key] = {
          vendor_code: purchase.vendor_code,
          vendor_name: purchase.vendors?.vendor_name || purchase.vendor_code,
          items: [],
          total_amount: 0,
          total_quantity: 0
        }
      }

      // 扁平化每個進貨單的商品項目
      if (purchase.purchase_items) {
        purchase.purchase_items.forEach((item) => {
          groups[key].items.push({
            id: item.id,
            purchase_id: purchase.id,
            purchase_no: purchase.purchase_no,
            purchase_date: purchase.purchase_date,
            product_id: item.product_id,
            item_code: item.products.item_code,
            product_name: item.products.name,
            unit: item.products.unit,
            quantity: item.quantity,
            cost: item.cost,
            subtotal: item.subtotal,
          })
          groups[key].total_amount += item.subtotal || Math.round(item.quantity * item.cost)
          groups[key].total_quantity += item.quantity
        })
      }
    })

    // 按廠商名稱排序
    return Object.values(groups).sort((a, b) =>
      a.vendor_name.localeCompare(b.vendor_name, 'zh-TW')
    )
  }, [displayedPurchases, groupByVendor])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setCurrentPage(1)
    setSearchKeyword(keyword)
  }

  const handleDeletePurchase = async (id: string, purchaseNo: string) => {
    // 刪除會連庫存一起扣回去，而且救不回來（成本、廠商都沒有地方可以回推），
    // 所以要求把單號打出來，避免手滑按到就整張單消失。
    const typed = prompt(
      `確定要刪除進貨單 ${purchaseNo} 嗎？\n\n` +
      `庫存會一起扣回去，且無法復原。\n` +
      `確定的話請輸入單號 ${purchaseNo}：`
    )
    if (typed?.trim().toUpperCase() !== purchaseNo.toUpperCase()) {
      if (typed !== null) alert('單號不符，已取消刪除')
      return
    }

    setDeleting(id)
    try {
      const res = await fetch(`/api/purchases/${id}`, {
        method: 'DELETE',
      })

      const data = await res.json()

      if (data.ok) {
        alert('刪除成功，庫存已回補')
        mutate()
      } else {
        alert(`刪除失敗：${data.error}`)
      }
    } catch (err) {
      alert('刪除失敗')
    } finally {
      setDeleting(null)
    }
  }

  const handleDeleteItem = async (itemId: string, productName: string, purchaseId: string) => {
    if (!confirm(`確定要刪除進貨明細「${productName}」嗎？\n\n此操作將會回補該商品庫存並重新計算進貨總額。`)) {
      return
    }

    setDeleting(itemId)
    try {
      const res = await fetch(`/api/purchase-items/${itemId}`, {
        method: 'DELETE',
      })

      const data = await res.json()

      if (data.ok) {
        alert(data.data?.purchase_removed
          ? '刪除成功，庫存已回補。這是該進貨單的最後一個品項，整張單也一併移除了'
          : '刪除成功，庫存已回補')
        mutate()
      } else {
        alert(`刪除失敗：${data.error}`)
      }
    } catch (err) {
      alert('刪除失敗')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">進貨單</h1>
            {!isAdmin && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">員工模式：僅顯示數量資訊</p>
            )}
          </div>
          {isAdmin ? (
            <Link
              href="/purchases/new"
              className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            >
              + 新增進貨
            </Link>
          ) : (
            <Link
              href="/purchases/staff"
              className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700"
            >
              + 進貨登記
            </Link>
          )}
        </div>

        {/* Search */}
        <div className="mb-4 sm:mb-6 rounded-lg bg-white dark:bg-gray-800 p-3 sm:p-4 shadow">
          <form onSubmit={handleSearch} className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜尋單號、廠商、商品"
                className="flex-1 rounded border border-gray-300 dark:border-gray-600 px-3 sm:px-4 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700 placeholder:text-gray-500 dark:placeholder:text-gray-400 min-h-[44px]"
              />
              <button
                type="submit"
                className="rounded bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700 min-h-[44px]"
              >
                搜尋
              </button>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
              <div className="flex gap-2 items-center flex-1">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="flex-1 rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700 min-h-[44px]"
                />
                <span className="text-gray-500 dark:text-gray-400">至</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="flex-1 rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700 min-h-[44px]"
                />
              </div>
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={() => { setDateFrom(''); setDateTo(''); }}
                  className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-3 py-2"
                >
                  清除
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300 min-h-[44px]">
                <input
                  type="checkbox"
                  checked={groupByVendor}
                  onChange={(e) => {
                    setGroupByVendor(e.target.checked)
                    setCurrentPage(1)
                  }}
                  className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                按廠商分組
              </label>
              {isAdmin && (
                <Link
                  href="/purchases/official-kuji"
                  className="text-sm text-orange-600 dark:text-orange-400 hover:underline min-h-[44px] flex items-center"
                >
                  官方賞進貨
                </Link>
              )}
            </div>
          </form>
        </div>

        {/* 商品進貨統計卡片 */}
        {productStats && (
          <div className="mb-6 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 p-6 shadow-lg border border-blue-200 dark:border-blue-800">
            <div className="mb-4">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">
                📊 商品進貨統計
              </h3>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {productStats.item_code} - {productStats.product_name}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
                <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">總進貨數量</div>
                <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                  {productStats.total_quantity}
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
                <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">總進貨金額</div>
                <div className="text-3xl font-bold text-green-600 dark:text-green-400">
                  {formatCurrency(productStats.total_cost)}
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                進貨廠商明細（共 {productStats.vendor_purchases.length} 家）
              </h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {productStats.vendor_purchases.map((vendor, index) => (
                  <div
                    key={`${vendor.vendor_code}-${index}`}
                    className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm"
                  >
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {vendor.vendor_name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {vendor.vendor_code}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                        {vendor.quantity} 個
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {vendor.purchase_count} 筆進貨
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="rounded-lg bg-white dark:bg-gray-800 shadow">
          {loading ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">載入中...</div>
          ) : displayedPurchases.length === 0 ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">沒有進貨單</div>
          ) : groupByVendor ? (
            /* 分組顯示 - 直接顯示商品明細 */
            <>
              {/* 分組統計資訊 */}
              <div className="px-6 pt-6 pb-4 flex items-center justify-between">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  共 {vendorItemGroups.length} 家廠商 · {vendorItemGroups.reduce((sum, g) => sum + g.items.length, 0)} 項商品
                  {isAdmin && (
                    <span className="ml-2">
                      · 總金額 {formatCurrency(vendorItemGroups.reduce((sum, g) => sum + g.total_amount, 0))}
                    </span>
                  )}
                </div>
              </div>

              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {vendorItemGroups.map((group) => {
                  const isExpanded = expandedVendors.has(group.vendor_code)

                  return (
                    <div key={group.vendor_code}>
                      {/* 廠商標頭 */}
                      <div
                        className="flex items-center gap-4 p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                        onClick={() => toggleVendor(group.vendor_code)}
                      >
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-blue-600 dark:text-blue-400">
                                {isExpanded ? '▼' : '▶'}
                              </span>
                              <span className="font-semibold text-gray-900 dark:text-gray-100">
                                {group.vendor_name}
                              </span>
                              <span className="text-sm text-gray-500 dark:text-gray-400">
                                ({group.vendor_code})
                              </span>
                            </div>

                            <div className="flex items-center gap-6">
                              <div className="text-right">
                                <div className="text-xs text-gray-500 dark:text-gray-400">商品</div>
                                <div className="text-base font-semibold text-gray-900 dark:text-gray-100">
                                  {group.items.length} 項 / {group.total_quantity} 件
                                </div>
                              </div>
                              {isAdmin && (
                                <div className="text-right min-w-[100px]">
                                  <div className="text-xs text-gray-500 dark:text-gray-400">總金額</div>
                                  <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                                    {formatCurrency(group.total_amount)}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 展開的商品明細列表 */}
                      {isExpanded && (
                        <div className="bg-gray-50 dark:bg-gray-900 px-4 pb-4">
                          <table className="w-full">
                            <thead className="border-b border-gray-200 dark:border-gray-700">
                              <tr>
                                <th className="py-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">品號</th>
                                <th className="py-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">商品名稱</th>
                                <th className="py-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">數量</th>
                                {isAdmin && (
                                  <>
                                    <th className="py-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">成本</th>
                                    <th className="py-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">小計</th>
                                  </>
                                )}
                                <th className="py-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">進貨單</th>
                                <th className="py-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">日期</th>
                                <th className="py-2 text-center text-xs font-semibold text-gray-900 dark:text-gray-100">操作</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                              {group.items.map((item) => (
                                  <tr key={item.id} className="hover:bg-white dark:hover:bg-gray-800">
                                    <td className="py-3 text-sm text-gray-900 dark:text-gray-100">
                                      <Link
                                        href={`/products/${item.product_id}/edit?returnTo=/purchases`}
                                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                                      >
                                        {item.item_code}
                                      </Link>
                                    </td>
                                    <td className="py-3 text-sm text-gray-900 dark:text-gray-100">
                                      <Link
                                        href={`/products/${item.product_id}/edit?returnTo=/purchases`}
                                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                                      >
                                        {item.product_name}
                                      </Link>
                                    </td>
                                    <td className="py-3 text-right text-sm text-gray-900 dark:text-gray-100">
                                      {item.quantity} {item.unit}
                                    </td>
                                    {isAdmin && (
                                      <>
                                        <td className="py-3 text-right text-sm text-gray-900 dark:text-gray-100">
                                          {formatCurrency(item.cost)}
                                        </td>
                                        <td className="py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
                                          {formatCurrency(item.subtotal || Math.round(item.quantity * item.cost))}
                                        </td>
                                      </>
                                    )}
                                    <td className="py-3 text-sm text-gray-500 dark:text-gray-400">
                                      {item.purchase_no}
                                    </td>
                                    <td className="py-3 text-sm text-gray-500 dark:text-gray-400">
                                      {formatDate(item.purchase_date)}
                                    </td>
                                    <td className="py-3 text-center text-sm">
                                      <div className="flex gap-2 justify-center">
                                        {isAdmin && (
                                          <button
                                            onClick={() => handleDeleteItem(item.id, item.product_name, item.purchase_id)}
                                            disabled={deleting === item.id}
                                            className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:text-gray-300 disabled:cursor-not-allowed dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                                            title="刪除這個品項並回補庫存"
                                          >
                                            {deleting === item.id ? '刪除中' : '刪除'}
                                          </button>
                                        )}
                                      </div>
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
            </>
          ) : (
            /* 平鋪顯示（原有邏輯） */
            <>
              {/* 分頁資訊 */}
              {displayedPurchases.length > 0 && (
                <div className="px-6 pt-6 pb-4 flex items-center justify-between">
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    共 {displayedPurchases.length} 筆記錄
                    {displayedPurchases.length > itemsPerPage && (
                      <span> · 顯示第 {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, displayedPurchases.length)} 筆</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 dark:text-gray-400">每頁</span>
                    <select
                      value={itemsPerPage}
                      onChange={(e) => {
                        setItemsPerPage(Number(e.target.value))
                        setCurrentPage(1)
                      }}
                      className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                    >
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                    </select>
                    <span className="text-sm text-gray-600 dark:text-gray-400">筆</span>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">進貨單號</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">廠商名稱</th>
                      {isAdmin && (
                        <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">總金額</th>
                      )}
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">商品摘要</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">進貨日期</th>
                      {isAdmin && (
                        <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">操作</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {(() => {
                      const startIndex = (currentPage - 1) * itemsPerPage
                      const endIndex = startIndex + itemsPerPage
                      const paginatedPurchases = displayedPurchases.slice(startIndex, endIndex)

                      return paginatedPurchases.map((purchase) => (
                        <React.Fragment key={purchase.id}>
                          <tr
                            className="hover:bg-gray-50/50 dark:hover:bg-gray-700/30 cursor-pointer transition-colors"
                            onClick={() => toggleRow(purchase.id)}
                          >
                            <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">
                              <div className="flex items-center gap-2">
                                <span className="text-gray-400 text-xs">
                                  {expandedRows.has(purchase.id) ? '▾' : '▸'}
                                </span>
                                {purchase.purchase_no}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{purchase.vendors?.vendor_name || purchase.vendor_code}</td>
                            {isAdmin && (
                              <td className={`px-6 py-4 text-right text-lg font-semibold ${purchase.total > 0
                                ? 'text-gray-900 dark:text-gray-100'
                                : 'text-gray-400 dark:text-gray-500'
                                }`}>
                                {formatCurrency(purchase.total)}
                              </td>
                            )}
                            <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                              {purchase.item_count || 0} 項 / {purchase.total_quantity || 0} 件
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                              {formatDate(purchase.purchase_date)}
                            </td>
                            {isAdmin && (
                              <td className="px-6 py-4 text-center text-sm" onClick={(e) => e.stopPropagation()}>
                                <div className="flex gap-2 justify-center">
                                  <button
                                    onClick={() => handleDeletePurchase(purchase.id, purchase.purchase_no)}
                                    disabled={deleting === purchase.id}
                                    className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:text-gray-300 disabled:cursor-not-allowed dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                                    title="刪除整張進貨單並回補庫存"
                                  >
                                    {deleting === purchase.id ? '刪除中' : '刪除'}
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                          {expandedRows.has(purchase.id) && purchase.purchase_items && (
                            <tr key={`${purchase.id}-details`}>
                              <td colSpan={isAdmin ? 6 : 4} className="bg-gray-50 dark:bg-gray-900 px-6 py-4">
                                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                                  {purchase.note && (
                                    <div className="mb-3 rounded bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                                      📝 {purchase.note}
                                    </div>
                                  )}
                                  <h4 className="mb-3 font-semibold text-gray-900 dark:text-gray-100">進貨明細</h4>
                                  <table className="w-full">
                                    <thead className="border-b">
                                      <tr>
                                        <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">品號</th>
                                        <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">商品名稱</th>
                                        <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">進貨數量</th>
                                        {isAdmin && (
                                          <>
                                            <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">成本</th>
                                            <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">小計</th>
                                          </>
                                        )}
                                        {isAdmin && (
                                          <th className="pb-2 text-center text-xs font-semibold text-gray-900 dark:text-gray-100">操作</th>
                                        )}
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y dark:divide-gray-700">
                                      {purchase.purchase_items.map((item) => (
                                          <tr key={item.id}>
                                            <td className="py-2 text-sm text-gray-900 dark:text-gray-100">
                                              <Link
                                                href={`/products/${item.product_id}/edit?returnTo=/purchases`}
                                                className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                {item.products.item_code}
                                              </Link>
                                            </td>
                                            <td className="py-2 text-sm text-gray-900 dark:text-gray-100">
                                              <Link
                                                href={`/products/${item.product_id}/edit?returnTo=/purchases`}
                                                className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                {item.products.name}
                                              </Link>
                                            </td>
                                            <td className="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                                              {item.quantity} {item.products.unit}
                                            </td>
                                            {isAdmin && (
                                              <>
                                                <td className="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                                                  {formatCurrency(item.cost)}
                                                </td>
                                                <td className="py-2 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
                                                  {formatCurrency(item.subtotal || Math.round(item.quantity * item.cost))}
                                                </td>
                                              </>
                                            )}
                                            {isAdmin && (
                                              <td className="py-2 text-center text-sm">
                                                <div className="flex gap-2 justify-center">
                                                  <button
                                                    onClick={() => handleDeleteItem(item.id, item.products.name, purchase.id)}
                                                    disabled={deleting === item.id}
                                                    className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:text-gray-300 disabled:cursor-not-allowed dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                                                    title="刪除這個品項並回補庫存"
                                                  >
                                                    {deleting === item.id ? '刪除中' : '刪除'}
                                                  </button>
                                                </div>
                                              </td>
                                            )}
                                          </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))
                    })()}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {displayedPurchases.length > itemsPerPage && (
                <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-3 pb-4 px-4">
                  {/* Mobile: Simple prev/next */}
                  <div className="flex sm:hidden items-center gap-2 w-full">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="flex-1 px-4 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
                    >
                      上一頁
                    </button>
                    <span className="text-sm text-gray-600 dark:text-gray-400 px-2">
                      {currentPage} / {Math.ceil(displayedPurchases.length / itemsPerPage)}
                    </span>
                    <button
                      onClick={() => setCurrentPage(p => Math.min(Math.ceil(displayedPurchases.length / itemsPerPage), p + 1))}
                      disabled={currentPage >= Math.ceil(displayedPurchases.length / itemsPerPage)}
                      className="flex-1 px-4 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
                    >
                      下一頁
                    </button>
                  </div>

                  {/* Desktop: Full pagination */}
                  <div className="hidden sm:flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      上一頁
                    </button>

                    {(() => {
                      const totalPages = Math.ceil(displayedPurchases.length / itemsPerPage)
                      const pages: (number | string)[] = []

                      if (totalPages <= 7) {
                        for (let i = 1; i <= totalPages; i++) pages.push(i)
                      } else {
                        if (currentPage <= 4) {
                          for (let i = 1; i <= 5; i++) pages.push(i)
                          pages.push('...')
                          pages.push(totalPages)
                        } else if (currentPage >= totalPages - 3) {
                          pages.push(1)
                          pages.push('...')
                          for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i)
                        } else {
                          pages.push(1)
                          pages.push('...')
                          for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i)
                          pages.push('...')
                          pages.push(totalPages)
                        }
                      }

                      return pages.map((page, idx) =>
                        typeof page === 'number' ? (
                          <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            className={`px-3 py-1 text-sm rounded ${currentPage === page
                              ? 'bg-blue-600 text-white'
                              : 'border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'
                              }`}
                          >
                            {page}
                          </button>
                        ) : (
                          <span key={`ellipsis-${idx}`} className="px-2 text-gray-500">
                            {page}
                          </span>
                        )
                      )
                    })()}

                    <button
                      onClick={() => setCurrentPage(p => Math.min(Math.ceil(displayedPurchases.length / itemsPerPage), p + 1))}
                      disabled={currentPage >= Math.ceil(displayedPurchases.length / itemsPerPage)}
                      className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      下一頁
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
