'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'
import NumberInput from '@/components/NumberInput'

type Vendor = {
  vendor_code: string
  vendor_name: string
}

type Product = {
  id: string
  name: string
  item_code: string
  barcode?: string | null
  cost: number
  unit: string
  product_barcodes?: { barcode: string }[]
}

type Prize = {
  prize_tier: string
  product_id: string
  product?: Product | null
  prize_name?: string
  quantity: number
  is_selection: boolean
  selection_products: Product[]
}

type LastPrize = {
  name: string
  product_id: string
  product?: Product | null
}

type ComboPrice = {
  draws: number
  price: number
}

type SetType = 'custom' | 'official'

export default function NewIchibanKujiPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [barcode, setBarcode] = useState('')
  const [price, setPrice] = useState('')
  const [setType, setSetType] = useState<SetType>('custom')
  const [totalCost, setTotalCost] = useState('')
  const [prizes, setPrizes] = useState<Prize[]>([])
  const [comboPrices, setComboPrices] = useState<ComboPrice[]>([])
  const [openingComboPrices, setOpeningComboPrices] = useState<ComboPrice[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [vendorCode, setVendorCode] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [productsLoaded, setProductsLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchInputs, setSearchInputs] = useState<{ [key: number]: string }>({})
  const [searchResults, setSearchResults] = useState<{ [key: number]: Product[] }>({})
  // 最後賞
  const [hasLastPrize, setHasLastPrize] = useState(false)
  const [lastPrize, setLastPrize] = useState<LastPrize>({ name: '', product_id: '', product: null })
  const [lastPrizeSearchInput, setLastPrizeSearchInput] = useState('')
  const [lastPrizeSearchResults, setLastPrizeSearchResults] = useState<Product[]>([])

  const isOfficial = setType === 'official'

  useEffect(() => {
    if (isOfficial) {
      fetchVendors()
    } else {
      fetchProducts()
    }
  }, [isOfficial])

  const fetchProducts = async () => {
    try {
      const res = await fetch('/api/products?active=true&all=true')
      const data = await res.json()
      if (data.ok) {
        setProducts(data.data || [])
      }
    } catch (err) {
      console.error('Failed to fetch products:', err)
    } finally {
      setProductsLoaded(true)
    }
  }

  const fetchVendors = async () => {
    try {
      const res = await fetch('/api/vendors?active=true')
      const data = await res.json()
      if (data.ok) {
        setVendors(data.data || [])
      }
    } catch (err) {
      console.error('Failed to fetch vendors:', err)
    }
  }

  const [selectionSearchInputs, setSelectionSearchInputs] = useState<{ [key: number]: string }>({})
  const [selectionSearchResults, setSelectionSearchResults] = useState<{ [key: number]: Product[] }>({})

  const addPrize = () => {
    setPrizes([...prizes, { prize_tier: '', product_id: '', product: null, prize_name: '', quantity: 1, is_selection: false, selection_products: [] }])
  }

  const removePrize = (index: number) => {
    setPrizes(prizes.filter((_, i) => i !== index))
    // 重新對齊 index：刪除後後面的項目 key 全部 -1
    const newSearchInputs: { [key: number]: string } = {}
    const newSearchResults: { [key: number]: Product[] } = {}
    Object.entries(searchInputs).forEach(([k, v]) => {
      const i = Number(k)
      if (i < index) newSearchInputs[i] = v
      else if (i > index) newSearchInputs[i - 1] = v
    })
    Object.entries(searchResults).forEach(([k, v]) => {
      const i = Number(k)
      if (i < index) newSearchResults[i] = v
      else if (i > index) newSearchResults[i - 1] = v
    })
    setSearchInputs(newSearchInputs)
    setSearchResults(newSearchResults)
  }

  const addComboPrice = () => {
    setComboPrices([...comboPrices, { draws: 3, price: 0 }])
  }

  const removeComboPrice = (index: number) => {
    setComboPrices(comboPrices.filter((_, i) => i !== index))
  }

  const updateComboPrice = (index: number, field: keyof ComboPrice, value: number) => {
    const updated = [...comboPrices]
    updated[index] = { ...updated[index], [field]: value }
    setComboPrices(updated)
  }

  const addOpeningComboPrice = () => {
    setOpeningComboPrices([...openingComboPrices, { draws: 3, price: 0 }])
  }

  const removeOpeningComboPrice = (index: number) => {
    setOpeningComboPrices(openingComboPrices.filter((_, i) => i !== index))
  }

  const updateOpeningComboPrice = (index: number, field: keyof ComboPrice, value: number) => {
    const updated = [...openingComboPrices]
    updated[index] = { ...updated[index], [field]: value }
    setOpeningComboPrices(updated)
  }

  const updatePrize = (index: number, field: keyof Prize, value: string | number) => {
    const updated = [...prizes]
    updated[index] = { ...updated[index], [field]: value }
    setPrizes(updated)
  }

  const searchProduct = (index: number, keyword: string) => {
    setSearchInputs({ ...searchInputs, [index]: keyword })

    if (!keyword.trim()) {
      const newResults = { ...searchResults }
      delete newResults[index]
      setSearchResults(newResults)
      return
    }

    // Search by barcode or name
    const results = products.filter(p =>
      p.barcode?.toLowerCase().includes(keyword.toLowerCase()) ||
      p.product_barcodes?.some(b => b.barcode.toLowerCase().includes(keyword.toLowerCase())) ||
      p.name.toLowerCase().includes(keyword.toLowerCase()) ||
      p.item_code.toLowerCase().includes(keyword.toLowerCase())
    ).slice(0, 20)

    setSearchResults({ ...searchResults, [index]: results })
  }

  const selectProduct = (index: number, product: Product) => {
    const updated = [...prizes]
    updated[index] = {
      ...updated[index],
      product_id: product.id,
      product: product
    }
    setPrizes(updated)

    // Clear search UI
    const newInputs = { ...searchInputs }
    const newResults = { ...searchResults }
    newInputs[index] = product.name
    delete newResults[index]
    setSearchInputs(newInputs)
    setSearchResults(newResults)
  }

  const clearSearch = (index: number) => {
    // Clear search results when input loses focus
    setTimeout(() => {
      const newResults = { ...searchResults }
      delete newResults[index]
      setSearchResults(newResults)
    }, 200)
  }

  // 複選獎功能
  const toggleSelection = (index: number) => {
    const updated = [...prizes]
    updated[index] = {
      ...updated[index],
      is_selection: !updated[index].is_selection,
      // 切換時清空對應資料
      product_id: !updated[index].is_selection ? '' : updated[index].product_id,
      product: !updated[index].is_selection ? null : updated[index].product,
      selection_products: !updated[index].is_selection ? updated[index].selection_products : [],
    }
    setPrizes(updated)
    // 清空搜尋狀態
    if (!updated[index].is_selection) {
      const newInputs = { ...searchInputs }
      delete newInputs[index]
      setSearchInputs(newInputs)
    }
  }

  const searchSelectionProduct = (index: number, keyword: string) => {
    setSelectionSearchInputs({ ...selectionSearchInputs, [index]: keyword })

    if (!keyword.trim()) {
      const newResults = { ...selectionSearchResults }
      delete newResults[index]
      setSelectionSearchResults(newResults)
      return
    }

    const alreadySelected = new Set(prizes[index].selection_products.map(p => p.id))
    const results = products.filter(p =>
      !alreadySelected.has(p.id) && (
        p.barcode?.toLowerCase().includes(keyword.toLowerCase()) ||
        p.product_barcodes?.some(b => b.barcode.toLowerCase().includes(keyword.toLowerCase())) ||
        p.name.toLowerCase().includes(keyword.toLowerCase()) ||
        p.item_code.toLowerCase().includes(keyword.toLowerCase())
      )
    ).slice(0, 20)

    setSelectionSearchResults({ ...selectionSearchResults, [index]: results })
  }

  const addSelectionProduct = (index: number, product: Product) => {
    const updated = [...prizes]
    updated[index] = {
      ...updated[index],
      selection_products: [...updated[index].selection_products, product],
    }
    setPrizes(updated)
    setSelectionSearchInputs({ ...selectionSearchInputs, [index]: '' })
    const newResults = { ...selectionSearchResults }
    delete newResults[index]
    setSelectionSearchResults(newResults)
  }

  const removeSelectionProduct = (prizeIndex: number, productId: string) => {
    const updated = [...prizes]
    updated[prizeIndex] = {
      ...updated[prizeIndex],
      selection_products: updated[prizeIndex].selection_products.filter(p => p.id !== productId),
    }
    setPrizes(updated)
  }

  const clearSelectionSearch = (index: number) => {
    setTimeout(() => {
      const newResults = { ...selectionSearchResults }
      delete newResults[index]
      setSelectionSearchResults(newResults)
    }, 200)
  }

  // 最後賞搜尋
  const searchLastPrizeProduct = (keyword: string) => {
    setLastPrizeSearchInput(keyword)

    if (!keyword.trim()) {
      setLastPrizeSearchResults([])
      return
    }

    const results = products.filter(p =>
      p.barcode?.toLowerCase().includes(keyword.toLowerCase()) ||
      p.product_barcodes?.some(b => b.barcode.toLowerCase().includes(keyword.toLowerCase())) ||
      p.name.toLowerCase().includes(keyword.toLowerCase()) ||
      p.item_code.toLowerCase().includes(keyword.toLowerCase())
    ).slice(0, 20)

    setLastPrizeSearchResults(results)
  }

  const selectLastPrizeProduct = (product: Product) => {
    setLastPrize({
      ...lastPrize,
      product_id: product.id,
      product: product
    })
    setLastPrizeSearchInput(product.name)
    setLastPrizeSearchResults([])
  }

  const clearLastPrizeSearch = () => {
    setTimeout(() => {
      setLastPrizeSearchResults([])
    }, 200)
  }

  const calculateStats = () => {
    let totalDraws = 0
    let computedTotalCost = 0
    let lastPrizeCostValue = 0

    if (isOfficial) {
      totalDraws = prizes.reduce((sum, p) => sum + p.quantity, 0)
      computedTotalCost = parseFloat(totalCost) || 0
      // 官方套的最後賞成本已包含在 totalCost 中
    } else {
      prizes.forEach(prize => {
        if (prize.is_selection && prize.selection_products.length > 0) {
          // 複選獎：平均成本 × 數量
          const avgOptionCost = prize.selection_products.reduce((sum, p) => sum + p.cost, 0) / prize.selection_products.length
          totalDraws += prize.quantity
          computedTotalCost += avgOptionCost * prize.quantity
        } else if (prize.product) {
          totalDraws += prize.quantity
          computedTotalCost += prize.product.cost * prize.quantity
        }
      })
      // 加入最後賞成本（不計入抽數）
      if (hasLastPrize && lastPrize.product) {
        lastPrizeCostValue = lastPrize.product.cost
        computedTotalCost += lastPrizeCostValue
      }
    }

    const avgCost = totalDraws > 0 ? computedTotalCost / totalDraws : 0

    return { totalDraws, totalCost: computedTotalCost, avgCost, lastPrizeCost: lastPrizeCostValue }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!name.trim()) {
      setError('請輸入一番賞名稱')
      return
    }

    const priceNum = parseFloat(price)
    if (!price || isNaN(priceNum) || priceNum <= 0) {
      setError('請輸入正確的每抽售價')
      return
    }

    if (isOfficial) {
      const costNum = parseFloat(totalCost)
      if (!totalCost || isNaN(costNum) || costNum < 0) {
        setError('請輸入正確的整套成本')
        return
      }
      if (!vendorCode) {
        setError('官方套必須選擇廠商')
        return
      }
    }

    if (prizes.length === 0) {
      setError('請至少新增一個賞項')
      return
    }

    // Validate all prizes
    for (let i = 0; i < prizes.length; i++) {
      const prize = prizes[i]
      if (!prize.prize_tier.trim()) {
        setError(`第 ${i + 1} 個賞項：請輸入賞別名稱`)
        return
      }
      if (!isOfficial && !prize.is_selection && !prize.product_id) {
        setError(`第 ${i + 1} 個賞項：請選擇商品`)
        return
      }
      if (!isOfficial && prize.is_selection && prize.selection_products.length === 0) {
        setError(`第 ${i + 1} 個賞項：複選獎至少需要一個選項`)
        return
      }
      if (!isOfficial && prize.is_selection && prize.selection_products.length < prize.quantity) {
        setError(`第 ${i + 1} 個賞項：選項數量 (${prize.selection_products.length}) 必須 >= 賞項數量 (${prize.quantity})`)
        return
      }
      if (prize.quantity <= 0) {
        setError(`第 ${i + 1} 個賞項：數量必須大於 0`)
        return
      }
    }

    // 驗證最後賞
    if (hasLastPrize) {
      if (isOfficial && !lastPrize.name.trim()) {
        setError('請輸入最後賞名稱')
        return
      }
      if (!isOfficial && !lastPrize.product_id) {
        setError('請選擇最後賞商品')
        return
      }
    }

    setLoading(true)

    try {
      const res = await fetch('/api/ichiban-kuji', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          barcode: barcode.trim() || null,
          price: parseFloat(price),
          set_type: setType,
          total_cost: isOfficial ? parseFloat(totalCost) || 0 : 0,
          vendor_code: isOfficial ? vendorCode : null,
          prizes: prizes.map(p => ({
            prize_tier: p.prize_tier,
            prize_name: p.prize_name || null,
            product_id: isOfficial ? null : (p.is_selection ? null : p.product_id),
            quantity: p.quantity,
            selection_product_ids: !isOfficial && p.is_selection ? p.selection_products.map(sp => sp.id) : null,
          })),
          combo_prices: comboPrices,
          opening_combo_prices: openingComboPrices,
          // 最後賞
          last_prize_name: hasLastPrize ? (isOfficial ? lastPrize.name : lastPrize.product?.name) : null,
          last_prize_product_id: hasLastPrize && !isOfficial ? lastPrize.product_id : null,
        })
      })

      const data = await res.json()

      if (data.ok) {
        alert('一番賞建立成功！')
        router.push('/ichiban-kuji')
      } else {
        setError(data.error || '建立失敗')
      }
    } catch (err) {
      setError('建立失敗')
    } finally {
      setLoading(false)
    }
  }

  const handleSetTypeChange = (newType: SetType) => {
    setSetType(newType)
    // Reset prizes when switching type
    setPrizes([])
    setSearchInputs({})
    setSearchResults({})
    setSelectionSearchInputs({})
    setSelectionSearchResults({})
    setTotalCost('')
    setVendorCode('')
    setOpeningComboPrices([])
    // Reset last prize
    setHasLastPrize(false)
    setLastPrize({ name: '', product_id: '', product: null })
    setLastPrizeSearchInput('')
    setLastPrizeSearchResults([])
  }

  const stats = calculateStats()

  return (
    <div className="min-h-screen bg-gray-50 p-4 dark:bg-gray-900">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">新增一番賞</h1>
          <button
            onClick={() => router.push('/ichiban-kuji')}
            className="rounded bg-gray-500 px-4 py-2 font-medium text-white hover:bg-gray-600"
          >
            返回列表
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-4 text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="rounded-lg bg-white p-4 shadow dark:bg-gray-800 md:p-6">
            <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">基本資訊</h2>

            {/* Set Type Toggle */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100">
                套組類型
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleSetTypeChange('custom')}
                  className={`rounded px-4 py-2 text-sm font-medium transition-colors ${setType === 'custom'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                    }`}
                >
                  自製套
                </button>
                <button
                  type="button"
                  onClick={() => handleSetTypeChange('official')}
                  className={`rounded px-4 py-2 text-sm font-medium transition-colors ${setType === 'official'
                      ? 'bg-orange-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                    }`}
                >
                  官方套
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {isOfficial
                  ? '官方套：賞項只需輸入名稱和數量，成本為整套總成本'
                  : '自製套：每個賞項連結到商品，成本從各商品成本計算'}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100">
                  一番賞名稱 *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  placeholder="例：鬼滅之刃一番賞"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100">
                  系列條碼（選填）
                </label>
                <input
                  type="text"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  placeholder="掃碼或手動輸入"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100">
                  每抽售價 *
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  placeholder="例：100"
                />
              </div>
            </div>

            {/* Total Cost & Vendor for Official Sets */}
            {isOfficial && (
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100">
                    整套成本 *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={totalCost}
                    onChange={(e) => setTotalCost(e.target.value)}
                    className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    placeholder="例：5000"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100">
                    廠商 *
                  </label>
                  <select
                    value={vendorCode}
                    onChange={(e) => setVendorCode(e.target.value)}
                    className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  >
                    <option value="">-- 選擇廠商 --</option>
                    {vendors.map((v) => (
                      <option key={v.vendor_code} value={v.vendor_code}>
                        {v.vendor_name} ({v.vendor_code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs text-orange-600 dark:text-orange-400">
                    建立後一番賞預設為未啟用狀態，確認內容無誤再啟用
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Combo Prices */}
          <div className="rounded-lg bg-white p-4 shadow dark:bg-gray-800 md:p-6">
            <div className="mb-4 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">組合價設定（選填）</h2>
              <button
                type="button"
                onClick={addComboPrice}
                className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
              >
                + 新增組合價
              </button>
            </div>

            {comboPrices.length === 0 ? (
              <div className="rounded border-2 border-dashed border-gray-300 p-4 text-center text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">
                可選擇性新增組合價優惠，例如：3抽280元、5抽450元
              </div>
            ) : (
              <div className="space-y-3">
                {comboPrices.map((combo, index) => (
                  <div key={index} className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                    <div className="flex w-full flex-1 flex-wrap items-center gap-2">
                      <NumberInput
                        min="1"
                        decimal={false}
                        value={combo.draws}
                        onChange={(v) => updateComboPrice(index, 'draws', v)}
                        emptyValue={1}
                        className="w-24 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                        placeholder="抽數"
                      />
                      <span className="text-gray-600 dark:text-gray-400">抽</span>
                      <NumberInput
                        min="0"
                        step="1"
                        value={combo.price}
                        onChange={(v) => updateComboPrice(index, 'price', v)}
                        emptyValue={0}
                        className="w-32 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                        placeholder="價格"
                      />
                      <span className="text-gray-600 dark:text-gray-400">元</span>
                      {combo.draws > 0 && combo.price > 0 && (
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          (平均每抽 {formatCurrency(combo.price / combo.draws)})
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeComboPrice(index)}
                      className="px-2 text-lg font-bold text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-500"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Opening Combo Prices */}
          <div className="rounded-lg bg-white p-4 shadow dark:bg-gray-800 md:p-6">
            <div className="mb-4 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">開套優惠（選填）</h2>
              <button
                type="button"
                onClick={addOpeningComboPrice}
                className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
              >
                + 新增開套優惠
              </button>
            </div>

            {openingComboPrices.length === 0 ? (
              <div className="rounded border-2 border-dashed border-gray-300 p-4 text-center text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">
                僅在整套完全未抽過時適用，例如：開套 3抽280元
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-amber-600 dark:text-amber-400">僅在整套完全未抽過時適用</p>
                {openingComboPrices.map((combo, index) => (
                  <div key={index} className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                    <div className="flex w-full flex-1 flex-wrap items-center gap-2">
                      <NumberInput
                        min="1"
                        decimal={false}
                        value={combo.draws}
                        onChange={(v) => updateOpeningComboPrice(index, 'draws', v)}
                        emptyValue={1}
                        className="w-24 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                        placeholder="抽數"
                      />
                      <span className="text-gray-600 dark:text-gray-400">抽</span>
                      <NumberInput
                        min="0"
                        step="1"
                        value={combo.price}
                        onChange={(v) => updateOpeningComboPrice(index, 'price', v)}
                        emptyValue={0}
                        className="w-32 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                        placeholder="價格"
                      />
                      <span className="text-gray-600 dark:text-gray-400">元</span>
                      {combo.draws > 0 && combo.price > 0 && (
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          (平均每抽 {formatCurrency(combo.price / combo.draws)})
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeOpeningComboPrice(index)}
                      className="px-2 text-lg font-bold text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-500"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Prizes */}
          <div className="overflow-visible rounded-lg bg-white p-4 shadow dark:bg-gray-800 md:p-6">
            <div className="mb-4 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">賞項設定</h2>
              <button
                type="button"
                onClick={addPrize}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                + 新增賞項
              </button>
            </div>

            {prizes.length === 0 ? (
              <div className="rounded border-2 border-dashed border-gray-300 p-8 text-center text-gray-500 dark:border-gray-600 dark:text-gray-400">
                尚未新增任何賞項，點擊上方按鈕新增
              </div>
            ) : isOfficial ? (
              /* Official Set: prize_tier, prize_name, and quantity */
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b dark:border-gray-700">
                    <tr>
                      <th className="pb-2 text-left text-sm font-semibold text-gray-900 dark:text-gray-100 w-24">賞別 *</th>
                      <th className="pb-2 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">商品名稱</th>
                      <th className="pb-2 text-left text-sm font-semibold text-gray-900 dark:text-gray-100 w-28">數量 *</th>
                      <th className="pb-2 text-center text-sm font-semibold text-gray-900 dark:text-gray-100 w-20">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-gray-700">
                    {prizes.map((prize, index) => (
                      <tr key={index}>
                        <td className="py-2 pr-2">
                          <input
                            type="text"
                            value={prize.prize_tier}
                            onChange={(e) => updatePrize(index, 'prize_tier', e.target.value)}
                            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                            placeholder="A賞"
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <input
                            type="text"
                            value={prize.prize_name || ''}
                            onChange={(e) => updatePrize(index, 'prize_name', e.target.value)}
                            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                            placeholder="例：角色公仔"
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <NumberInput
                            min="1"
                            decimal={false}
                            value={prize.quantity}
                            onChange={(v) => updatePrize(index, 'quantity', v)}
                            emptyValue={1}
                            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                          />
                        </td>
                        <td className="py-2 text-center">
                          <button
                            type="button"
                            onClick={() => removePrize(index)}
                            className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-500"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              /* Custom Set: Full table with product search + selection prize support */
              <div className="overflow-visible space-y-3">
                {prizes.map((prize, index) => (
                  <div key={index} className={`rounded-lg border p-3 ${prize.is_selection ? 'border-violet-300 bg-violet-50/50 dark:border-violet-600 dark:bg-violet-900/20' : 'border-gray-200 dark:border-gray-700'}`}>
                    <div className="flex items-center gap-3 mb-2">
                      {/* 賞別 */}
                      <input
                        type="text"
                        value={prize.prize_tier}
                        onChange={(e) => updatePrize(index, 'prize_tier', e.target.value)}
                        className="w-24 rounded border border-gray-300 bg-white px-2 py-1 text-sm font-semibold text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                        placeholder="A賞"
                      />
                      {/* 複選 toggle */}
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={prize.is_selection}
                          onChange={() => toggleSelection(index)}
                          className="h-3.5 w-3.5 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                        />
                        <span className="text-xs text-violet-700 dark:text-violet-400 font-medium">複選</span>
                      </label>
                      {/* 數量 */}
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-500 dark:text-gray-400">數量</span>
                        <NumberInput
                          min="1"
                          decimal={false}
                          value={prize.quantity}
                          onChange={(v) => updatePrize(index, 'quantity', v)}
                          emptyValue={1}
                          className="w-20 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                        />
                      </div>
                      {/* 成本顯示 */}
                      <div className="ml-auto flex items-center gap-3 text-sm text-gray-900 dark:text-gray-100">
                        {prize.is_selection ? (
                          prize.selection_products.length > 0 ? (
                            <>
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                平均成本 {formatCurrency(prize.selection_products.reduce((s, p) => s + p.cost, 0) / prize.selection_products.length)}
                              </span>
                              <span className="font-semibold">
                                小計 {formatCurrency(prize.selection_products.reduce((s, p) => s + p.cost, 0) / prize.selection_products.length * prize.quantity)}
                              </span>
                            </>
                          ) : <span className="text-gray-400">-</span>
                        ) : (
                          prize.product ? (
                            <>
                              <span className="text-xs text-gray-500 dark:text-gray-400">成本 {formatCurrency(prize.product.cost)}</span>
                              <span className="font-semibold">小計 {formatCurrency(prize.product.cost * prize.quantity)}</span>
                            </>
                          ) : <span className="text-gray-400">-</span>
                        )}
                      </div>
                      {/* 刪除 */}
                      <button
                        type="button"
                        onClick={() => removePrize(index)}
                        className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-500 text-lg font-bold"
                      >
                        ✕
                      </button>
                    </div>

                    {/* 單品搜尋（非複選模式） */}
                    {!prize.is_selection && (
                      <div className="relative">
                        <input
                          type="text"
                          value={searchInputs[index] || ''}
                          onChange={(e) => searchProduct(index, e.target.value)}
                          onBlur={() => clearSearch(index)}
                          disabled={!productsLoaded}
                          className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                          placeholder={productsLoaded ? "掃碼或搜尋商品名稱/品號" : "商品載入中..."}
                          autoComplete="off"
                        />
                        {searchResults[index] && searchResults[index].length > 0 && (
                          <div className="absolute z-[9999] mt-1 w-full min-w-[300px] max-h-64 overflow-y-auto rounded-md border border-gray-300 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-700">
                            {searchResults[index].map(product => (
                              <div
                                key={product.id}
                                onMouseDown={(e) => {
                                  e.preventDefault()
                                  selectProduct(index, product)
                                }}
                                className="cursor-pointer border-b px-3 py-2 last:border-b-0 hover:bg-blue-50 dark:border-gray-600 dark:hover:bg-gray-600"
                              >
                                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{product.name}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                  {product.item_code} | 成本: {formatCurrency(product.cost)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {searchResults[index] && searchResults[index].length === 0 && (
                          <div className="absolute z-[9999] mt-1 w-full min-w-[300px] rounded-md border border-gray-300 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-700">
                            <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                              找不到商品
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 複選模式 */}
                    {prize.is_selection && (
                      <div className="space-y-2">
                        {/* 已選商品列表 */}
                        {prize.selection_products.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {prize.selection_products.map(sp => (
                              <span
                                key={sp.id}
                                className="inline-flex items-center gap-1 rounded-full bg-violet-100 dark:bg-violet-900/40 px-2.5 py-1 text-xs text-violet-800 dark:text-violet-300"
                              >
                                {sp.name}
                                <span className="text-violet-500 dark:text-violet-400">({formatCurrency(sp.cost)})</span>
                                <button
                                  type="button"
                                  onClick={() => removeSelectionProduct(index, sp.id)}
                                  className="ml-0.5 text-violet-600 hover:text-red-600 dark:text-violet-400 dark:hover:text-red-400 font-bold"
                                >
                                  ✕
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        {/* 搜尋新增商品 */}
                        <div className="relative">
                          <input
                            type="text"
                            value={selectionSearchInputs[index] || ''}
                            onChange={(e) => searchSelectionProduct(index, e.target.value)}
                            onBlur={() => clearSelectionSearch(index)}
                            disabled={!productsLoaded}
                            className="w-full rounded border border-violet-300 bg-white px-2 py-1 text-sm text-gray-900 disabled:bg-gray-100 disabled:text-gray-400 dark:border-violet-600 dark:bg-gray-700 dark:text-gray-100 dark:disabled:bg-gray-600"
                            placeholder={productsLoaded ? "搜尋商品加入選項..." : "商品載入中..."}
                            autoComplete="off"
                          />
                          {selectionSearchResults[index] && selectionSearchResults[index].length > 0 && (
                            <div className="absolute z-[9999] mt-1 w-full min-w-[300px] max-h-64 overflow-y-auto rounded-md border border-gray-300 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-700">
                              {selectionSearchResults[index].map(product => (
                                <div
                                  key={product.id}
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    addSelectionProduct(index, product)
                                  }}
                                  className="cursor-pointer border-b px-3 py-2 last:border-b-0 hover:bg-violet-50 dark:border-gray-600 dark:hover:bg-gray-600"
                                >
                                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{product.name}</div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400">
                                    {product.item_code} | 成本: {formatCurrency(product.cost)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {selectionSearchResults[index] && selectionSearchResults[index].length === 0 && (
                            <div className="absolute z-[9999] mt-1 w-full min-w-[300px] rounded-md border border-gray-300 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-700">
                              <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">找不到商品</div>
                            </div>
                          )}
                        </div>
                        {/* 驗證提示 */}
                        {prize.selection_products.length > 0 && prize.selection_products.length < prize.quantity && (
                          <p className="text-xs text-red-500 dark:text-red-400">
                            選項數量 ({prize.selection_products.length}) 必須 &gt;= 賞項數量 ({prize.quantity})
                          </p>
                        )}
                        <p className="text-xs text-violet-600 dark:text-violet-400">
                          {prize.selection_products.length} 個選項，抽到時從中選 1
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 最後賞 */}
          <div className="rounded-lg bg-white p-4 shadow dark:bg-gray-800 md:p-6">
            <div className="mb-4 flex items-center gap-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">最後賞（選填）</h2>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasLastPrize}
                  onChange={(e) => setHasLastPrize(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-pink-600 focus:ring-pink-500"
                />
                <span className="text-sm text-gray-600 dark:text-gray-400">啟用最後賞</span>
              </label>
            </div>

            {!hasLastPrize ? (
              <div className="rounded border-2 border-dashed border-gray-300 p-4 text-center text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">
                最後賞是抽完最後一抽時額外送出的獎品，不計入抽數但會計入成本
              </div>
            ) : isOfficial ? (
              /* 官方套：只需輸入名稱 */
              <div className="flex items-center gap-4">
                <label className="text-sm font-medium text-gray-900 dark:text-gray-100">最後賞名稱</label>
                <input
                  type="text"
                  value={lastPrize.name}
                  onChange={(e) => setLastPrize({ ...lastPrize, name: e.target.value })}
                  className="flex-1 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  placeholder="例：最後賞特大公仔"
                />
              </div>
            ) : (
              /* 自製套：搜尋選擇商品 */
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                <label className="text-sm font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">最後賞商品</label>
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={lastPrizeSearchInput}
                    onChange={(e) => searchLastPrizeProduct(e.target.value)}
                    onBlur={clearLastPrizeSearch}
                    className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    placeholder="掃碼或搜尋商品名稱/品號"
                    autoComplete="off"
                  />
                  {lastPrizeSearchResults.length > 0 && (
                    <div className="absolute z-[9999] mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-gray-300 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-700">
                      {lastPrizeSearchResults.map(product => (
                        <div
                          key={product.id}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            selectLastPrizeProduct(product)
                          }}
                          className="cursor-pointer border-b px-3 py-2 last:border-b-0 hover:bg-blue-50 dark:border-gray-600 dark:hover:bg-gray-600"
                        >
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{product.name}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {product.item_code} | 成本: {formatCurrency(product.cost)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {lastPrize.product && (
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    成本: <span className="font-semibold text-pink-600 dark:text-pink-400">{formatCurrency(lastPrize.product.cost)}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Summary */}
          {prizes.length > 0 && (
            <div className="rounded-lg bg-blue-50 p-4 shadow dark:bg-blue-950/30 md:p-6">
              <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">統計資訊</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-5">
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">總抽數</div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.totalDraws}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">總成本</div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {formatCurrency(stats.totalCost)}
                  </div>
                  {!isOfficial && hasLastPrize && lastPrize.product && (
                    <div className="text-xs text-pink-600 dark:text-pink-400">
                      (含最後賞 {formatCurrency(stats.lastPrizeCost)})
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">平均每抽成本</div>
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {formatCurrency(stats.avgCost)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">每抽售價</div>
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {price ? formatCurrency(parseFloat(price)) : '-'}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">每抽利潤</div>
                  <div className={`text-2xl font-bold ${price && parseFloat(price) > stats.avgCost ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                    }`}>
                    {price ? formatCurrency(parseFloat(price) - stats.avgCost) : '-'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-4 sm:flex-row">
            <button
              type="button"
              onClick={() => router.push('/ichiban-kuji')}
              className="flex-1 rounded border border-gray-300 px-4 py-2 text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-700 disabled:bg-gray-400 dark:disabled:bg-gray-600"
            >
              {loading ? '建立中...' : '建立一番賞'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
