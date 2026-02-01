'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { formatDate } from '@/lib/utils'
import type { Product } from '@/types'

type UserRole = 'admin' | 'staff'

type StockAdjustment = {
  id: string
  product_id: string
  previous_stock: number
  adjusted_stock: number
  difference: number
  note: string | null
  created_at: string
}

export default function EditProductPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const productId = params.id as string
  const returnTo = searchParams.get('returnTo') // 來源頁面，完成後返回

  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [barcode, setBarcode] = useState('')
  const [userRole, setUserRole] = useState<UserRole | null>(null)

  // Stock adjustment states
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([])
  const [showAdjustForm, setShowAdjustForm] = useState(false)
  const [adjustedStock, setAdjustedStock] = useState('')
  const [adjustNote, setAdjustNote] = useState('')
  const [adjusting, setAdjusting] = useState(false)

  const isAdmin = userRole === 'admin'

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
    fetchProduct()
    fetchAdjustments()
  }, [productId])

  const fetchProduct = async () => {
    try {
      const res = await fetch(`/api/products/${productId}`)
      const data = await res.json()
      if (data.ok) {
        setProduct(data.data)
        setBarcode(data.data.barcode || '')
      } else {
        setError('商品不存在')
      }
    } catch (err) {
      setError('載入失敗')
    } finally {
      setLoading(false)
    }
  }

  const generateBarcode = () => {
    // 生成13位 EAN13 條碼格式
    // 使用時間戳 + 隨機數確保唯一性
    const timestamp = Date.now().toString().slice(-9) // 取後9位
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0') // 3位隨機數
    const baseCode = timestamp + random // 12位

    // 計算 EAN13 校驗碼
    let sum = 0
    for (let i = 0; i < 12; i++) {
      const digit = parseInt(baseCode[i])
      sum += i % 2 === 0 ? digit : digit * 3
    }
    const checkDigit = (10 - (sum % 10)) % 10

    const generatedBarcode = baseCode + checkDigit
    setBarcode(generatedBarcode)
  }

  const fetchAdjustments = async () => {
    try {
      const res = await fetch(`/api/products/${productId}/adjustments`)
      const data = await res.json()
      if (data.ok) {
        setAdjustments(data.data || [])
      }
    } catch (err) {
      console.error('Failed to fetch adjustments:', err)
    }
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    const formData = new FormData(e.currentTarget)

    const data = {
      name: formData.get('name'),
      barcode: barcode || null,
      price: parseFloat(formData.get('price') as string) || 0,
      cost: parseFloat(formData.get('cost') as string) || 0,
      allow_negative: formData.get('allow_negative') === 'on',
    }

    console.log('Updating product with data:', data)

    try {
      const res = await fetch(`/api/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      const result = await res.json()
      console.log('Update result:', result)

      if (result.ok) {
        // 根據來源頁面決定返回位置
        if (returnTo) {
          router.push(returnTo)
        } else {
          router.back()
        }
        return
      } else {
        setError(result.error || '更新失敗')
      }
    } catch (err) {
      console.error('Update error:', err)
      setError('更新失敗')
    } finally {
      setSaving(false)
    }
  }

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!product) return

    const stock = parseInt(adjustedStock)
    if (isNaN(stock) || stock < 0) {
      alert('請輸入有效的庫存數量')
      return
    }

    setAdjusting(true)
    try {
      const res = await fetch(`/api/products/${productId}/adjust-stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adjusted_stock: stock,
          note: adjustNote || null,
        }),
      })

      const result = await res.json()

      if (result.ok) {
        alert(
          `盤點完成！\n` +
          `盤點前：${result.data.adjustment.previous_stock}\n` +
          `盤點後：${result.data.adjustment.adjusted_stock}\n` +
          `差異：${result.data.adjustment.difference > 0 ? '+' : ''}${result.data.adjustment.difference}`
        )
        setProduct(result.data.product)
        setAdjustedStock('')
        setAdjustNote('')
        setShowAdjustForm(false)
        fetchAdjustments()
      } else {
        alert(`盤點失敗：${result.error}`)
      }
    } catch (err) {
      alert('盤點失敗')
    } finally {
      setAdjusting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-xl text-gray-900 dark:text-gray-100">載入中...</div>
      </div>
    )
  }

  if (!product) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-xl text-gray-900 dark:text-gray-100">商品不存在</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 dark:bg-gray-900">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-100">編輯商品</h1>

        {/* Product Info */}
        <div className="mb-6 rounded-lg bg-white p-4 shadow dark:bg-gray-800 md:p-6">
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">品號</label>
            <div className="rounded border border-gray-300 bg-gray-100 px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100">
              {product.item_code}
            </div>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">目前庫存</label>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{product.stock}</div>
            </div>
            {isAdmin && (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">平均成本</label>
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">NT$ {product.avg_cost.toFixed(2)}</div>
              </div>
            )}
          </div>
        </div>

        {/* Stock Adjustment Section */}
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 shadow dark:border-blue-800 dark:bg-blue-950/30 md:p-6">
          <div className="mb-3 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">庫存盤點</h3>
            {!showAdjustForm && (
              <button
                type="button"
                onClick={() => setShowAdjustForm(true)}
                className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
              >
                開始盤點
              </button>
            )}
          </div>

          {showAdjustForm && (
            <form onSubmit={handleAdjustStock} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                  實際盤點數量 <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={adjustedStock}
                  onChange={(e) => setAdjustedStock(e.target.value)}
                  min="0"
                  step="1"
                  required
                  className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  placeholder="輸入實際盤點的庫存數量"
                />
                {adjustedStock && product && (
                  <p className="mt-1 text-xs text-gray-900 dark:text-gray-100">
                    差異：
                    <span className={
                      parseInt(adjustedStock) - product.stock > 0
                        ? 'text-green-600 dark:text-green-400'
                        : parseInt(adjustedStock) - product.stock < 0
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-gray-600 dark:text-gray-400'
                    }>
                      {parseInt(adjustedStock) - product.stock > 0 ? '+' : ''}
                      {parseInt(adjustedStock) - product.stock}
                    </span>
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">備註</label>
                <textarea
                  value={adjustNote}
                  onChange={(e) => setAdjustNote(e.target.value)}
                  rows={2}
                  className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  placeholder="盤點原因或說明（選填）"
                />
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => {
                    setShowAdjustForm(false)
                    setAdjustedStock('')
                    setAdjustNote('')
                  }}
                  className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={adjusting}
                  className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600"
                >
                  {adjusting ? '處理中...' : '確認盤點'}
                </button>
              </div>
            </form>
          )}

          {/* Adjustment History */}
          {adjustments.length > 0 && (
            <div className="mt-4 border-t border-blue-200 pt-3 dark:border-blue-800">
              <h4 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">盤點記錄</h4>
              <div className="max-h-60 overflow-x-auto overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-blue-200 dark:border-blue-800">
                    <tr>
                      <th className="pb-1 text-left text-gray-900 dark:text-gray-100">日期</th>
                      <th className="pb-1 text-right text-gray-900 dark:text-gray-100">盤點前</th>
                      <th className="pb-1 text-right text-gray-900 dark:text-gray-100">盤點後</th>
                      <th className="pb-1 text-right text-gray-900 dark:text-gray-100">差異</th>
                      <th className="pb-1 text-left text-gray-900 dark:text-gray-100">備註</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-blue-100 dark:divide-blue-900">
                    {adjustments.map((adj) => (
                      <tr key={adj.id}>
                        <td className="py-1 text-gray-900 dark:text-gray-100">{formatDate(adj.created_at)}</td>
                        <td className="py-1 text-right text-gray-900 dark:text-gray-100">{adj.previous_stock}</td>
                        <td className="py-1 text-right text-gray-900 dark:text-gray-100">{adj.adjusted_stock}</td>
                        <td className={`py-1 text-right ${adj.difference > 0 ? 'text-green-600 dark:text-green-400' : adj.difference < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'
                          }`}>
                          {adj.difference > 0 ? '+' : ''}{adj.difference}
                        </td>
                        <td className="py-1 text-gray-900 dark:text-gray-100">{adj.note || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Edit Form */}
        <form onSubmit={handleSubmit} className="rounded-lg bg-white p-4 shadow dark:bg-gray-800 md:p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">編輯商品資訊</h2>

          {error && (
            <div className="mb-4 rounded bg-red-50 p-3 text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</div>
          )}

          {success && (
            <div className="mb-4 rounded bg-green-50 p-3 text-green-700 dark:bg-green-900/20 dark:text-green-400">{success}</div>
          )}

          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
              商品名稱 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="name"
              required
              key={`name-${product.name}`}
              defaultValue={product.name}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>

          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">條碼</label>
            <div className="flex gap-2">
              <input
                type="text"
                name="barcode"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                  }
                }}
                className="flex-1 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
                placeholder="選填或點擊生成"
              />
              <button
                type="button"
                onClick={generateBarcode}
                className="whitespace-nowrap rounded bg-purple-600 px-4 py-2 text-white hover:bg-purple-700"
              >
                隨機生成
              </button>
            </div>
            {barcode && (
              <div className="mt-2 flex items-center gap-2">
                <img
                  src={`/api/barcode?text=${encodeURIComponent(barcode)}&type=code128&format=png&height=30&width=2`}
                  alt="條碼預覽"
                  className="h-auto max-w-[200px]"
                />
              </div>
            )}
          </div>

          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                售價 <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="price"
                required
                min="0"
                step="0.01"
                key={`price-${product.price}`}
                defaultValue={product.price}
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>

            {isAdmin && (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                  成本 <span className="text-xs text-gray-500 dark:text-gray-400">（參考成本，可隨時修改）</span>
                </label>
                <input
                  type="number"
                  name="cost"
                  min="0"
                  step="0.01"
                  key={`cost-${product.cost}`}
                  defaultValue={product.cost}
                  className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
            )}
          </div>

          <div className="mb-6">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="allow_negative"
                defaultChecked={product.allow_negative}
                className="h-4 w-4"
              />
              <span className="text-sm text-gray-900 dark:text-gray-100">允許負庫存</span>
            </label>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex-1 rounded border border-gray-300 px-4 py-2 text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600"
            >
              {saving ? '儲存中...' : '儲存變更'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
