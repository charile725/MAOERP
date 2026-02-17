'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'

type Product = {
  id: string
  name: string
  item_code: string
  barcode?: string | null
  price: number
}

type IchibanKuji = {
  id: string
  name: string
  barcode?: string | null
  price: number
  ichiban_kuji_prizes: {
    id: string
    prize_tier: string
    product_id: string
    products: {
      id: string
      name: string
      item_code: string
      barcode?: string | null
      price: number
    }
  }[]
}

type PrintFormat = 'label-4x10' | 'label-3x8'

const FORMATS = {
  'label-4x10': {
    name: '標籤紙 4x10',
    columns: 4,
    rows: 10,
    width: 190,
    height: 84,
  },
  'label-3x8': {
    name: '標籤紙 3x8',
    columns: 3,
    rows: 8,
    width: 250,
    height: 105,
  },
}

export default function BarcodePrintPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const printAreaRef = useRef<HTMLDivElement>(null)

  const [products, setProducts] = useState<Product[]>([])
  const [ichibanKujis, setIchibanKujis] = useState<IchibanKuji[]>([])
  const [selectedItems, setSelectedItems] = useState<{
    id: string
    name: string
    code: string
    barcode: string
    price: number
    copies: number
    source: 'product' | 'prize' | 'kuji'
  }[]>([])
  const [format, setFormat] = useState<PrintFormat>('label-4x10')
  const [loading, setLoading] = useState(true)
  const [productSearchKeyword, setProductSearchKeyword] = useState('')
  const [kujiSearchKeyword, setKujiSearchKeyword] = useState('')

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      // Fetch products - get all products without pagination
      const productsRes = await fetch('/api/products?all=true')
      const productsData = await productsRes.json()
      if (productsData.ok) {
        setProducts(productsData.data || [])
      }

      // Fetch ichiban kujis
      const kujisRes = await fetch('/api/ichiban-kuji?all=true')
      const kujisData = await kujisRes.json()
      if (kujisData.ok) {
        setIchibanKujis(kujisData.data || [])
      }
    } catch (err) {
      console.error('Failed to fetch data:', err)
    } finally {
      setLoading(false)
    }
  }

  const addProduct = (product: Product) => {
    if (!product.barcode) {
      alert('該商品沒有條碼，請先設定條碼')
      return
    }

    const existing = selectedItems.find(item => item.id === product.id && item.source === 'product')
    if (existing) {
      setSelectedItems(items =>
        items.map(item =>
          item.id === product.id && item.source === 'product'
            ? { ...item, copies: item.copies + 1 }
            : item
        )
      )
    } else {
      setSelectedItems([
        ...selectedItems,
        {
          id: product.id,
          name: product.name,
          code: product.item_code,
          barcode: product.barcode!,
          price: product.price,
          copies: 1,
          source: 'product',
        },
      ])
    }
  }

  const addKuji = (kuji: IchibanKuji) => {
    if (!kuji.barcode) {
      alert('該一番賞沒有設定系列條碼')
      return
    }

    const existing = selectedItems.find(item => item.id === kuji.id && item.source === 'kuji')
    if (existing) {
      setSelectedItems(items =>
        items.map(item =>
          item.id === kuji.id && item.source === 'kuji'
            ? { ...item, copies: item.copies + 1 }
            : item
        )
      )
    } else {
      setSelectedItems([
        ...selectedItems,
        {
          id: kuji.id,
          name: kuji.name,
          code: `系列 - ${kuji.ichiban_kuji_prizes.length}個獎項`,
          barcode: kuji.barcode!,
          price: kuji.price,
          copies: 1,
          source: 'kuji',
        },
      ])
    }
  }

  const addPrize = (kuji: IchibanKuji, prize: IchibanKuji['ichiban_kuji_prizes'][0]) => {
    if (!prize.products.barcode) {
      alert('該獎項商品沒有條碼，請先設定條碼')
      return
    }

    const prizeId = `${kuji.id}-${prize.id}`
    const existing = selectedItems.find(item => item.id === prizeId && item.source === 'prize')
    if (existing) {
      setSelectedItems(items =>
        items.map(item =>
          item.id === prizeId && item.source === 'prize'
            ? { ...item, copies: item.copies + 1 }
            : item
        )
      )
    } else {
      setSelectedItems([
        ...selectedItems,
        {
          id: prizeId,
          name: `${kuji.name} - ${prize.prize_tier}賞`,
          code: prize.products.item_code,
          barcode: prize.products.barcode!,
          price: prize.products.price,
          copies: 1,
          source: 'prize',
        },
      ])
    }
  }

  const updateCopies = (id: string, source: 'product' | 'prize' | 'kuji', copies: number) => {
    if (copies <= 0) {
      setSelectedItems(items => items.filter(item => !(item.id === id && item.source === source)))
    } else {
      setSelectedItems(items =>
        items.map(item =>
          item.id === id && item.source === source ? { ...item, copies } : item
        )
      )
    }
  }

  const handlePrint = () => {
    window.print()
  }

  const addAllProducts = () => {
    const productsWithBarcode = filteredProducts.filter(p => p.barcode)

    if (productsWithBarcode.length === 0) {
      alert('沒有可新增的商品（需要有條碼）')
      return
    }

    productsWithBarcode.forEach(product => {
      const existing = selectedItems.find(item => item.id === product.id && item.source === 'product')
      if (!existing) {
        setSelectedItems(prev => [
          ...prev,
          {
            id: product.id,
            name: product.name,
            code: product.item_code,
            barcode: product.barcode!,
            price: product.price,
            copies: 1,
            source: 'product',
          },
        ])
      }
    })
  }

  const addAllPrizesFromKuji = (kuji: IchibanKuji) => {
    const prizesWithBarcode = kuji.ichiban_kuji_prizes.filter(p => p.products.barcode)

    if (prizesWithBarcode.length === 0) {
      alert('該一番賞沒有可新增的獎項（需要有條碼）')
      return
    }

    prizesWithBarcode.forEach(prize => {
      const prizeId = `${kuji.id}-${prize.id}`
      const existing = selectedItems.find(item => item.id === prizeId && item.source === 'prize')
      if (!existing) {
        setSelectedItems(prev => [
          ...prev,
          {
            id: prizeId,
            name: `${kuji.name} - ${prize.prize_tier}賞`,
            code: prize.products.item_code,
            barcode: prize.products.barcode!,
            price: prize.products.price,
            copies: 1,
            source: 'prize',
          },
        ])
      }
    })
  }

  // 過濾商品
  const filteredProducts = products.filter(p => {
    if (!p.barcode) return false
    if (!productSearchKeyword) return true
    const keyword = productSearchKeyword.toLowerCase()
    return (
      p.name.toLowerCase().includes(keyword) ||
      p.item_code.toLowerCase().includes(keyword) ||
      p.barcode.toLowerCase().includes(keyword)
    )
  })

  // 過濾一番賞
  const filteredKujis = ichibanKujis.filter(k => {
    if (!kujiSearchKeyword) return true
    const keyword = kujiSearchKeyword.toLowerCase()
    return k.name.toLowerCase().includes(keyword)
  })

  const totalLabels = selectedItems.reduce((sum, item) => sum + item.copies, 0)
  const formatConfig = FORMATS[format]

  return (
    <>
      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 5mm 8mm;
          }

          /* 強制移除所有螢幕版面的干擾 */
          html, body {
            background: #fff !important;
            color: #000 !important;
            height: auto !important;
            min-height: 0 !important;
            max-height: none !important;
            overflow: visible !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          /* 隱藏所有非列印內容 */
          nav, header, footer, aside,
          .no-print {
            display: none !important;
            visibility: hidden !important;
          }

          /* 列印容器 */
          .print-root {
            display: block !important;
            background: #fff !important;
            color: #000 !important;
            height: auto !important;
            min-height: 0 !important;
            max-height: none !important;
            overflow: visible !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          /* 標籤紙 grid - 一排一個，左右置中 */
          .print-area {
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            background: #fff !important;
            width: 100% !important;
            margin: 0 auto !important;
            gap: 2mm !important;
          }

          /* 標籤框體 - 固定寬度，內容置中 */
          .label {
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
            background: #fff !important;
            color: #000 !important;
            border: 1px solid #ccc !important;
            padding: 1.5mm 2mm !important;
            box-sizing: border-box !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            text-align: center !important;
            width: 90mm !important;
          }

          /* 條碼本體置中 */
          .barcode-wrap {
            display: flex !important;
            justify-content: center !important;
            align-items: center !important;
            height: 11mm !important;
            width: 100% !important;
            margin: 0 !important;
            line-height: 0 !important;
          }

          .barcode-wrap img {
            display: block !important;
            height: 11mm !important;
            width: auto !important;
            margin: 0 auto !important;
          }

          /* 商品名稱 */
          .meta-row .name {
            display: block !important;
            font-size: 8pt !important;
            font-weight: 600 !important;
            line-height: 1.2 !important;
            text-align: center !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            max-width: 100% !important;
            margin-top: 1mm !important;
          }

          /* 條碼號 + 價格同一行 */
          .meta-row .code,
          .meta-row .price {
            display: inline !important;
            font-size: 7pt !important;
            font-weight: 400 !important;
            line-height: 1.2 !important;
            text-align: center !important;
          }

          .meta-row .price {
            margin-left: 2mm !important;
            font-weight: 600 !important;
          }

          /* meta-row 容器 */
          .meta-row {
            text-align: center !important;
            width: 100% !important;
          }
        }
      `}</style>

      <div className="print-root">
        <div className="bg-gray-50 dark:bg-gray-900 p-4 no-print">
        <div className="mx-auto max-w-7xl">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">條碼打印</h1>
            <button
              onClick={() => router.back()}
              className="rounded bg-gray-600 px-4 py-2 font-medium text-white hover:bg-gray-700"
            >
              返回
            </button>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Left Panel - Selection */}
            <div className="space-y-6">
              {/* Products */}
              <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">商品</h2>
                  {!loading && filteredProducts.length > 0 && (
                    <button
                      onClick={addAllProducts}
                      className="rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700"
                    >
                      全部新增
                    </button>
                  )}
                </div>

                {/* 搜尋框 */}
                <div className="mb-3">
                  <input
                    type="text"
                    value={productSearchKeyword}
                    onChange={(e) => setProductSearchKeyword(e.target.value)}
                    placeholder="搜尋商品名稱、品號或條碼"
                    className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  />
                </div>

                {loading ? (
                  <div className="text-center text-gray-500">載入中...</div>
                ) : filteredProducts.length === 0 ? (
                  <div className="text-center text-gray-500 py-4">
                    {productSearchKeyword ? '沒有符合的商品' : '沒有有條碼的商品'}
                  </div>
                ) : (
                  <div className="max-h-96 space-y-2 overflow-y-auto">
                    {filteredProducts.map(product => (
                      <div
                        key={product.id}
                        className="flex items-center justify-between rounded border border-gray-200 dark:border-gray-700 p-3 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        <div className="flex-1">
                          <div className="font-medium text-gray-900 dark:text-gray-100">{product.name}</div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {product.item_code} | {product.barcode}
                          </div>
                        </div>
                        <button
                          onClick={() => addProduct(product)}
                          className="ml-4 rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
                        >
                          新增
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Ichiban Kuji */}
              <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
                <h2 className="mb-4 text-xl font-bold text-gray-900 dark:text-gray-100">一番賞系列</h2>

                {/* 搜尋框 */}
                <div className="mb-3">
                  <input
                    type="text"
                    value={kujiSearchKeyword}
                    onChange={(e) => setKujiSearchKeyword(e.target.value)}
                    placeholder="搜尋一番賞名稱"
                    className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  />
                </div>

                {loading ? (
                  <div className="text-center text-gray-500">載入中...</div>
                ) : filteredKujis.length === 0 ? (
                  <div className="text-center text-gray-500 py-4">
                    {kujiSearchKeyword ? '沒有符合的一番賞' : '沒有一番賞'}
                  </div>
                ) : (
                  <div className="max-h-96 space-y-3 overflow-y-auto">
                    {filteredKujis.map(kuji => {
                      // 只顯示有系列條碼的一番賞
                      if (!kuji.barcode) return null

                      return (
                        <div
                          key={kuji.id}
                          className="flex items-center justify-between rounded border border-purple-200 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/20 p-3"
                        >
                          <div className="flex-1">
                            <div className="text-sm font-bold text-purple-900 dark:text-purple-100">
                              📦 {kuji.name}
                            </div>
                            <div className="text-xs text-purple-700 dark:text-purple-300">
                              系列條碼：{kuji.barcode} | {kuji.ichiban_kuji_prizes.length} 個獎項
                            </div>
                          </div>
                          <button
                            onClick={() => addKuji(kuji)}
                            className="ml-4 rounded bg-purple-600 px-3 py-1 text-sm font-medium text-white hover:bg-purple-700"
                          >
                            新增
                          </button>
                        </div>
                      )
                    })}
                    {filteredKujis.filter(k => k.barcode).length === 0 && (
                      <div className="text-center text-gray-500 py-4">
                        沒有設定系列條碼的一番賞
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel - Print List */}
            <div className="space-y-6">
              {/* Format Selection */}
              <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
                <h2 className="mb-4 text-xl font-bold text-gray-900 dark:text-gray-100">打印格式</h2>
                <div className="space-y-2">
                  {Object.entries(FORMATS).map(([key, config]) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center rounded border border-gray-200 dark:border-gray-700 p-3 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      <input
                        type="radio"
                        name="format"
                        value={key}
                        checked={format === key}
                        onChange={e => setFormat(e.target.value as PrintFormat)}
                        className="mr-3"
                      />
                      <div>
                        <div className="font-medium text-gray-900 dark:text-gray-100">{config.name}</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {config.columns} x {config.rows} ({config.width}x{config.height}mm)
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Selected Items */}
              <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                    打印清單 ({totalLabels} 張)
                  </h2>
                  {selectedItems.length > 0 && (
                    <button
                      onClick={() => setSelectedItems([])}
                      className="text-sm text-red-600 hover:text-red-700"
                    >
                      清空
                    </button>
                  )}
                </div>
                <div className="max-h-96 space-y-2 overflow-y-auto">
                  {selectedItems.length === 0 ? (
                    <div className="text-center text-gray-500">請從左側新增商品或獎項</div>
                  ) : (
                    selectedItems.map(item => (
                      <div
                        key={`${item.id}-${item.source}`}
                        className="flex items-center justify-between rounded border border-gray-200 dark:border-gray-700 p-3"
                      >
                        <div className="flex-1">
                          <div className="font-medium text-gray-900 dark:text-gray-100">{item.name}</div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {item.code} | {item.barcode}
                          </div>
                        </div>
                        <div className="ml-4 flex items-center gap-2">
                          <button
                            onClick={() => updateCopies(item.id, item.source, item.copies - 1)}
                            className="rounded bg-gray-200 dark:bg-gray-700 px-2 py-1 text-sm hover:bg-gray-300 dark:hover:bg-gray-600"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="1"
                            value={item.copies}
                            onChange={e => updateCopies(item.id, item.source, parseInt(e.target.value) || 1)}
                            className="w-16 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-center text-sm text-gray-900 dark:text-gray-100"
                          />
                          <button
                            onClick={() => updateCopies(item.id, item.source, item.copies + 1)}
                            className="rounded bg-gray-200 dark:bg-gray-700 px-2 py-1 text-sm hover:bg-gray-300 dark:hover:bg-gray-600"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Print Button */}
              {selectedItems.length > 0 && (
                <button
                  onClick={handlePrint}
                  className="w-full rounded bg-green-600 px-6 py-3 text-lg font-bold text-white hover:bg-green-700"
                >
                  打印條碼標籤
                </button>
              )}
            </div>
          </div>
        </div>
        </div>

        {/* Print Area */}
        <div className="print-area hidden print:grid" ref={printAreaRef}>
          {selectedItems.flatMap(item =>
            Array.from({ length: item.copies }).map((_, idx) => (
              <div key={`${item.id}-${item.source}-${idx}`} className="label">
                <div className="barcode-wrap">
                  <img
                    src={`/api/barcode?text=${encodeURIComponent(item.barcode)}&type=code128&scale=0.7&height=8`}
                    alt={item.barcode}
                  />
                </div>
                <div className="meta-row">
                  <span className="name">{item.name}</span>
                  <span className="code">{item.barcode}</span>
                  <span className="price">{formatCurrency(item.price)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}
