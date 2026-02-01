'use client'

import React, { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { formatCurrency, formatDate } from '@/lib/utils'

type PurchaseItem = {
  id: string
  quantity: number
  cost: number
  subtotal?: number  // 小計（優先使用，避免小數點問題）
  product_id: string
  received_quantity: number
  is_received: boolean
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
  status: string
  is_paid: boolean
  receiving_status: string
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
  purchase_status: string
  is_paid: boolean
  product_id: string
  item_code: string
  product_name: string
  unit: string
  quantity: number
  received_quantity: number
  is_received: boolean
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

type UserRole = 'admin' | 'staff'

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set())
  const [groupByVendor, setGroupByVendor] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [productKeyword, setProductKeyword] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<UserRole | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 50

  useEffect(() => {
    // Fetch current user role
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          setUserRole(data.data.role)
        }
      })
      .catch(() => {
        // Ignore error
      })
  }, [])

  const isAdmin = userRole === 'admin'

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

  // 按廠商分組（舊版，保留但不使用）
  const vendorGroups = useMemo(() => {
    if (!groupByVendor) return []

    const groups: { [key: string]: VendorGroup } = {}

    purchases.forEach((purchase) => {
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
  }, [purchases, groupByVendor])

  // 按廠商分組 - 直接顯示商品明細
  const vendorItemGroups = useMemo(() => {
    if (!groupByVendor) return []

    const groups: { [key: string]: VendorItemGroup } = {}

    purchases.forEach((purchase) => {
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
            purchase_status: purchase.status,
            is_paid: purchase.is_paid,
            product_id: item.product_id,
            item_code: item.products.item_code,
            product_name: item.products.name,
            unit: item.products.unit,
            quantity: item.quantity,
            received_quantity: item.received_quantity || 0,
            is_received: item.is_received,
            cost: item.cost,
            subtotal: item.subtotal
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
  }, [purchases, groupByVendor])

  const fetchPurchases = async () => {
    setLoading(true)
    setCurrentPage(1) // 重置到第一頁
    try {
      const params = new URLSearchParams()
      if (keyword) params.set('keyword', keyword)
      if (productKeyword) params.set('product_keyword', productKeyword)

      const res = await fetch(`/api/purchases?${params}`)
      const data = await res.json()
      if (data.ok) {
        // 计算每个进货单的收货状态
        const purchasesWithStatus = (data.data || []).map((purchase: Purchase) => {
          const items = purchase.purchase_items || []
          let receiving_status = 'none'

          if (items.length > 0) {
            // 安全地检查字段是否存在
            const allReceived = items.every(item => item.is_received === true)
            const anyReceived = items.some(item => (item.received_quantity || 0) > 0)

            if (allReceived) {
              receiving_status = 'completed'
            } else if (anyReceived) {
              receiving_status = 'partial'
            }
          }

          return {
            ...purchase,
            receiving_status
          }
        })

        setPurchases(purchasesWithStatus)
      }
    } catch (err) {
      console.error('Failed to fetch purchases:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPurchases()
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchPurchases()
  }

  const handleDeletePurchase = async (id: string, purchaseNo: string) => {
    if (!confirm(`確定要刪除進貨單 ${purchaseNo} 嗎？\n\n此操作將會回補庫存，且無法復原。`)) {
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
        fetchPurchases()
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
        alert('刪除成功，庫存已回補')
        fetchPurchases()
      } else {
        alert(`刪除失敗：${data.error}`)
      }
    } catch (err) {
      alert('刪除失敗')
    } finally {
      setDeleting(null)
    }
  }

  const handleReceiveItem = async (itemId: string, productName: string, remainingQty: number) => {
    const quantityStr = prompt(`收貨數量（剩餘: ${remainingQty}）：`, remainingQty.toString())
    if (!quantityStr) return

    const quantity = parseInt(quantityStr, 10)
    if (isNaN(quantity) || quantity <= 0) {
      alert('請輸入有效的數量')
      return
    }

    if (quantity > remainingQty) {
      alert(`收貨數量不能超過剩餘數量（${remainingQty}）`)
      return
    }

    setDeleting(itemId)
    try {
      const res = await fetch(`/api/purchase-items/${itemId}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity }),
      })

      const data = await res.json()

      if (data.ok) {
        alert(data.message || '收貨成功，庫存已增加')
        fetchPurchases()
      } else {
        alert(`收貨失敗：${data.error}`)
      }
    } catch (err) {
      alert('收貨失敗')
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
        <div className="mb-6 rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
          <form onSubmit={handleSearch} className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜尋進貨單號、廠商代碼或廠商名稱"
                className="flex-1 rounded border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700 placeholder:text-gray-900 dark:placeholder:text-gray-400"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={productKeyword}
                onChange={(e) => setProductKeyword(e.target.value)}
                placeholder="搜尋商品名稱或品號"
                className="flex-1 rounded border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700 placeholder:text-gray-900 dark:placeholder:text-gray-400"
              />
              <button
                type="submit"
                className="rounded bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700"
              >
                搜尋
              </button>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={groupByVendor}
                  onChange={(e) => {
                    setGroupByVendor(e.target.checked)
                    setCurrentPage(1)
                  }}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                按廠商分組
              </label>
            </div>
          </form>
        </div>

        <div className="rounded-lg bg-white dark:bg-gray-800 shadow">
          {loading ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">載入中...</div>
          ) : purchases.length === 0 ? (
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
                                <th className="py-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">已收貨</th>
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
                              {group.items.map((item) => {
                                const remainingQty = item.quantity - item.received_quantity
                                return (
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
                                    <td className="py-3 text-right text-sm">
                                      <span
                                        className={`font-medium ${item.is_received
                                          ? 'text-green-600 dark:text-green-400'
                                          : item.received_quantity > 0
                                            ? 'text-yellow-600 dark:text-yellow-400'
                                            : 'text-gray-600 dark:text-gray-400'
                                          }`}
                                      >
                                        {item.received_quantity} / {item.quantity}
                                      </span>
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
                                        {!item.is_received && (
                                          <button
                                            onClick={() => handleReceiveItem(item.id, item.product_name, remainingQty)}
                                            disabled={deleting === item.id}
                                            className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                                          >
                                            {deleting === item.id ? '...' : '收貨'}
                                          </button>
                                        )}
                                        {isAdmin && (
                                          <button
                                            onClick={() => handleDeleteItem(item.id, item.product_name, item.purchase_id)}
                                            disabled={deleting === item.id}
                                            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-base font-bold disabled:text-gray-300 disabled:cursor-not-allowed"
                                            title="刪除項目"
                                          >
                                            {deleting === item.id ? '...' : '⋯'}
                                          </button>
                                        )}
                                      </div>
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
            </>
          ) : (
            /* 平鋪顯示（原有邏輯） */
            <>
              {/* 分頁資訊 */}
              {purchases.length > 0 && (
                <div className="px-6 pt-6 pb-4 flex items-center justify-between">
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    共 {purchases.length} 筆記錄
                    {purchases.length > itemsPerPage && (
                      <span> · 顯示第 {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, purchases.length)} 筆</span>
                    )}
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
                      <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">審核</th>
                      <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">付款</th>
                      <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">收貨</th>
                      {isAdmin && (
                        <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">操作</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {(() => {
                      const startIndex = (currentPage - 1) * itemsPerPage
                      const endIndex = startIndex + itemsPerPage
                      const paginatedPurchases = purchases.slice(startIndex, endIndex)

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
                            <td className="px-6 py-4 text-center text-sm">
                              <span
                                className={`inline-flex items-center gap-1 text-xs ${purchase.status === 'approved'
                                  ? 'text-green-600 dark:text-green-400'
                                  : 'text-orange-500 dark:text-orange-400'
                                  }`}
                              >
                                {purchase.status === 'approved' ? '✓ 已審核' : '○ 待審核'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-center text-sm">
                              <span
                                className={`inline-flex items-center gap-1 text-xs ${purchase.is_paid
                                  ? 'text-green-600 dark:text-green-400'
                                  : 'text-gray-500 dark:text-gray-400'
                                  }`}
                              >
                                {purchase.is_paid ? '✓ 已付' : '○ 未付'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-center text-sm">
                              <span
                                className={`inline-flex items-center gap-1 text-xs ${purchase.receiving_status === 'completed'
                                  ? 'text-blue-600 dark:text-blue-400'
                                  : purchase.receiving_status === 'partial'
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-gray-500 dark:text-gray-400'
                                  }`}
                              >
                                {purchase.receiving_status === 'completed'
                                  ? '📦 已收貨'
                                  : purchase.receiving_status === 'partial'
                                    ? '⚡ 部分收貨'
                                    : '• 未收貨'}
                              </span>
                            </td>
                            {isAdmin && (
                              <td className="px-6 py-4 text-center text-sm" onClick={(e) => e.stopPropagation()}>
                                <div className="flex gap-2 justify-center">
                                  {purchase.status === 'pending' && (
                                    <Link
                                      href={`/purchases/${purchase.id}/review`}
                                      className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                                    >
                                      審核
                                    </Link>
                                  )}
                                  <button
                                    onClick={() => handleDeletePurchase(purchase.id, purchase.purchase_no)}
                                    disabled={deleting === purchase.id}
                                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-lg font-bold disabled:text-gray-300 disabled:cursor-not-allowed"
                                    title="更多操作"
                                  >
                                    {deleting === purchase.id ? '...' : '⋯'}
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                          {expandedRows.has(purchase.id) && purchase.purchase_items && (
                            <tr key={`${purchase.id}-details`}>
                              <td colSpan={isAdmin ? 9 : 7} className="bg-gray-50 dark:bg-gray-900 px-6 py-4">
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
                                        <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">已收貨</th>
                                        {isAdmin && (
                                          <>
                                            <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">成本</th>
                                            <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">小計</th>
                                          </>
                                        )}
                                        {(isAdmin || purchase.status === 'approved') && (
                                          <th className="pb-2 text-center text-xs font-semibold text-gray-900 dark:text-gray-100">操作</th>
                                        )}
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y dark:divide-gray-700">
                                      {purchase.purchase_items.map((item) => {
                                        const remainingQty = item.quantity - (item.received_quantity || 0)
                                        return (
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
                                            <td className="py-2 text-right text-sm">
                                              <span
                                                className={`font-medium ${item.is_received
                                                  ? 'text-green-600 dark:text-green-400'
                                                  : item.received_quantity > 0
                                                    ? 'text-yellow-600 dark:text-yellow-400'
                                                    : 'text-gray-600 dark:text-gray-400'
                                                  }`}
                                              >
                                                {item.received_quantity || 0} / {item.quantity}
                                              </span>
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
                                            {(isAdmin || purchase.status === 'approved') && (
                                              <td className="py-2 text-center text-sm">
                                                <div className="flex gap-2 justify-center">
                                                  {!item.is_received && (
                                                    <button
                                                      onClick={() => handleReceiveItem(item.id, item.products.name, remainingQty)}
                                                      disabled={deleting === item.id}
                                                      className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                                                    >
                                                      {deleting === item.id ? '收貨中' : '收貨'}
                                                    </button>
                                                  )}
                                                  {isAdmin && (
                                                    <button
                                                      onClick={() => handleDeleteItem(item.id, item.products.name, purchase.id)}
                                                      disabled={deleting === item.id}
                                                      className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-base font-bold disabled:text-gray-300 disabled:cursor-not-allowed"
                                                      title="刪除項目"
                                                    >
                                                      {deleting === item.id ? '...' : '⋯'}
                                                    </button>
                                                  )}
                                                </div>
                                              </td>
                                            )}
                                          </tr>
                                        )
                                      })}
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
              {purchases.length > itemsPerPage && (
                <div className="mt-4 flex items-center justify-center gap-2 pb-4">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    上一頁
                  </button>

                  {(() => {
                    const totalPages = Math.ceil(purchases.length / itemsPerPage)
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
                    onClick={() => setCurrentPage(p => Math.min(Math.ceil(purchases.length / itemsPerPage), p + 1))}
                    disabled={currentPage >= Math.ceil(purchases.length / itemsPerPage)}
                    className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    下一頁
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
