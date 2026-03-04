'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function NewProductPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(data => {
      if (data?.role !== 'admin') router.replace('/products')
    })
  }, [])
  const [error, setError] = useState('')
  const [barcode, setBarcode] = useState('')

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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    // Prevent double submission
    if (loading) {
      return
    }

    setLoading(true)
    setError('')

    const formData = new FormData(e.currentTarget)

    const data = {
      name: formData.get('name'),
      barcode: barcode || null,
      price: parseFloat(formData.get('price') as string) || 0,
      cost: parseFloat(formData.get('cost') as string) || 0,
      stock: parseFloat(formData.get('stock') as string) || 0,
      allow_negative: formData.get('allow_negative') === 'on',
    }

    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      const result = await res.json()

      if (result.ok) {
        router.push('/products')
      } else {
        setError(result.error || '建立失敗')
      }
    } catch (err) {
      setError('建立失敗')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 dark:bg-gray-900">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-100">新增商品</h1>

        <form
          onSubmit={handleSubmit}
          onKeyDown={(e) => {
            // Prevent Enter key from submitting the form (except from submit button)
            if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
              e.preventDefault()
            }
          }}
          className="rounded-lg bg-white p-4 shadow dark:bg-gray-800 md:p-6"
        >
          {error && (
            <div className="mb-4 rounded bg-red-50 p-3 text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</div>
          )}

          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
              商品名稱 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="name"
              required
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
                defaultValue="0"
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">成本</label>
              <input
                type="number"
                name="cost"
                min="0"
                step="0.01"
                defaultValue="0"
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">初始庫存</label>
            <input
              type="number"
              name="stock"
              min="0"
              step="1"
              defaultValue="0"
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>

          <div className="mb-6">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="allow_negative" defaultChecked className="h-4 w-4" />
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
              disabled={loading}
              className="flex-1 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600"
            >
              {loading ? '建立中...' : '建立商品'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
