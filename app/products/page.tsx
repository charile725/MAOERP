'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import useSWR from 'swr'
import { SWR_KEYS } from '@/lib/swr/keys'
import { paginatedFetcher } from '@/lib/swr/fetcher'
import { formatCurrency } from '@/lib/utils'
import type { Product } from '@/types'
import ProductImportModal from '@/components/ProductImportModal'
import CameraScanner from '@/components/CameraScanner'

type SortField = 'item_code' | 'name' | 'price' | 'avg_cost' | 'stock' | 'updated_at'
type SortOrder = 'asc' | 'desc'

export default function ProductsPage() {
  const [keyword, setKeyword] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [activeFilter, setActiveFilter] = useState<boolean | null>(null)
  const [page, setPage] = useState(1)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const menuButtonRefs = useRef<{ [key: string]: HTMLButtonElement | null }>({})
  const [sortBy, setSortBy] = useState<SortField>('updated_at')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [showImportModal, setShowImportModal] = useState(false)
  const [showScanner, setShowScanner] = useState(false)

  // 獲取用戶角色
  const { data: authData } = useSWR<{ role: 'admin' | 'staff' }>(SWR_KEYS.AUTH_ME)
  const userRole = authData?.role ?? null

  // 產品列表
  const productsParams = new URLSearchParams()
  if (searchKeyword) productsParams.set('keyword', searchKeyword)
  if (activeFilter !== null) productsParams.set('active', String(activeFilter))
  productsParams.set('page', String(page))
  productsParams.set('sortBy', sortBy)
  productsParams.set('sortOrder', sortOrder)
  const productsUrl = `/api/products?${productsParams}`

  const { data: productsResult, isLoading: loading, mutate } = useSWR<{ data: Product[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>(
    productsUrl,
    paginatedFetcher
  )
  const products = productsResult?.data ?? []
  const pagination = productsResult?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 }

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [activeFilter, sortBy, sortOrder])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    setSearchKeyword(keyword)
  }

  const handleScan = useCallback((code: string) => {
    setKeyword(code)
    setSearchKeyword(code)
    setPage(1)
  }, [])

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
  }

  const toggleActive = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch(`/api/products/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !isActive }),
      })

      if (res.ok) {
        mutate()
      }
    } catch (err) {
      console.error('Failed to update product:', err)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`確定要刪除商品「${name}」嗎？\n\n注意：此操作無法復原`)) {
      return
    }

    try {
      const res = await fetch(`/api/products/${id}`, {
        method: 'DELETE',
      })

      const data = await res.json()

      if (data.ok) {
        alert('商品已刪除')
        mutate()
      } else {
        alert(`刪除失敗：${data.error}`)
      }
    } catch (err) {
      alert('刪除失敗')
      console.error('Failed to delete product:', err)
    }
  }

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      // Toggle order if same field
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      // Default to desc for new field
      setSortBy(field)
      setSortOrder('desc')
    }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortBy !== field) {
      return <span className="ml-1 text-gray-400">↕</span>
    }
    return <span className="ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">商品庫</h1>
          <div className="flex gap-2">
            <Link
              href="/barcode-print"
              className="rounded bg-purple-600 px-4 py-2 text-white hover:bg-purple-700"
            >
              打印條碼
            </Link>
            {userRole === 'admin' && (
              <>
                <button
                  onClick={() => setShowImportModal(true)}
                  className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700"
                >
                  匯入
                </button>
                <Link
                  href="/products/new"
                  className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                >
                  + 新增商品
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="mb-6 rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
          <form onSubmit={handleSearch} className="mb-4 flex gap-2">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜尋商品名稱、品號或條碼"
              className="flex-1 rounded border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700 placeholder:text-gray-900 dark:placeholder:text-gray-400"
            />
            <button
              type="button"
              onClick={() => setShowScanner(true)}
              className="rounded bg-slate-700 px-3 py-2 text-white hover:bg-slate-600"
              title="掃描條碼"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M3 17v2a2 2 0 002 2h2M17 21h2a2 2 0 002-2v-2M7 12h10M12 7v10" />
              </svg>
            </button>
            <button
              type="submit"
              className="rounded bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700"
            >
              搜尋
            </button>
          </form>

          <div className="flex gap-2">
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
              上架
            </button>
            <button
              onClick={() => setActiveFilter(false)}
              className={`rounded px-4 py-1 font-medium ${activeFilter === false
                ? 'bg-red-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
            >
              下架
            </button>
          </div>
        </div>

        {/* Products table */}
        <div className="rounded-lg bg-white dark:bg-gray-800 shadow overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">載入中...</div>
          ) : products.length === 0 ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">沒有商品</div>
          ) : (
            <>
              <table className="w-full">
                <thead className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th
                      className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 select-none"
                      onClick={() => handleSort('item_code')}
                    >
                      <div className="flex items-center">
                        品號
                        <SortIcon field="item_code" />
                      </div>
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">條碼</th>
                    <th
                      className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 select-none"
                      onClick={() => handleSort('name')}
                    >
                      <div className="flex items-center">
                        商品名稱
                        <SortIcon field="name" />
                      </div>
                    </th>
                    <th
                      className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 select-none"
                      onClick={() => handleSort('price')}
                    >
                      <div className="flex items-center justify-end">
                        售價
                        <SortIcon field="price" />
                      </div>
                    </th>
                    {userRole === 'admin' && (
                      <th
                        className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 select-none"
                        onClick={() => handleSort('avg_cost')}
                      >
                        <div className="flex items-center justify-end">
                          成本
                          <SortIcon field="avg_cost" />
                        </div>
                      </th>
                    )}
                    <th
                      className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 select-none"
                      onClick={() => handleSort('stock')}
                    >
                      <div className="flex items-center justify-end whitespace-nowrap">
                        庫存
                        <SortIcon field="stock" />
                      </div>
                    </th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100 select-none">
                      <div className="flex items-center justify-end whitespace-nowrap">
                        待出貨
                      </div>
                    </th>
                    <th
                      className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 select-none"
                      onClick={() => handleSort('updated_at')}
                    >
                      <div className="flex items-center">
                        更新時間
                        <SortIcon field="updated_at" />
                      </div>
                    </th>
                    <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">
                      <div className="flex items-center justify-center">狀態</div>
                    </th>
                    <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">
                      <div className="flex items-center justify-center">操作</div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {products.map((product) => (
                    <tr key={product.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{product.item_code}</td>
                      <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{product.barcode || '-'}</td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">{product.name}</td>
                      <td className="px-6 py-4 text-right text-sm text-gray-900 dark:text-gray-100">
                        {formatCurrency(product.price)}
                      </td>
                      {userRole === 'admin' && (
                        <td className="px-6 py-4 text-right text-sm text-gray-900 dark:text-gray-100">
                          {formatCurrency(product.avg_cost)}
                        </td>
                      )}
                      <td className="px-6 py-4 text-right text-sm">
                        <span
                          className={
                            product.stock <= 3
                              ? 'font-semibold text-red-600 dark:text-red-400'
                              : product.stock <= 9
                                ? 'font-semibold text-orange-600 dark:text-orange-400'
                                : 'text-gray-900 dark:text-gray-100'
                          }
                        >
                          {product.stock <= 3 && '⚠ '}{product.stock}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-sm">
                        {product.pending_delivery ? (
                          <span className="font-semibold text-blue-600 dark:text-blue-400">
                            {product.pending_delivery}
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                        {product.updated_at
                          ? (() => {
                            const date = new Date(product.updated_at + 'Z')
                            return date.toLocaleString('zh-TW', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            })
                          })()
                          : '-'
                        }
                      </td>
                      <td className="px-6 py-4 text-center text-sm">
                        <span
                          className={`text-xs whitespace-nowrap ${product.is_active
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-gray-500 dark:text-gray-400'
                            }`}
                        >
                          {product.is_active ? '上架' : '下架'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center text-sm">
                        <button
                          ref={(el) => { menuButtonRefs.current[product.id] = el }}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (openMenuId === product.id) {
                              setOpenMenuId(null)
                              setMenuPosition(null)
                            } else {
                              const rect = e.currentTarget.getBoundingClientRect()
                              setMenuPosition({ top: rect.bottom + 4, left: rect.right - 128 })
                              setOpenMenuId(product.id)
                            }
                          }}
                          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-lg font-bold"
                          title="更多操作"
                        >
                          ⋯
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* Pagination */}
          {!loading && products.length > 0 && pagination.totalPages > 1 && (
            <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-700 dark:text-gray-300">
                  顯示第 {((pagination.page - 1) * pagination.pageSize) + 1} - {Math.min(pagination.page * pagination.pageSize, pagination.total)} 筆，共 {pagination.total} 筆
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handlePageChange(page - 1)}
                    disabled={page === 1}
                    className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    上一頁
                  </button>

                  {/* Page numbers */}
                  <div className="flex gap-1">
                    {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
                      .filter(p => {
                        // Show first page, last page, current page, and pages around current
                        return p === 1 ||
                          p === pagination.totalPages ||
                          (p >= page - 2 && p <= page + 2)
                      })
                      .map((p, idx, arr) => {
                        // Add ellipsis if there's a gap
                        const showEllipsisBefore = idx > 0 && arr[idx - 1] !== p - 1
                        return (
                          <div key={p} className="flex items-center gap-1">
                            {showEllipsisBefore && <span className="px-2 text-gray-500 dark:text-gray-400">...</span>}
                            <button
                              onClick={() => handlePageChange(p)}
                              className={`min-w-[2rem] rounded px-3 py-1 text-sm ${p === page
                                ? 'bg-blue-600 text-white'
                                : 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                                }`}
                            >
                              {p}
                            </button>
                          </div>
                        )
                      })}
                  </div>

                  <button
                    onClick={() => handlePageChange(page + 1)}
                    disabled={page === pagination.totalPages}
                    className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    下一頁
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Dropdown Menu Portal - 渲染在 body 避免被 overflow 裁切 */}
      {openMenuId && menuPosition && typeof document !== 'undefined' && createPortal(
        <>
          <div
            className="fixed inset-0 z-[100]"
            onClick={() => {
              setOpenMenuId(null)
              setMenuPosition(null)
            }}
          />
          <div
            className="fixed z-[101] w-32 rounded-lg bg-white dark:bg-gray-700 shadow-lg border border-gray-200 dark:border-gray-600 py-1"
            style={{ top: menuPosition.top, left: menuPosition.left }}
          >
            <Link
              href={`/products/${openMenuId}/edit`}
              className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600"
              onClick={() => {
                setOpenMenuId(null)
                setMenuPosition(null)
              }}
            >
              編輯
            </Link>
            <button
              onClick={() => {
                const product = products.find(p => p.id === openMenuId)
                if (product) {
                  toggleActive(product.id, product.is_active)
                }
                setOpenMenuId(null)
                setMenuPosition(null)
              }}
              className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600"
            >
              {products.find(p => p.id === openMenuId)?.is_active ? '下架' : '上架'}
            </button>
            <button
              onClick={() => {
                const product = products.find(p => p.id === openMenuId)
                if (product && confirm(`確定要刪除商品「${product.name}」嗎？此操作無法復原。`)) {
                  handleDelete(product.id, product.name)
                }
                setOpenMenuId(null)
                setMenuPosition(null)
              }}
              className="block w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-600"
            >
              刪除
            </button>
          </div>
        </>,
        document.body
      )}

      {/* Camera Scanner */}
      <CameraScanner
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={handleScan}
      />

      {/* Import Modal */}
      <ProductImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onSuccess={() => {
          mutate()
          setPage(1)
        }}
      />
    </div>
  )
}
