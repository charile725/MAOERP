'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'
import type { Product } from '@/types'

type PurchaseItem = {
  id: string
  product_id: string
  product?: Product
  quantity: number
  cost: number
  subtotal: number
}

type Purchase = {
  id: string
  purchase_no: string
  vendor_code: string
  status: string
  created_by: string
  note: string
  vendors?: {
    vendor_name: string
  }
  purchase_items: PurchaseItem[]
}

export default function ReviewPurchasePage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [purchase, setPurchase] = useState<Purchase | null>(null)
  const [items, setItems] = useState<PurchaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [searchResults, setSearchResults] = useState<Product[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    fetchPurchase()
  }, [id])

  const fetchPurchase = async () => {
    try {
      const res = await fetch(`/api/purchases/${id}`)
      const data = await res.json()
      if (data.ok) {
        setPurchase(data.data)
        // Map purchase_items to include product data with correct structure
        const mappedItems = (data.data.purchase_items || []).map((item: any) => ({
          id: item.id,
          product_id: item.product_id,
          product: item.products, // Supabase returns 'products' (plural)
          quantity: item.quantity,
          cost: item.cost,
          subtotal: item.subtotal || Math.round(item.quantity * item.cost),
        }))
        setItems(mappedItems)
      } else {
        setError('無法載入進貨單')
      }
    } catch (err) {
      setError('載入失敗')
    } finally {
      setLoading(false)
    }
  }

  const searchProducts = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      setSearching(false)
      return
    }

    setSearching(true)
    try {
      const res = await fetch(`/api/products/search?keyword=${encodeURIComponent(query)}&active_only=false`)
      const data = await res.json()
      if (data.ok) {
        setSearchResults(data.data || [])
      } else {
        setSearchResults([])
      }
    } catch (err) {
      console.error('Search error:', err)
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  const addItem = (product: Product) => {
    const existing = items.find((item) => item.product_id === product.id)
    if (existing) {
      setError('商品已在清單中')
      setTimeout(() => setError(''), 3000)
      return
    }

    setItems([
      ...items,
      {
        id: '', // New item, no ID yet
        product_id: product.id,
        product,
        quantity: 1,
        cost: product.cost || 0,
        subtotal: product.cost || 0,
      },
    ])
    setSearchKeyword('')
    setSearchResults([])
    setError('')
  }

  const updateItem = (index: number, field: 'quantity' | 'cost', value: number) => {
    setItems(
      items.map((item, i) => {
        if (i === index) {
          const updated = { ...item, [field]: value }
          updated.subtotal = updated.quantity * updated.cost
          return updated
        }
        return item
      })
    )
  }

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index))
  }

  const total = items.reduce((sum, item) => sum + item.subtotal, 0)

  const handleApprove = async () => {
    if (items.length === 0) {
      setError('請至少保留一項商品')
      return
    }

    // Check if all costs are filled
    const hasEmptyCost = items.some(item => item.cost === 0)
    if (hasEmptyCost) {
      const confirm = window.confirm('有商品成本為 0，確定要批准嗎？')
      if (!confirm) return
    }

    setSubmitting(true)
    setError('')

    try {
      const res = await fetch(`/api/purchases/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((item) => ({
            id: item.id || undefined, // Existing item ID
            product_id: item.product_id,
            quantity: item.quantity,
            cost: item.cost,
          })),
        }),
      })

      const data = await res.json()

      if (data.ok) {
        alert('進貨單已批准，庫存已更新')
        router.push('/purchases')
      } else {
        setError(data.error || '批准失敗')
      }
    } catch (err) {
      setError('批准失敗')
    } finally {
      setSubmitting(false)
    }
  }

  const handleReject = async () => {
    const confirm = window.confirm('確定要拒絕此進貨單嗎？')
    if (!confirm) return

    setSubmitting(true)
    setError('')

    try {
      const res = await fetch(`/api/purchases/${id}`, {
        method: 'DELETE',
      })

      const data = await res.json()

      if (data.ok) {
        alert('進貨單已拒絕')
        router.push('/purchases')
      } else {
        setError(data.error || '拒絕失敗')
      }
    } catch (err) {
      setError('拒絕失敗')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-900 dark:text-gray-100">載入中...</div>
      </div>
    )
  }

  if (!purchase || purchase.status !== 'pending') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-red-600 dark:text-red-400">此進貨單不存在或已審核</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 dark:bg-gray-900">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">審核進貨單</h1>
          <div className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-400">
            <p>進貨單號: {purchase.purchase_no}</p>
            <p>廠商: {purchase.vendor_code} - {purchase.vendors?.vendor_name}</p>
            <p>提交人: {purchase.created_by}</p>
            {purchase.note && <p>備註: {purchase.note}</p>}
          </div>
        </div>

        <div className="space-y-6">
          {error && (
            <div className="rounded bg-red-50 p-3 text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</div>
          )}

          {/* Add more products */}
          <div className="rounded-lg bg-white p-4 shadow dark:bg-gray-800 md:p-6">
            <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100">新增商品（選填）</label>
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => {
                setSearchKeyword(e.target.value)
                searchProducts(e.target.value)
              }}
              placeholder="搜尋商品以新增到進貨單"
              className="w-full rounded border border-gray-300 bg-white px-4 py-2 text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
            />

            {searching && (
              <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-3 text-center text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-700 dark:text-gray-100">
                搜尋中...
              </div>
            )}

            {!searching && searchResults.length > 0 && (
              <div className="mt-2 max-h-60 overflow-y-auto rounded border border-gray-200 dark:border-gray-700">
                {searchResults.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addItem(product)}
                    className="w-full border-b border-gray-100 p-3 text-left hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
                  >
                    <div className="font-medium text-gray-900 dark:text-gray-100">{product.name}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-300">
                      {product.item_code} | 成本: {formatCurrency(product.cost)} | 庫存: {product.stock}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Items table */}
          <div className="rounded-lg bg-white p-4 shadow dark:bg-gray-800 md:p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">進貨明細（可調整）</h2>

            {items.length === 0 ? (
              <p className="py-8 text-center text-gray-600 dark:text-gray-400">尚無商品</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">商品</th>
                      <th className="px-4 py-2 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">數量</th>
                      <th className="px-4 py-2 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">成本</th>
                      <th className="px-4 py-2 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">小計</th>
                      <th className="px-4 py-2 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {items.map((item, index) => (
                      <tr key={index}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900 dark:text-gray-100">{item.product?.name}</div>
                          <div className="text-sm text-gray-600 dark:text-gray-300">
                            {item.product?.item_code}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={(e) =>
                              updateItem(index, 'quantity', parseInt(e.target.value) || 0)
                            }
                            min="1"
                            className="w-20 rounded border border-gray-300 bg-white px-2 py-1 text-center text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="number"
                            value={item.cost}
                            onChange={(e) =>
                              updateItem(index, 'cost', parseFloat(e.target.value) || 0)
                            }
                            min="0"
                            step="0.01"
                            className="w-28 rounded border border-gray-300 bg-white px-2 py-1 text-right text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                          />
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-gray-100">
                          {formatCurrency(item.subtotal)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => removeItem(index)}
                            className="font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-500"
                          >
                            刪除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <td colSpan={3} className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-gray-100">
                        合計
                      </td>
                      <td className="px-4 py-3 text-right text-lg font-bold text-gray-900 dark:text-gray-100">
                        {formatCurrency(total)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex-1 rounded border border-gray-300 px-4 py-2 text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              返回
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={submitting}
              className="flex-1 rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:bg-gray-300 dark:disabled:bg-gray-600"
            >
              {submitting ? '處理中...' : '拒絕'}
            </button>
            <button
              type="button"
              onClick={handleApprove}
              disabled={submitting || items.length === 0}
              className="flex-1 rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:bg-gray-300 dark:disabled:bg-gray-600"
            >
              {submitting ? '處理中...' : '批准進貨'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
