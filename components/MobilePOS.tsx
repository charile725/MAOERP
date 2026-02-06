'use client'

import { useState, useRef, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { formatCurrency } from '@/lib/utils'
import type { Product, PaymentMethod } from '@/types'

const CameraScanner = dynamic(() => import('@/components/CameraScanner'), {
    ssr: false,
    loading: () => null,
})

type CartItem = {
    product_id: string
    quantity: number
    price: number
    product: Product
    ichiban_kuji_prize_id?: string
    ichiban_kuji_id?: string
    isFreeGift?: boolean
    isNotDelivered?: boolean
}

type Customer = {
    id: string
    customer_code: string
    customer_name: string
    phone: string | null
    is_active: boolean
    store_credit: number
    credit_limit: number
}

type PaymentAccount = {
    id: string
    account_name: string
    account_type: 'cash' | 'bank' | 'petty_cash'
    payment_method_code: string | null
    display_name: string | null
    sort_order: number
    auto_mark_paid: boolean
    balance: number
    is_active: boolean
}

type SaleDraft = {
    id: string
    customer_code: string | null
    payment_method: PaymentMethod
    is_paid: boolean
    note: string | null
    discount_type: 'none' | 'percent' | 'amount'
    discount_value: number
    items: CartItem[]
    created_at: string
    customers?: { customer_name: string }
}

type ClosingStats = {
    sales_count: number
    total_sales: number
    store_credit_converted: number
    store_credit_count: number
    fake_total_sales: number
    paid_sales: number
    paid_count: number
    unpaid_sales: number
    unpaid_count: number
    paid_cash: number
    paid_card: number
    paid_transfer: number
    paid_cod: number
}

type MobilePOSProps = {
    cart: CartItem[]
    setCart: (cart: CartItem[] | ((prev: CartItem[]) => CartItem[])) => void
    products: Product[]
    customers: Customer[]
    paymentAccounts: PaymentAccount[]
    selectedCustomer: Customer | null
    setSelectedCustomer: (c: Customer | null) => void
    paymentMethod: PaymentMethod
    setPaymentMethod: (p: PaymentMethod) => void
    isPaid: boolean
    setIsPaid: (b: boolean) => void
    loading: boolean
    error: string
    finalTotal: number
    discountAmount: number
    storeCreditUsed: number
    handleCheckout: () => void
    addToCart: (product: Product, quantity?: number) => void
    removeFromCart: (productId: string, index?: number) => void
    updateQuantity: (index: number, quantity: number) => void
    toggleFreeGift: (index: number) => void
    toggleNotDelivered: (index: number) => void
    searchQuery: string
    setSearchQuery: (q: string) => void
    // 備註
    note: string
    setNote: (note: string) => void
    // 暫存功能
    drafts: SaleDraft[]
    handleSaveDraft: () => void
    handleLoadDraft: (draft: SaleDraft) => void
    handleDeleteDraft: (draftId: string) => void
    // 日結功能
    businessDate: string
    alreadyClosed: boolean
    closingStats: ClosingStats | null
    fetchClosingStats: () => Promise<void>
    handleClosing: () => Promise<void>
    setBusinessDate: (date: string) => Promise<void>
    // 新增客戶功能
    fetchCustomers: () => void
    // 刷新商品
    fetchProducts: () => void
}

export default function MobilePOS({
    cart,
    setCart,
    products,
    customers,
    paymentAccounts,
    selectedCustomer,
    setSelectedCustomer,
    paymentMethod,
    setPaymentMethod,
    isPaid,
    setIsPaid,
    loading,
    error,
    finalTotal,
    discountAmount,
    storeCreditUsed,
    handleCheckout,
    addToCart,
    removeFromCart,
    updateQuantity,
    toggleFreeGift,
    toggleNotDelivered,
    searchQuery,
    setSearchQuery,
    note,
    setNote,
    drafts,
    handleSaveDraft,
    handleLoadDraft,
    handleDeleteDraft,
    // 日結功能
    businessDate,
    alreadyClosed,
    closingStats,
    fetchClosingStats,
    handleClosing,
    setBusinessDate,
    fetchCustomers,
    fetchProducts,
}: MobilePOSProps) {
    const [showCameraScanner, setShowCameraScanner] = useState(false)
    const [showCustomerPicker, setShowCustomerPicker] = useState(false)
    const [showPaymentPicker, setShowPaymentPicker] = useState(false)
    const [showDraftsPicker, setShowDraftsPicker] = useState(false)
    const [showClosingModal, setShowClosingModal] = useState(false)
    const [closingInProgress, setClosingInProgress] = useState(false)
    const [customerSearchQuery, setCustomerSearchQuery] = useState('')
    const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    // 快速新增客戶
    const [showQuickAddCustomer, setShowQuickAddCustomer] = useState(false)
    const [newCustomerName, setNewCustomerName] = useState('')
    const [newCustomerPhone, setNewCustomerPhone] = useState('')
    const [addingCustomer, setAddingCustomer] = useState(false)

    // 快速新增商品
    const [showQuickAddProduct, setShowQuickAddProduct] = useState(false)
    const [quickProductName, setQuickProductName] = useState('')
    const [quickProductBarcode, setQuickProductBarcode] = useState('')
    const [quickProductPrice, setQuickProductPrice] = useState('')
    const [addingProduct, setAddingProduct] = useState(false)
    const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)

    // 搜尋結果 - 不限制數量，讓使用者可以捲動查看所有結果
    const searchResults = searchQuery.trim()
        ? products.filter(p =>
            p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.item_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.barcode?.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : []

    // 處理掃描或搜尋
    const handleSearchInput = (value: string) => {
        setSearchQuery(value)

        if (scanTimeoutRef.current) {
            clearTimeout(scanTimeoutRef.current)
        }

        scanTimeoutRef.current = setTimeout(() => {
            if (value.trim()) {
                const matchedProduct = products.find(
                    p => p.barcode && p.barcode.toLowerCase() === value.toLowerCase()
                )
                if (matchedProduct) {
                    addToCart(matchedProduct, 1)
                    setSearchQuery('')
                }
            }
        }, 100)
    }

    // 掃描提示訊息
    const [scanToast, setScanToast] = useState<{ type: 'success' | 'error', text: string } | null>(null)

    // 清除掃描提示
    useEffect(() => {
        if (scanToast) {
            const timer = setTimeout(() => setScanToast(null), 2000)
            return () => clearTimeout(timer)
        }
    }, [scanToast])

    // 相機掃描結果
    const handleCameraScan = (code: string) => {
        const matchedProduct = products.find(
            p => p.barcode && p.barcode.toLowerCase() === code.toLowerCase()
        )
        if (matchedProduct) {
            addToCart(matchedProduct, 1)
            setSearchQuery('') // 清空搜尋框
            setShowCameraScanner(false) // 掃描成功後自動關閉
        } else {
            setSearchQuery(code)
            setShowCameraScanner(false) // 找不到也關閉，讓用戶手動搜尋
        }
    }

    const filteredCustomers = customers.filter(c =>
        c.customer_name.toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
        c.customer_code.toLowerCase().includes(customerSearchQuery.toLowerCase())
    )

    // 快速新增客戶
    const handleQuickAddCustomer = async () => {
        if (!newCustomerName.trim()) {
            alert('請輸入客戶名稱')
            return
        }

        if (!newCustomerPhone.trim()) {
            alert('請輸入客戶電話')
            return
        }

        setAddingCustomer(true)

        try {
            const res = await fetch('/api/customers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customer_name: newCustomerName.trim(),
                    phone: newCustomerPhone.trim(),
                }),
            })

            const data = await res.json()

            if (data.ok) {
                const newCustomer: Customer = {
                    id: data.data.id,
                    customer_code: data.data.customer_code,
                    customer_name: data.data.customer_name,
                    phone: data.data.phone,
                    is_active: true,
                    store_credit: 0,
                    credit_limit: 0,
                }

                setSelectedCustomer(newCustomer)
                fetchCustomers()

                setNewCustomerName('')
                setNewCustomerPhone('')
                setShowQuickAddCustomer(false)
                setShowCustomerPicker(false)

                alert(`客戶 ${data.data.customer_name} 已建立並自動選擇`)
            } else {
                alert(`建立失敗：${data.error}`)
            }
        } catch (err) {
            alert('建立失敗')
        } finally {
            setAddingCustomer(false)
        }
    }

    // 檢查商品名稱是否重複
    const checkDuplicateProductName = async (name: string): Promise<string | null> => {
        try {
            const res = await fetch(`/api/products?search=${encodeURIComponent(name)}&limit=5`)
            const data = await res.json()
            if (data.ok && data.data.length > 0) {
                const exactMatch = data.data.find((p: Product) => p.name === name)
                if (exactMatch) {
                    return `已存在相同名稱的商品「${exactMatch.name}」(編號: ${exactMatch.item_code})`
                }
                const similarProducts = data.data.slice(0, 3)
                if (similarProducts.length > 0) {
                    return `找到類似商品: ${similarProducts.map((p: Product) => p.name).join('、')}`
                }
            }
        } catch (e) {
            console.error('檢查重複商品名稱失敗', e)
        }
        return null
    }

    // 快速新增商品
    const handleQuickAddProduct = async () => {
        if (!quickProductName.trim()) {
            alert('請輸入商品名稱')
            return
        }

        // 檢查是否有重複名稱
        const duplicate = await checkDuplicateProductName(quickProductName.trim())
        if (duplicate && !duplicateWarning) {
            setDuplicateWarning(duplicate)
            return
        }

        setAddingProduct(true)

        try {
            const res = await fetch('/api/products/quick', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: quickProductName.trim(),
                    barcode: quickProductBarcode.trim() || undefined,
                    price: quickProductPrice.trim() ? parseInt(quickProductPrice.trim()) : undefined,
                }),
            })

            const data = await res.json()

            if (data.ok) {
                const newProduct: Product = data.product
                addToCart(newProduct)
                fetchProducts()

                setQuickProductName('')
                setQuickProductBarcode('')
                setQuickProductPrice('')
                setShowQuickAddProduct(false)
                setDuplicateWarning(null)
                setSearchQuery('')

                alert(`商品「${newProduct.name}」已建立並加入購物車`)
            } else {
                alert(`建立失敗：${data.error}`)
            }
        } catch (err) {
            alert('建立失敗')
        } finally {
            setAddingProduct(false)
        }
    }

    // 開啟快速新增商品 Modal
    const openQuickAddProduct = (prefillBarcode?: string) => {
        setQuickProductName('')
        setQuickProductBarcode(prefillBarcode || searchQuery || '')
        setQuickProductPrice('')
        setDuplicateWarning(null)
        setShowQuickAddProduct(true)
        setSearchQuery('')
    }

    // 從帳戶動態生成付款方式選項
    const paymentMethods = paymentAccounts.map(acc => ({
        key: acc.payment_method_code || '',
        label: acc.display_name || acc.account_name,
        paid: acc.auto_mark_paid,
    }))

    const getPaymentLabel = (method: PaymentMethod) => {
        const account = paymentAccounts.find(acc => acc.payment_method_code === method)
        return account?.display_name || account?.account_name || method
    }

    return (
        <div className="h-screen bg-slate-900 flex flex-col">
            {/* 頂部搜尋區 */}
            <div className="bg-slate-800 px-3 py-3 border-b border-slate-700">
                <div className="flex gap-2">
                    <div className="flex-1 relative">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => handleSearchInput(e.target.value)}
                            placeholder="🔍 掃描或搜尋商品..."
                            className="w-full rounded-lg px-4 py-3 text-base text-white bg-slate-700 border border-slate-600 focus:border-indigo-500 focus:outline-none"
                        />
                        {/* 搜尋結果下拉 */}
                        {searchResults.length > 0 && (
                            <div className="absolute z-50 w-full mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl max-h-80 overflow-y-auto">
                                {/* 顯示搜尋結果數量 */}
                                <div className="sticky top-0 bg-slate-700 px-4 py-1 text-xs text-slate-400 border-b border-slate-600">
                                    找到 {searchResults.length} 筆結果
                                </div>
                                {searchResults.map((product) => (
                                    <button
                                        key={product.id}
                                        onClick={() => {
                                            addToCart(product, 1)
                                            setSearchQuery('')
                                        }}
                                        className="w-full px-4 py-3 text-left hover:bg-slate-700 border-b border-slate-700 last:border-b-0"
                                    >
                                        <div className="text-white font-medium">{product.name}</div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-slate-400">{product.item_code}</span>
                                            <span className="text-emerald-400">{formatCurrency(product.price)}</span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                        {/* 找不到商品時顯示建立選項 */}
                        {searchQuery.trim() && searchResults.length === 0 && (
                            <div className="absolute z-50 w-full mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-4">
                                <div className="text-slate-400 text-center mb-3">找不到「{searchQuery}」</div>
                                <button
                                    onClick={() => openQuickAddProduct()}
                                    className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg transition-all"
                                >
                                    + 快速建立商品
                                </button>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={() => setShowCameraScanner(true)}
                        className="px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xl"
                    >
                        📷
                    </button>
                    <button
                        onClick={() => {
                            setShowClosingModal(true)
                            fetchClosingStats()
                        }}
                        className="px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium"
                    >
                        日結
                    </button>
                </div>
                {/* 當前營業日提示 */}
                <div className="mt-2 text-center">
                    <span className="text-amber-400 text-xs font-medium">
                        營業日：{businessDate}
                    </span>
                </div>
            </div>

            {/* 購物車列表 */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {cart.length === 0 ? (
                    <div className="text-center text-slate-500 mt-20">
                        <div className="text-6xl mb-4">🛒</div>
                        <div className="text-slate-400 text-lg">掃描或搜尋商品加入購物車</div>
                    </div>
                ) : (
                    cart.map((item, index) => (
                        <div
                            key={`${item.product_id}-${index}`}
                            className={`bg-slate-800 rounded-lg p-3 ${item.isFreeGift ? 'border-2 border-emerald-500' : ''}`}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex-1">
                                    <div className="text-white font-medium text-sm line-clamp-1">
                                        {item.isFreeGift && <span className="text-emerald-400 mr-1">🎁</span>}
                                        {item.product.name}
                                    </div>
                                    <div className="text-slate-400 text-sm">
                                        {formatCurrency(item.price)} × {item.quantity}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center bg-slate-700 rounded-lg">
                                        <button
                                            onClick={() => updateQuantity(index, item.quantity - 1)}
                                            className="px-3 py-1 text-white hover:bg-slate-600 rounded-l-lg"
                                        >
                                            −
                                        </button>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            defaultValue={item.quantity}
                                            key={`qty-${item.product_id}-${index}-${item.quantity}`}
                                            onFocus={(e) => e.target.select()}
                                            onBlur={(e) => {
                                                const newQty = parseInt(e.target.value) || 1
                                                if (newQty > 0 && newQty !== item.quantity) {
                                                    updateQuantity(index, newQty)
                                                } else if (newQty <= 0) {
                                                    e.target.value = String(item.quantity)
                                                }
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.currentTarget.blur()
                                                }
                                            }}
                                            className="w-12 py-1 text-white text-center bg-transparent border-0 focus:outline-none focus:ring-0 focus:bg-slate-600 rounded"
                                        />
                                        <button
                                            onClick={() => updateQuantity(index, item.quantity + 1)}
                                            className="px-3 py-1 text-white hover:bg-slate-600 rounded-r-lg"
                                        >
                                            +
                                        </button>
                                    </div>
                                    <div className="text-white font-bold min-w-[70px] text-right">
                                        {formatCurrency(item.price * item.quantity)}
                                    </div>
                                    <button
                                        onClick={() => removeFromCart(item.product_id, index)}
                                        className="text-red-400 hover:text-red-300 p-1"
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 mt-2">
                                {!item.ichiban_kuji_prize_id && (
                                    <label className="flex items-center gap-1 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={item.isFreeGift || false}
                                            onChange={() => toggleFreeGift(index)}
                                            className="w-3 h-3 accent-emerald-500"
                                        />
                                        <span className="text-xs text-slate-400">贈品</span>
                                    </label>
                                )}
                                <label className="flex items-center gap-1 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={item.isNotDelivered || false}
                                        onChange={() => toggleNotDelivered(index)}
                                        className="w-3 h-3 accent-orange-500"
                                    />
                                    <span className="text-xs text-slate-400">未出貨</span>
                                </label>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* 底部結帳區 */}
            <div className="bg-slate-800 border-t border-slate-700 p-3 space-y-3 safe-area-bottom">
                {/* 客戶 + 付款方式 */}
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowCustomerPicker(true)}
                        className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 px-3 rounded-lg text-sm text-left"
                    >
                        <span className="text-slate-400">客戶:</span>{' '}
                        {selectedCustomer?.customer_name || '散客'}
                    </button>
                    <button
                        onClick={() => setShowPaymentPicker(true)}
                        className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 px-3 rounded-lg text-sm text-left"
                    >
                        <span className="text-slate-400">付款:</span>{' '}
                        {getPaymentLabel(paymentMethod)}
                    </button>
                </div>

                {/* 狀態切換 */}
                <div className="flex gap-2">
                    <label className="flex-1 flex items-center gap-2 cursor-pointer bg-slate-700 rounded-lg px-3 py-2">
                        <input
                            type="checkbox"
                            checked={isPaid}
                            onChange={(e) => setIsPaid(e.target.checked)}
                            className="w-4 h-4 accent-indigo-500"
                        />
                        <span className="text-sm text-white">已收款</span>
                    </label>
                    {cart.some(item => item.isNotDelivered) && (
                        <div className="flex-1 flex items-center gap-2 bg-orange-600 rounded-lg px-3 py-2">
                            <span className="text-sm text-white">有未出貨商品</span>
                        </div>
                    )}
                </div>

                {/* 折扣資訊 */}
                {(discountAmount > 0 || storeCreditUsed > 0) && (
                    <div className="text-sm space-y-1">
                        {discountAmount > 0 && (
                            <div className="flex justify-between text-red-400">
                                <span>折扣</span>
                                <span>-{formatCurrency(discountAmount)}</span>
                            </div>
                        )}
                        {storeCreditUsed > 0 && (
                            <div className="flex justify-between text-emerald-400">
                                <span>購物金</span>
                                <span>-{formatCurrency(storeCreditUsed)}</span>
                            </div>
                        )}
                    </div>
                )}

                {/* 備註輸入框 */}
                <div>
                    <input
                        type="text"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="📝 輸入備註..."
                        className="w-full border border-slate-600 rounded-lg px-3 py-2 text-sm text-white bg-slate-700 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                    />
                </div>

                {/* 購物金部分折抵警告 */}
                {storeCreditUsed > 0 && finalTotal > 0 && isPaid && cart.length > 0 && (
                    <div className="p-2 rounded-lg bg-amber-900/50 border border-amber-600 text-center">
                        <div className="text-amber-400 text-sm font-medium">
                            購物金折抵 {formatCurrency(storeCreditUsed)} 後
                        </div>
                        <div className="text-amber-300 text-sm">
                            剩餘 {formatCurrency(finalTotal)} 將記為已收款
                        </div>
                    </div>
                )}

                {/* 總計 + 暫存/結帳 */}
                <div className="flex items-center gap-2">
                    <div className="flex-1">
                        <div className="text-slate-400 text-sm">應收金額</div>
                        <div className="text-white text-2xl font-bold">{formatCurrency(finalTotal)}</div>
                    </div>
                    <button
                        onClick={() => setShowDraftsPicker(true)}
                        className="bg-slate-600 hover:bg-slate-500 text-white font-bold py-4 px-4 rounded-lg transition-all relative"
                    >
                        📋
                        {drafts.length > 0 && (
                            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
                                {drafts.length}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={handleSaveDraft}
                        disabled={loading || cart.length === 0}
                        className="bg-amber-600 hover:bg-amber-500 disabled:bg-slate-600 text-white font-bold py-4 px-4 rounded-lg transition-all"
                    >
                        暫存
                    </button>
                    <button
                        onClick={handleCheckout}
                        disabled={loading || cart.length === 0}
                        className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-600 text-white font-bold text-lg py-4 px-6 rounded-lg transition-all"
                    >
                        {loading ? '處理中...' : '結帳'}
                    </button>
                </div>

                {error && (
                    <div className="bg-red-900 border border-red-600 text-red-200 rounded-lg px-3 py-2 text-sm">
                        {error}
                    </div>
                )}
            </div>

            {/* 相機掃描 Modal */}
            <CameraScanner
                isOpen={showCameraScanner}
                onClose={() => setShowCameraScanner(false)}
                onScan={handleCameraScan}
            />

            {/* 客戶選擇 Modal */}
            {showCustomerPicker && (
                <div className="fixed inset-0 bg-black/70 z-50 flex items-end">
                    <div className="w-full bg-slate-800 rounded-t-2xl max-h-[70vh] flex flex-col">
                        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
                            <h3 className="text-lg font-bold text-white">選擇客戶</h3>
                            <button onClick={() => setShowCustomerPicker(false)} className="text-slate-400 text-2xl">×</button>
                        </div>
                        <div className="p-3">
                            <input
                                type="text"
                                value={customerSearchQuery}
                                onChange={(e) => setCustomerSearchQuery(e.target.value)}
                                placeholder="搜尋客戶..."
                                className="w-full rounded-lg px-4 py-3 text-white bg-slate-700 border border-slate-600"
                            />
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            <button
                                onClick={() => {
                                    setSelectedCustomer(null)
                                    setShowCustomerPicker(false)
                                }}
                                className="w-full px-4 py-3 text-left hover:bg-slate-700 border-b border-slate-700 text-white"
                            >
                                散客
                            </button>
                            {filteredCustomers.map((customer) => (
                                <button
                                    key={customer.id}
                                    onClick={() => {
                                        setSelectedCustomer(customer)
                                        setShowCustomerPicker(false)
                                    }}
                                    className="w-full px-4 py-3 text-left hover:bg-slate-700 border-b border-slate-700"
                                >
                                    <div className="text-white">{customer.customer_name}</div>
                                    <div className="text-sm text-slate-400 flex justify-between">
                                        <span>{customer.customer_code}</span>
                                        {customer.store_credit > 0 && (
                                            <span className="text-emerald-400">購物金: {formatCurrency(customer.store_credit)}</span>
                                        )}
                                    </div>
                                </button>
                            ))}
                        </div>
                        {/* 新增客戶按鈕 */}
                        <div className="p-3 border-t border-slate-700">
                            <button
                                onClick={() => setShowQuickAddCustomer(true)}
                                className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg transition-all"
                            >
                                + 新增客戶
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 快速新增客戶 Modal */}
            {showQuickAddCustomer && (
                <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
                    <div className="w-full max-w-md bg-slate-800 rounded-xl">
                        <div className="bg-green-600 text-white px-4 py-3 rounded-t-xl flex items-center justify-between">
                            <h3 className="text-lg font-bold">快速建立客戶</h3>
                            <button onClick={() => setShowQuickAddCustomer(false)} className="text-2xl hover:text-gray-200">×</button>
                        </div>
                        <div className="p-4 space-y-4">
                            <div>
                                <label className="block font-medium mb-2 text-white">
                                    客戶名稱 <span className="text-red-400">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={newCustomerName}
                                    onChange={(e) => setNewCustomerName(e.target.value)}
                                    placeholder="請輸入客戶名稱"
                                    className="w-full rounded-lg px-4 py-3 text-white bg-slate-700 border border-slate-600 focus:border-green-500 focus:outline-none"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="block font-medium mb-2 text-white">
                                    客戶電話 <span className="text-red-400">*</span>
                                </label>
                                <input
                                    type="tel"
                                    value={newCustomerPhone}
                                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !addingCustomer) {
                                            handleQuickAddCustomer()
                                        }
                                    }}
                                    placeholder="請輸入客戶電話"
                                    className="w-full rounded-lg px-4 py-3 text-white bg-slate-700 border border-slate-600 focus:border-green-500 focus:outline-none"
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={handleQuickAddCustomer}
                                    disabled={addingCustomer}
                                    className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-500 text-white font-bold py-3 rounded-lg transition-all"
                                >
                                    {addingCustomer ? '建立中...' : '建立客戶'}
                                </button>
                                <button
                                    onClick={() => setShowQuickAddCustomer(false)}
                                    className="flex-1 bg-slate-600 hover:bg-slate-500 text-white font-bold py-3 rounded-lg transition-all"
                                >
                                    取消
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 快速新增商品 Modal */}
            {showQuickAddProduct && (
                <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
                    <div className="w-full max-w-md bg-slate-800 rounded-xl">
                        <div className="bg-blue-600 text-white px-4 py-3 rounded-t-xl flex items-center justify-between">
                            <h3 className="text-lg font-bold">快速建立商品</h3>
                            <button onClick={() => { setShowQuickAddProduct(false); setDuplicateWarning(null) }} className="text-2xl hover:text-gray-200">×</button>
                        </div>
                        <div className="p-4 space-y-4">
                            {duplicateWarning && (
                                <div className="bg-amber-500/20 border border-amber-500 text-amber-300 rounded-lg p-3 text-sm">
                                    ⚠️ {duplicateWarning}
                                    <div className="mt-2 text-xs">再次點擊「建立商品」確認建立</div>
                                </div>
                            )}
                            <div>
                                <label className="block font-medium mb-2 text-white">
                                    商品名稱 <span className="text-red-400">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={quickProductName}
                                    onChange={(e) => { setQuickProductName(e.target.value); setDuplicateWarning(null) }}
                                    placeholder="請輸入商品名稱"
                                    className="w-full rounded-lg px-4 py-3 text-white bg-slate-700 border border-slate-600 focus:border-blue-500 focus:outline-none"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="block font-medium mb-2 text-white">
                                    條碼 <span className="text-slate-500">(選填)</span>
                                </label>
                                <input
                                    type="text"
                                    value={quickProductBarcode}
                                    onChange={(e) => setQuickProductBarcode(e.target.value)}
                                    placeholder="請輸入條碼"
                                    className="w-full rounded-lg px-4 py-3 text-white bg-slate-700 border border-slate-600 focus:border-blue-500 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block font-medium mb-2 text-white">
                                    售價 <span className="text-slate-500">(選填，預設 0)</span>
                                </label>
                                <input
                                    type="number"
                                    value={quickProductPrice}
                                    onChange={(e) => setQuickProductPrice(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !addingProduct) {
                                            handleQuickAddProduct()
                                        }
                                    }}
                                    placeholder="請輸入售價"
                                    className="w-full rounded-lg px-4 py-3 text-white bg-slate-700 border border-slate-600 focus:border-blue-500 focus:outline-none"
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={handleQuickAddProduct}
                                    disabled={addingProduct}
                                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-500 text-white font-bold py-3 rounded-lg transition-all"
                                >
                                    {addingProduct ? '建立中...' : '建立商品'}
                                </button>
                                <button
                                    onClick={() => { setShowQuickAddProduct(false); setDuplicateWarning(null) }}
                                    className="flex-1 bg-slate-600 hover:bg-slate-500 text-white font-bold py-3 rounded-lg transition-all"
                                >
                                    取消
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 付款方式 Modal */}
            {showPaymentPicker && (
                <div className="fixed inset-0 bg-black/70 z-50 flex items-end">
                    <div className="w-full bg-slate-800 rounded-t-2xl">
                        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
                            <h3 className="text-lg font-bold text-white">選擇付款方式</h3>
                            <button onClick={() => setShowPaymentPicker(false)} className="text-slate-400 text-2xl">×</button>
                        </div>
                        <div className="p-3 grid grid-cols-2 gap-2">
                            {paymentMethods.map((method) => (
                                <button
                                    key={method.key}
                                    onClick={() => {
                                        setPaymentMethod(method.key as PaymentMethod)
                                        setIsPaid(method.paid)
                                        setShowPaymentPicker(false)
                                    }}
                                    className={`py-4 px-4 rounded-lg text-lg ${paymentMethod === method.key
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-slate-700 text-slate-300'
                                        }`}
                                >
                                    {method.label}
                                </button>
                            ))}
                        </div>
                        <div className="p-3 pb-6">
                            <button
                                onClick={() => setShowPaymentPicker(false)}
                                className="w-full bg-slate-700 text-slate-300 py-3 rounded-lg"
                            >
                                取消
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 暫存訂單 Modal */}
            {showDraftsPicker && (
                <div className="fixed inset-0 bg-black/70 z-50 flex items-end">
                    <div className="w-full bg-slate-800 rounded-t-2xl max-h-[80vh] flex flex-col">
                        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
                            <h3 className="text-lg font-bold text-white">暫存訂單</h3>
                            <button onClick={() => setShowDraftsPicker(false)} className="text-slate-400 text-2xl">×</button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 space-y-3">
                            {drafts.length === 0 ? (
                                <div className="text-center text-slate-500 py-10">
                                    <div className="text-4xl mb-2">📋</div>
                                    <div>目前沒有暫存訂單</div>
                                </div>
                            ) : (
                                drafts.map((draft) => {
                                    const draftSubtotal = draft.items.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0)
                                    let draftDiscountAmount = 0
                                    if (draft.discount_type === 'percent') {
                                        draftDiscountAmount = (draftSubtotal * draft.discount_value) / 100
                                    } else if (draft.discount_type === 'amount') {
                                        draftDiscountAmount = draft.discount_value
                                    }
                                    const draftTotal = Math.max(0, draftSubtotal - draftDiscountAmount)

                                    return (
                                        <div key={draft.id} className="bg-slate-700 rounded-lg p-3">
                                            <div className="flex justify-between items-start mb-2">
                                                <div>
                                                    <div className="text-white font-medium">
                                                        {draft.customers?.customer_name || '散客'}
                                                    </div>
                                                    <div className="text-slate-400 text-xs">
                                                        {new Date(draft.created_at).toLocaleString('zh-TW')}
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-white font-bold">{formatCurrency(draftTotal)}</div>
                                                    <div className="text-slate-400 text-xs">{draft.items.length} 項商品</div>
                                                </div>
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => {
                                                        handleLoadDraft(draft)
                                                        setShowDraftsPicker(false)
                                                    }}
                                                    className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded-lg text-sm font-medium"
                                                >
                                                    載入
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteDraft(draft.id)}
                                                    className="bg-red-600 hover:bg-red-500 text-white py-2 px-4 rounded-lg text-sm font-medium"
                                                >
                                                    刪除
                                                </button>
                                            </div>
                                        </div>
                                    )
                                })
                            )}
                        </div>
                        <div className="p-3 pb-6 border-t border-slate-700">
                            <button
                                onClick={() => setShowDraftsPicker(false)}
                                className="w-full bg-slate-700 text-slate-300 py-3 rounded-lg"
                            >
                                關閉
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 日結 Modal */}
            {showClosingModal && (
                <div className="fixed inset-0 bg-black/70 z-50 flex items-end">
                    <div className="w-full bg-slate-800 rounded-t-2xl max-h-[85vh] flex flex-col">
                        {/* Header */}
                        <div className="bg-emerald-600 px-4 py-3 rounded-t-2xl">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-white">營業日結算</h3>
                                <button onClick={() => setShowClosingModal(false)} className="text-white/80 text-2xl">×</button>
                            </div>
                        </div>

                        {!closingStats ? (
                            <div className="p-12 text-center text-slate-400">載入中...</div>
                        ) : (
                        <>
                        {/* 內容 */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {/* 日期選擇 */}
                            <div>
                                <label className="block text-slate-400 text-xs mb-1">營業日期</label>
                                <input
                                    type="date"
                                    value={businessDate}
                                    onChange={async (e) => {
                                        await setBusinessDate(e.target.value)
                                    }}
                                    className="w-full rounded-lg px-4 py-2 text-white bg-slate-700 border border-slate-600 focus:border-emerald-500 focus:outline-none"
                                />
                            </div>

                            {/* 已日結警告 */}
                            {alreadyClosed && (
                                <div className="bg-red-900/30 border border-red-700 rounded-lg p-3">
                                    <div className="text-red-300 font-semibold text-sm">
                                        {businessDate} 已經日結過了，無法重複日結
                                    </div>
                                </div>
                            )}

                            {/* 總覽 */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-blue-900/30 rounded-lg p-3">
                                    <div className="text-blue-400 text-xs mb-1">總銷售筆數</div>
                                    <div className="text-white text-xl font-bold">{closingStats.sales_count} 筆</div>
                                </div>
                                <div className="bg-emerald-900/30 rounded-lg p-3">
                                    <div className="text-emerald-400 text-xs mb-1">原始營業額</div>
                                    <div className="text-white text-xl font-bold">{formatCurrency((closingStats.total_sales || 0) + (closingStats.store_credit_used || 0))}</div>
                                    {(closingStats.store_credit_used || 0) > 0 && (
                                        <div className="text-emerald-400 text-xs mt-1">實收: {formatCurrency(closingStats.total_sales || 0)}</div>
                                    )}
                                </div>
                            </div>

                            {/* 購物金資訊 */}
                            {((closingStats.store_credit_used || 0) > 0 || (closingStats.store_credit_granted || 0) > 0) && (
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-orange-900/30 border border-orange-700 rounded-lg p-3">
                                        <div className="text-orange-400 text-xs mb-1">購物金折抵</div>
                                        <div className="text-white text-lg font-bold">{formatCurrency(closingStats.store_credit_used || 0)}</div>
                                    </div>
                                    <div className="bg-purple-900/30 border border-purple-700 rounded-lg p-3">
                                        <div className="text-purple-400 text-xs mb-1">購物金轉出</div>
                                        <div className="text-white text-lg font-bold">{formatCurrency(closingStats.store_credit_granted || 0)}</div>
                                    </div>
                                </div>
                            )}

                            {/* 假營業額（轉購物金前） */}
                            {closingStats.store_credit_converted > 0 && (
                                <div className="bg-purple-900/30 border border-purple-700 rounded-lg p-3">
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <div className="text-purple-400 text-xs mb-1">假營業額（轉購物金前）</div>
                                            <div className="text-purple-300 text-xs">含 {closingStats.store_credit_count} 筆已轉購物金</div>
                                        </div>
                                        <div className="text-white text-xl font-bold">{formatCurrency(closingStats.fake_total_sales)}</div>
                                    </div>
                                    <div className="mt-2 pt-2 border-t border-purple-700 text-sm text-purple-300 flex justify-between">
                                        <span>轉購物金金額：</span>
                                        <span className="font-semibold">-{formatCurrency(closingStats.store_credit_converted)}</span>
                                    </div>
                                </div>
                            )}

                            {/* 已收款 vs 未收款 */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-emerald-900/30 border border-emerald-700 rounded-lg p-3">
                                    <div className="text-emerald-400 text-xs mb-1">已收款</div>
                                    <div className="text-white text-lg font-bold">{formatCurrency(closingStats.paid_sales || 0)}</div>
                                    <div className="text-emerald-400 text-xs">{closingStats.paid_count || 0} 筆</div>
                                </div>
                                <div className="bg-orange-900/30 border border-orange-700 rounded-lg p-3">
                                    <div className="text-orange-400 text-xs mb-1">未收款</div>
                                    <div className="text-white text-lg font-bold">{formatCurrency(closingStats.unpaid_sales || 0)}</div>
                                    <div className="text-orange-400 text-xs">{closingStats.unpaid_count || 0} 筆</div>
                                </div>
                            </div>

                            {/* 已收款明細 */}
                            <div className="border-t border-slate-700 pt-4">
                                <div className="text-white font-semibold mb-3">已收款明細</div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="bg-slate-700 rounded-lg px-3 py-2 flex justify-between items-center">
                                        <span className="text-slate-300 text-sm">現金</span>
                                        <span className="text-white font-semibold">{formatCurrency(closingStats.paid_cash || 0)}</span>
                                    </div>
                                    <div className="bg-slate-700 rounded-lg px-3 py-2 flex justify-between items-center">
                                        <span className="text-slate-300 text-sm">刷卡</span>
                                        <span className="text-white font-semibold">{formatCurrency(closingStats.paid_card || 0)}</span>
                                    </div>
                                    <div className="bg-slate-700 rounded-lg px-3 py-2 flex justify-between items-center">
                                        <span className="text-slate-300 text-sm">轉帳</span>
                                        <span className="text-white font-semibold">{formatCurrency(closingStats.paid_transfer || 0)}</span>
                                    </div>
                                    <div className="bg-slate-700 rounded-lg px-3 py-2 flex justify-between items-center">
                                        <span className="text-slate-300 text-sm">貨到付款</span>
                                        <span className="text-white font-semibold">{formatCurrency(closingStats.paid_cod || 0)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 底部按鈕 */}
                        <div className="p-3 pb-6 border-t border-slate-700 flex gap-3">
                            <button
                                onClick={async () => {
                                    setClosingInProgress(true)
                                    try {
                                        await handleClosing()
                                        setShowClosingModal(false)
                                    } finally {
                                        setClosingInProgress(false)
                                    }
                                }}
                                disabled={closingInProgress || alreadyClosed}
                                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 text-white font-bold py-3 rounded-lg"
                            >
                                {closingInProgress ? '結算中...' : alreadyClosed ? '已日結' : '確認日結'}
                            </button>
                            <button
                                onClick={() => setShowClosingModal(false)}
                                disabled={closingInProgress}
                                className="flex-1 bg-slate-700 text-slate-300 py-3 rounded-lg"
                            >
                                取消
                            </button>
                        </div>
                        </>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
