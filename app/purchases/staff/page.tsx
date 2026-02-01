'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import type { Product } from '@/types'

// 動態載入相機掃描元件（避免 SSR 問題）
const CameraScanner = dynamic(() => import('@/components/CameraScanner'), {
  ssr: false,
  loading: () => null,
})

type Vendor = {
  id: string
  vendor_code: string
  vendor_name: string
}

type PurchaseItem = {
  product_id: string
  product?: Product
  quantity: number
}

export default function StaffPurchasePage() {
  const router = useRouter()
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [vendorCode, setVendorCode] = useState('')
  const [items, setItems] = useState<PurchaseItem[]>([])
  const [searchKeyword, setSearchKeyword] = useState('')
  const [searchResults, setSearchResults] = useState<Product[]>([])
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showQuickCreate, setShowQuickCreate] = useState(false)
  const [quickProductName, setQuickProductName] = useState('')
  const [quickBarcode, setQuickBarcode] = useState('')
  const [creatingProduct, setCreatingProduct] = useState(false)

  // 相機掃描
  const [showCameraScanner, setShowCameraScanner] = useState(false)

  // 掃描槍防抖處理
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const allProductsRef = useRef<Product[]>([])
  const [allProductsLoaded, setAllProductsLoaded] = useState(false)

  useEffect(() => {
    fetchVendors()
    fetchAllProducts()
  }, [])

  const fetchVendors = async () => {
    try {
      const res = await fetch('/api/vendors')
      const data = await res.json()
      if (data.ok) {
        setVendors(data.data || [])
      }
    } catch (err) {
      console.error('Failed to fetch vendors:', err)
    }
  }

  // 預載所有商品用於快速條碼比對
  const fetchAllProducts = async () => {
    try {
      const res = await fetch('/api/products?limit=10000')
      const data = await res.json()
      if (data.ok) {
        allProductsRef.current = data.data || []
        setAllProductsLoaded(true)
      }
    } catch (err) {
      console.error('Failed to fetch products:', err)
    }
  }

  const searchProducts = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      setSearching(false)
      setShowQuickCreate(false)
      return
    }

    setSearching(true)
    try {
      const res = await fetch(`/api/products/search?keyword=${encodeURIComponent(query)}&active_only=false`)
      const data = await res.json()
      if (data.ok) {
        setSearchResults(data.data || [])
        // 如果找不到商品，顯示快速建立選項
        if (data.data.length === 0) {
          setShowQuickCreate(true)
          setQuickProductName(query)
        } else {
          setShowQuickCreate(false)
        }
      } else {
        setSearchResults([])
        setShowQuickCreate(true)
        setQuickProductName(query)
      }
    } catch (err) {
      console.error('Search error:', err)
      setSearchResults([])
      setShowQuickCreate(true)
      setQuickProductName(query)
    } finally {
      setSearching(false)
    }
  }

  // 處理搜尋輸入（支援掃描槍快速輸入）
  const handleSearchInput = (value: string) => {
    setSearchKeyword(value)

    // 清除之前的計時器
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current)
    }
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    // 掃描槍偵測：100ms 內完成輸入且內容較長視為條碼掃描
    scanTimeoutRef.current = setTimeout(() => {
      if (value.trim() && allProductsLoaded) {
        // 嘗試精確比對條碼
        const matchedProduct = allProductsRef.current.find(
          p => p.barcode && p.barcode.toLowerCase() === value.trim().toLowerCase()
        )
        if (matchedProduct) {
          addItem(matchedProduct)
          return
        }
      }

      // 如果不是條碼，延遲搜尋
      searchTimeoutRef.current = setTimeout(() => {
        searchProducts(value)
      }, 200)
    }, 100)
  }

  const createQuickProduct = async () => {
    if (!quickProductName.trim()) {
      setError('請輸入商品名稱')
      return
    }

    setCreatingProduct(true)
    setError('')

    try {
      const res = await fetch('/api/products/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: quickProductName,
          barcode: quickBarcode || null,
        }),
      })

      const data = await res.json()

      if (data.ok) {
        // 自動添加到進貨清單
        addItem(data.data)
        setShowQuickCreate(false)
        setQuickProductName('')
        setQuickBarcode('')
        setSearchKeyword('')
      } else {
        setError(data.error || '建立商品失敗')
      }
    } catch (err) {
      setError('建立商品失敗')
    } finally {
      setCreatingProduct(false)
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
        product_id: product.id,
        product,
        quantity: 1,
      },
    ])
    setSearchKeyword('')
    setSearchResults([])
    setShowQuickCreate(false)
    setError('')
  }

  // 相機掃描結果處理
  const handleCameraScan = (code: string) => {
    if (allProductsLoaded) {
      const matchedProduct = allProductsRef.current.find(
        p => p.barcode && p.barcode.toLowerCase() === code.toLowerCase()
      )
      if (matchedProduct) {
        addItem(matchedProduct)
        setShowCameraScanner(false)
        return
      }
    }
    // 找不到商品，將條碼填入搜尋框讓用戶手動搜尋
    setSearchKeyword(code)
    setShowCameraScanner(false)
    searchProducts(code)
  }

  const updateQuantity = (index: number, value: number) => {
    setItems(
      items.map((item, i) =>
        i === index ? { ...item, quantity: value } : item
      )
    )
  }

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!vendorCode) {
      setError('請選擇廠商')
      return
    }

    if (items.length === 0) {
      setError('請至少新增一項商品')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/purchases/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_code: vendorCode,
          items: items.map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity,
          })),
        }),
      })

      const data = await res.json()

      if (data.ok) {
        router.push('/purchases')
      } else {
        setError(data.error || '提交失敗')
      }
    } catch (err) {
      setError('提交失敗')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 dark:bg-gray-900">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">員工進貨登記</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            只需填寫數量，成本和其他資料由主管後續補充
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded bg-red-50 p-3 text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</div>
          )}

          {/* Vendor selection */}
          <div className="rounded-lg bg-white p-4 shadow dark:bg-gray-800 md:p-6">
            <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100">
              廠商 <span className="text-red-500">*</span>
            </label>
            <select
              value={vendorCode}
              onChange={(e) => setVendorCode(e.target.value)}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              required
            >
              <option value="">請選擇廠商</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.vendor_code}>
                  {vendor.vendor_code} - {vendor.vendor_name}
                </option>
              ))}
            </select>
          </div>

          {/* Product search with quick create */}
          <div className="rounded-lg bg-white p-4 shadow dark:bg-gray-800 md:p-6">
            <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100">搜尋或掃描商品條碼</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => handleSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  // 阻止 Enter 鍵觸發表單提交（掃描槍通常會在條碼後發送 Enter）
                  if (e.key === 'Enter') {
                    e.preventDefault()
                  }
                }}
                placeholder="輸入商品名稱、品號或掃描條碼"
                className="flex-1 rounded border border-gray-300 bg-white px-4 py-2 text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
              />
              <button
                type="button"
                onClick={() => setShowCameraScanner(true)}
                className="rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 text-xl"
                title="相機掃碼"
              >
                📷
              </button>
            </div>

            {/* Search status and results */}
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
                      {product.item_code} | 庫存: {product.stock} {product.unit}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Quick create product */}
            {!searching && showQuickCreate && (
              <div className="mt-2 rounded border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
                <p className="mb-3 text-sm font-medium text-blue-900 dark:text-blue-300">
                  找不到商品？快速建立新商品
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs text-gray-700 dark:text-gray-300">商品名稱 *</label>
                    <input
                      type="text"
                      value={quickProductName}
                      onChange={(e) => setQuickProductName(e.target.value)}
                      className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                      placeholder="商品名稱"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-700 dark:text-gray-300">條碼（選填）</label>
                    <input
                      type="text"
                      value={quickBarcode}
                      onChange={(e) => setQuickBarcode(e.target.value)}
                      className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                      placeholder="條碼"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={createQuickProduct}
                    disabled={creatingProduct}
                    className="w-full rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:bg-gray-400"
                  >
                    {creatingProduct ? '建立中...' : '建立並加入進貨清單'}
                  </button>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    註：成本、售價等資訊將由主管後續補充
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Items table (quantity only) */}
          <div className="rounded-lg bg-white p-4 shadow dark:bg-gray-800 md:p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">進貨清單</h2>

            {items.length === 0 ? (
              <p className="py-8 text-center text-gray-600 dark:text-gray-400">尚未新增商品</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">商品</th>
                      <th className="px-4 py-2 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">數量</th>
                      <th className="px-4 py-2 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">單位</th>
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
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={(e) =>
                              updateQuantity(index, parseInt(e.target.value) || 0)
                            }
                            min="1"
                            className="w-20 rounded border border-gray-300 bg-white px-2 py-1 text-center text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                          />
                        </td>
                        <td className="px-4 py-3 text-center text-gray-900 dark:text-gray-100">
                          {item.product?.unit || '件'}
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
              取消
            </button>
            <button
              type="submit"
              disabled={loading || items.length === 0}
              className="flex-1 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600"
            >
              {loading ? '提交中...' : '提交進貨申請'}
            </button>
          </div>
        </form>
      </div>

      {/* 相機掃描 Modal */}
      {showCameraScanner && (
        <CameraScanner
          isOpen={showCameraScanner}
          onScan={handleCameraScan}
          onClose={() => setShowCameraScanner(false)}
        />
      )}
    </div>
  )
}
