'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import dynamic from 'next/dynamic'
import { formatCurrency } from '@/lib/utils'
import { SWR_KEYS } from '@/lib/swr/keys'
import type { Product, SaleItem, PaymentMethod } from '@/types'
import { useSerialPrinter } from '@/hooks/useSerialPrinter'
import { getTaiwanDateString } from '@/lib/timezone'

// 動態載入相機掃描元件（避免 SSR 問題）
const CameraScanner = dynamic(() => import('@/components/CameraScanner'), {
  ssr: false,
  loading: () => null,
})

// 動態載入手機版 POS
const MobilePOS = dynamic(() => import('@/components/MobilePOS'), {
  ssr: false,
  loading: () => null,
})

type CartItem = SaleItem & {
  product: Product
  ichiban_kuji_prize_id?: string
  ichiban_kuji_id?: string
  realProductId?: string | null  // 一番賞用：官方套獎品為 null，自組套為實際 product_id
  selectionOptionId?: string  // 複選獎：選中的選項ID
  isFreeGift?: boolean
  isNotDelivered?: boolean
}

type Customer = {
  id: string
  customer_code: string
  customer_name: string
  phone: string | null
  is_active: boolean
  store_credit: number  // 购物金余额
  credit_limit: number  // 信用额度
  loyalty_points: number
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

type TodaySale = {
  id: string
  sale_no: string
  customer_code: string | null
  total: number
  payment_method: PaymentMethod
  is_paid: boolean
  created_at: string
  customers?: { customer_name: string }
}

// Custom fetcher for POS: loads all products via pagination
const posProductsFetcher = async (url: string) => {
  const allProducts: Product[] = []
  let page = 1
  const pageSize = 1000
  while (true) {
    const res = await fetch(`${url}&page=${page}&pageSize=${pageSize}`)
    const data = await res.json()
    if (!data.ok) break
    allProducts.push(...(data.data || []))
    if (!data.data || data.data.length < pageSize) break
    page++
  }
  return allProducts
}

export default function POSPage() {
  const [barcode, setBarcode] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [isPaid, setIsPaid] = useState(true)

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [discountType, setDiscountType] = useState<'none' | 'percent' | 'amount'>('none')
  const [discountValue, setDiscountValue] = useState(0)
  const [receivedAmount, setReceivedAmount] = useState('')
  const barcodeInputRef = useRef<HTMLInputElement>(null)

  // 支付方式選擇步驟
  const [showPaymentSelection, setShowPaymentSelection] = useState(false)
  const [showCheckoutStep, setShowCheckoutStep] = useState(false)
  const [tempPaymentMethod, setTempPaymentMethod] = useState<PaymentMethod>('cash')
  const [receiptType, setReceiptType] = useState<'receipt' | 'none'>('receipt')
  const [showNoteInput, setShowNoteInput] = useState(false)

  // Sales mode - 可切換店裡/直播模式
  const [salesMode, setSalesMode] = useState<'pos' | 'live'>('pos')

  // Pinned products (常用商品固定)
  const [pinnedProductIds, setPinnedProductIds] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pinnedProducts')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    }
    return new Set()
  })

  // Custom scrollbar styles
  const scrollbarStyles = `
    .custom-scrollbar::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
      background: #f1f1f1;
      border-radius: 5px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
      background: #888;
      border-radius: 5px;
      transition: background 0.2s ease;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
      background: #555;
    }

    /* Dark mode scrollbar */
    .dark .custom-scrollbar::-webkit-scrollbar-track {
      background: #2d2d2d;
    }
    .dark .custom-scrollbar::-webkit-scrollbar-thumb {
      background: #555;
    }
    .dark .custom-scrollbar::-webkit-scrollbar-thumb:hover {
      background: #888;
    }
  `

  // Draft orders and today's sales
  const [showDrafts, setShowDrafts] = useState(false)
  const [showTodaySales, setShowTodaySales] = useState(false)

  // Quick add customer
  const [showQuickAddCustomer, setShowQuickAddCustomer] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [addingCustomer, setAddingCustomer] = useState(false)
  const phoneInputRef = useRef<HTMLInputElement>(null)

  const [useStoreCredit, setUseStoreCredit] = useState(false)

  // Customer search
  const [customerSearchQuery, setCustomerSearchQuery] = useState('')
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const customerInputRef = useRef<HTMLInputElement>(null)

  // Inventory mode (products or ichiban kuji)
  const [inventoryMode, setInventoryMode] = useState<'products' | 'ichiban'>('products')
  const [selectedKuji, setSelectedKuji] = useState<any | null>(null)
  const [expandedKujiId, setExpandedKujiId] = useState<string | null>(null)
  // 複選獎選項彈窗
  const [selectionDialog, setSelectionDialog] = useState<{
    kuji: any
    prize: any
    options: any[]
  } | null>(null)
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 相機掃描
  const [showCameraScanner, setShowCameraScanner] = useState(false)

  // Quantity input modal
  const [showQuantityModal, setShowQuantityModal] = useState(false)
  const [quantityModalProduct, setQuantityModalProduct] = useState<Product | null>(null)
  const [quantityInput, setQuantityInput] = useState('1')
  const quantityInputRef = useRef<HTMLInputElement>(null)

  // Quick add product
  const [showQuickAddProduct, setShowQuickAddProduct] = useState(false)
  const [quickProductName, setQuickProductName] = useState('')
  const [quickProductBarcode, setQuickProductBarcode] = useState('')
  const [quickProductPrice, setQuickProductPrice] = useState('')
  const [addingProduct, setAddingProduct] = useState(false)
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)

  // Business day closing (日結)
  const [businessDate, setBusinessDateState] = useState<string>(() => getTaiwanDateString())
  const [alreadyClosed, setAlreadyClosed] = useState(false)
  const [closingStats, setClosingStats] = useState<any>(null)
  const [showClosingModal, setShowClosingModal] = useState(false)
  const [closingNote, setClosingNote] = useState('')
  const [businessDateLoaded, setBusinessDateLoaded] = useState(false)

  // 多元付款
  type MultiPayment = { method: PaymentMethod; amount: string }
  const [isMultiPayment, setIsMultiPayment] = useState(false)
  const [multiPayments, setMultiPayments] = useState<MultiPayment[]>([
    { method: 'cash', amount: '' }
  ])

  // 結帳成功 Toast
  const [successToast, setSuccessToast] = useState<{
    show: boolean
    saleNo: string
    total: number
    received: number
    change: number
  } | null>(null)
  const [closingInProgress, setClosingInProgress] = useState(false)

  // 藍牙/串列印表機
  const { status: printerStatus, connect: connectPrinter, disconnect: disconnectPrinter, print: printSerial } = useSerialPrinter()

  // 手機版檢測
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // === SWR Hooks ===
  const { mutate: globalMutate } = useSWRConfig()

  const { data: customers = [], mutate: mutateCustomers } = useSWR<Customer[]>(SWR_KEYS.CUSTOMERS_ACTIVE)

  const { data: products = [], mutate: mutateProducts } = useSWR<Product[]>(
    '/api/products?active=true',
    posProductsFetcher,
    { dedupingInterval: 300000 } // 5 min cache, replaces localStorage cache
  )

  const { data: ichibanKujis = [], mutate: mutateIchibanKujis } = useSWR<any[]>('/api/ichiban-kuji?active=true&all=true')

  const { data: drafts = [], mutate: mutateDrafts } = useSWR<SaleDraft[]>('/api/sale-drafts')

  const { data: rawPaymentAccounts = [] } = useSWR<PaymentAccount[]>('/api/accounts?active_only=true')

  const paymentAccounts = useMemo(() => {
    return rawPaymentAccounts.filter(acc => acc.payment_method_code)
  }, [rawPaymentAccounts])

  const { data: todaySales = [], mutate: mutateTodaySales } = useSWR<TodaySale[]>(
    businessDateLoaded ? `/api/sales?business_date=${businessDate}&source=${salesMode}` : null
  )

  // Set default payment method when paymentAccounts load
  useEffect(() => {
    if (paymentAccounts.length > 0 && paymentMethod === 'cash') {
      const defaultAccount = paymentAccounts.find((acc) => acc.payment_method_code === 'cash') || paymentAccounts[0]
      if (defaultAccount.payment_method_code) {
        setPaymentMethod(defaultAccount.payment_method_code as PaymentMethod)
        setIsPaid(defaultAccount.payment_method_code !== 'pending')
      }
    }
  }, [paymentAccounts])

  // 獲取當前營業日
  const fetchCurrentBusinessDate = async () => {
    try {
      const res = await fetch(`/api/business-day-settings?source=${salesMode}`)
      const data = await res.json()
      if (data.ok && data.data?.current_business_date) {
        setBusinessDateState(data.data.current_business_date)
      }
      setBusinessDateLoaded(true)
    } catch (err) {
      console.error('Failed to fetch current business date:', err)
      setBusinessDateLoaded(true)
    }
  }

  // 包裝 setBusinessDate 讓外部可以設定
  const setBusinessDate = async (date: string) => {
    setBusinessDateState(date)
  }

  useEffect(() => {
    fetchCurrentBusinessDate()
  }, [])

  // 營業日載入完成後，再獲取日結統計
  useEffect(() => {
    if (businessDateLoaded) {
      fetchClosingStats()
    }
  }, [businessDateLoaded, salesMode])

  // Save pinned products to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('pinnedProducts', JSON.stringify(Array.from(pinnedProductIds)))
    }
  }, [pinnedProductIds])

  // Refetch business date and stats when sales mode changes
  useEffect(() => {
    if (businessDateLoaded) {
      fetchCurrentBusinessDate() // 重新獲取當前營業日（pos/live 可能不同）
    }
  }, [salesMode])

  // Close customer dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (customerInputRef.current && !customerInputRef.current.contains(event.target as Node)) {
        const dropdown = document.querySelector('.customer-dropdown')
        if (dropdown && !dropdown.contains(event.target as Node)) {
          setShowCustomerDropdown(false)
        }
      }
    }

    if (showCustomerDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showCustomerDropdown])

  const fetchClosingStats = async (dateOverride?: string) => {
    try {
      const date = dateOverride || businessDate
      const res = await fetch(`/api/business-day-closing?source=${salesMode}&business_date=${date}`)
      const data = await res.json()

      if (data.ok) {
        setClosingStats(data.data.current_stats)
        setAlreadyClosed(data.data.already_closed)
        if (dateOverride) setBusinessDate(dateOverride)

        // Refresh today's sales via SWR
        mutateTodaySales()
      }
    } catch (err) {
      console.error('Failed to fetch closing stats:', err)
    }
  }

  const handleClosing = async () => {
    if (alreadyClosed) {
      alert(`${businessDate} 已經日結過了，無法重複日結`)
      return
    }
    if (!confirm(`確定要對 ${businessDate} 執行日結嗎？\n\n日結後，新的銷售將記錄到下一個營業日。`)) {
      return
    }

    setClosingInProgress(true)
    try {
      const res = await fetch('/api/business-day-closing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: closingNote, source: salesMode, business_date: businessDate }),
      })

      const data = await res.json()

      if (data.ok) {
        // 日結成功，更新營業日為下一天
        if (data.next_business_date) {
          setBusinessDateState(data.next_business_date)
          alert(`日結完成！\n\n下一個營業日：${data.next_business_date}`)
        } else {
          alert('日結完成！')
        }
        setShowClosingModal(false)
        setClosingNote('')
        await fetchClosingStats()
      } else {
        alert(`日結失敗：${data.error}`)
      }
    } catch (err) {
      console.error('[日結] 錯誤:', err)
      alert('日結失敗')
    } finally {
      setClosingInProgress(false)
    }
  }

  const addToCart = (product: Product, quantityOrInfo: number | { kuji_id: string; prize_id: string; realProductId?: string | null } = 1) => {
    // Determine if this is an ichiban kuji item
    const ichibanInfo = typeof quantityOrInfo === 'object' ? quantityOrInfo : undefined
    const quantity = typeof quantityOrInfo === 'number' ? quantityOrInfo : 1

    setCart((prev) => {
      // 一番賞商品不堆疊，每個都是獨立項目
      if (ichibanInfo) {
        return [
          ...prev,
          {
            product_id: product.id,
            quantity,
            price: product.price,
            product,
            ichiban_kuji_id: ichibanInfo.kuji_id,
            ichiban_kuji_prize_id: ichibanInfo.prize_id,
            realProductId: ichibanInfo.realProductId ?? null,
            isFreeGift: false,
            isNotDelivered: false,
          },
        ]
      }

      // 一般商品：尋找狀態完全相同的項目（同商品 + 非贈品 + 已出貨）
      // 新加入的商品預設是非贈品且已出貨
      const existingIndex = prev.findIndex(
        (item) =>
          item.product_id === product.id &&
          !item.ichiban_kuji_prize_id &&
          item.isFreeGift === false &&
          item.isNotDelivered === false
      )

      if (existingIndex !== -1) {
        // 找到相同狀態的項目，增加數量
        return prev.map((item, i) =>
          i === existingIndex ? { ...item, quantity: item.quantity + quantity } : item
        )
      }

      // 沒有相同狀態的項目，新增一筆
      return [
        ...prev,
        {
          product_id: product.id,
          quantity,
          price: product.price,
          product,
          isFreeGift: false,
          isNotDelivered: false,
        },
      ]
    })
  }

  // 相機掃描結果處理
  const handleCameraScan = (code: string) => {
    // 在商品中搜尋條碼
    const matchedProduct = products.find(
      p => p.barcode && p.barcode.toLowerCase() === code.toLowerCase()
    )

    if (matchedProduct) {
      addToCart(matchedProduct, 1)
    } else {
      // 找不到商品，把條碼填入搜尋框讓用戶嘗試文字搜尋
      setSearchQuery(code)
    }
  }

  const openQuantityModal = (product: Product) => {
    setQuantityModalProduct(product)
    setQuantityInput('1')
    setShowQuantityModal(true)
    // Focus input after modal opens
    setTimeout(() => {
      quantityInputRef.current?.focus()
      quantityInputRef.current?.select()
    }, 100)
  }

  const closeQuantityModal = () => {
    setShowQuantityModal(false)
    setQuantityModalProduct(null)
    setQuantityInput('1')
  }

  const handleQuantitySubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!quantityModalProduct) return

    const qty = parseInt(quantityInput, 10)
    if (isNaN(qty) || qty <= 0) {
      alert('請輸入有效的數量')
      return
    }

    addToCart(quantityModalProduct, qty)
    closeQuantityModal()
  }

  const addIchibanPrize = (kuji: any, prize: any) => {
    if (prize.remaining <= 0) {
      alert('此賞別已售完')
      return
    }

    // 複選獎：開啟選項彈窗
    const options = prize.ichiban_kuji_prize_options || []
    if (options.length > 0) {
      // 過濾掉已消耗的和當前購物車已選的
      const cartOptionIds = new Set(cart.filter(i => i.selectionOptionId).map(i => i.selectionOptionId))
      const availableOptions = options.filter((o: any) => !o.is_consumed && !cartOptionIds.has(o.id))
      if (availableOptions.length === 0) {
        alert('此複選獎已無可用選項')
        return
      }
      setSelectionDialog({ kuji, prize, options: availableOptions })
      return
    }

    // 普通獎
    const product: Product = {
      id: prize.product_id || prize.id,
      item_code: prize.products?.item_code || prize.prize_tier,
      name: `【${kuji.name}】${prize.prize_tier} - ${prize.products?.name || prize.prize_name || ''}`,
      unit: prize.products?.unit || '抽',
      price: kuji.price || 0,
      cost: prize.products?.cost || 0,
      stock: prize.remaining,
      avg_cost: 0,
      allow_negative: false,
      is_active: true,
      tags: [],
    }

    addToCart(product, { kuji_id: kuji.id, prize_id: prize.id, realProductId: prize.product_id || null })
  }

  const handleSelectOption = (option: any) => {
    if (!selectionDialog) return
    const { kuji, prize } = selectionDialog
    const optProduct = option.products

    const product: Product = {
      id: optProduct?.id || option.product_id,
      item_code: optProduct?.item_code || prize.prize_tier,
      name: `【${kuji.name}】${prize.prize_tier} - ${optProduct?.name || ''}`,
      unit: optProduct?.unit || '抽',
      price: kuji.price || 0,
      cost: optProduct?.cost || 0,
      stock: prize.remaining,
      avg_cost: 0,
      allow_negative: false,
      is_active: true,
      tags: [],
    }

    setCart((prev) => [
      ...prev,
      {
        product_id: optProduct?.id || option.product_id,
        quantity: 1,
        price: kuji.price || 0,
        product,
        ichiban_kuji_id: kuji.id,
        ichiban_kuji_prize_id: prize.id,
        realProductId: optProduct?.id || option.product_id,
        selectionOptionId: option.id,
        isFreeGift: false,
        isNotDelivered: false,
      },
    ])

    setSelectionDialog(null)
  }

  const updateQuantity = (index: number, quantity: number) => {
    if (quantity < 1) {
      removeFromCart('', index)
      return
    }
    setCart((prev) =>
      prev.map((item, i) => (i === index ? { ...item, quantity } : item))
    )
  }

  const toggleFreeGift = (index: number) => {
    setCart((prev) =>
      prev.map((item, i) => {
        if (i === index) {
          const isFreeGift = !item.isFreeGift
          return {
            ...item,
            isFreeGift,
            price: isFreeGift ? 0 : item.product.price,
          }
        }
        return item
      })
    )
  }

  const toggleAllFreeGift = () => {
    // 检查是否所有商品都已是赠品
    const allAreFreeGift = cart.every(item => item.isFreeGift)

    setCart((prev) =>
      prev.map((item) => {
        // 一番赏不能设置为赠品
        if (item.ichiban_kuji_prize_id) {
          return item
        }

        // 如果全部都是赠品，则取消全选；否则全选
        const isFreeGift = !allAreFreeGift
        return {
          ...item,
          isFreeGift,
          price: isFreeGift ? 0 : item.product.price,
        }
      })
    )
  }

  const toggleNotDelivered = (index: number) => {
    setCart((prev) =>
      prev.map((item, i) => {
        if (i === index) {
          return {
            ...item,
            isNotDelivered: !item.isNotDelivered,
          }
        }
        return item
      })
    )
  }

  const removeFromCart = (productId: string, index?: number) => {
    setCart((prev) => {
      if (index !== undefined) {
        // Remove specific item at index (for ichiban items)
        return prev.filter((_, i) => i !== index)
      } else {
        // Remove all items with this product_id (for regular products)
        return prev.filter((item) => item.product_id !== productId)
      }
    })
  }

  // Calculate combo price adjustments for ichiban kuji
  const applyComboPrice = () => {
    const ichibanGroups: { [kuji_id: string]: { items: CartItem[], kuji: any } } = {}

    // Group ichiban items by kuji_id
    cart.forEach(item => {
      if (item.ichiban_kuji_id) {
        if (!ichibanGroups[item.ichiban_kuji_id]) {
          const kuji = ichibanKujis.find(k => k.id === item.ichiban_kuji_id)
          ichibanGroups[item.ichiban_kuji_id] = { items: [], kuji }
        }
        ichibanGroups[item.ichiban_kuji_id].items.push(item)
      }
    })

    let adjustedCart = [...cart]

    // Apply combo prices
    Object.keys(ichibanGroups).forEach(kuji_id => {
      const group = ichibanGroups[kuji_id]
      const totalCount = group.items.reduce((sum, item) => sum + item.quantity, 0)

      // Check if the set is untouched (all prizes have remaining === quantity)
      const isUntouched = group.kuji?.ichiban_kuji_prizes?.every(
        (p: any) => p.remaining === p.quantity
      ) ?? false

      // 開套優先級大於組合價：若 set 未抽過且有開套優惠，只套用開套優惠（不重複觸發組合價）
      const regularCombos = group.kuji?.combo_prices || []
      const openingCombos = isUntouched ? (group.kuji?.opening_combo_prices || []) : []
      const comboPrices = (openingCombos.length > 0 ? openingCombos : regularCombos)
        .sort((a: any, b: any) => b.draws - a.draws)
      const originalPrice = group.kuji?.price || 0

      if (comboPrices.length === 0) return

      // Greedy algorithm: use largest combo first, then smaller combos, then original price
      let remaining = totalCount
      let totalComboPrice = 0
      let comboDrawsUsed = 0
      const priceBreakdown: { count: number; pricePerItem: number }[] = []

      for (const combo of comboPrices) {
        const sets = Math.floor(remaining / combo.draws)
        if (sets > 0) {
          totalComboPrice += sets * combo.price
          comboDrawsUsed += sets * combo.draws
          remaining -= sets * combo.draws
          // Track price per item for this combo
          priceBreakdown.push({
            count: sets * combo.draws,
            pricePerItem: combo.price / combo.draws
          })
        }
      }

      // Remaining items use original price
      if (remaining > 0) {
        priceBreakdown.push({
          count: remaining,
          pricePerItem: originalPrice
        })
      }

      // Apply prices to items based on their position
      let itemIndex = 0
      adjustedCart = adjustedCart.map(item => {
        if (item.ichiban_kuji_id === kuji_id) {
          // Find which price bracket this item falls into
          let accumulatedCount = 0
          let itemPrice = originalPrice

          for (const bracket of priceBreakdown) {
            if (itemIndex < accumulatedCount + bracket.count) {
              itemPrice = bracket.pricePerItem
              break
            }
            accumulatedCount += bracket.count
          }

          itemIndex += item.quantity
          return { ...item, price: itemPrice }
        }
        return item
      })
    })

    return adjustedCart
  }

  const cartWithComboPrice = applyComboPrice()

  // Group ichiban items by kuji_id for display
  const displayCart: (CartItem & { groupedCount?: number, indices?: number[] })[] = []
  const processedIndices = new Set<number>()

  cartWithComboPrice.forEach((item, index) => {
    if (processedIndices.has(index)) return

    if (item.ichiban_kuji_id) {
      // Find all items with same kuji_id
      const sameKujiIndices: number[] = []
      let totalQuantity = 0
      let totalPrice = 0

      cartWithComboPrice.forEach((otherItem, otherIndex) => {
        if (otherItem.ichiban_kuji_id === item.ichiban_kuji_id && !processedIndices.has(otherIndex)) {
          sameKujiIndices.push(otherIndex)
          totalQuantity += otherItem.quantity
          totalPrice += otherItem.price * otherItem.quantity
          processedIndices.add(otherIndex)
        }
      })

      // Create merged item
      const kuji = ichibanKujis.find(k => k.id === item.ichiban_kuji_id)
      displayCart.push({
        ...item,
        product: {
          ...item.product,
          name: `【${kuji?.name}】組合`
        },
        quantity: totalQuantity,
        price: totalPrice / totalQuantity, // Average price
        groupedCount: sameKujiIndices.length,
        indices: sameKujiIndices
      })
    } else {
      // Regular product - add as is
      displayCart.push({ ...item, indices: [index] })
      processedIndices.add(index)
    }
  })

  const subtotal = cartWithComboPrice.reduce((sum, item) => sum + item.price * item.quantity, 0)

  let discountAmount = 0
  if (discountType === 'percent') {
    discountAmount = (subtotal * discountValue) / 100
  } else if (discountType === 'amount') {
    discountAmount = discountValue
  }

  const total = Math.max(0, subtotal - discountAmount)

  // 计算购物金抵扣（预览）
  const storeCreditUsed = useStoreCredit && selectedCustomer && selectedCustomer.store_credit > 0
    ? Math.min(selectedCustomer.store_credit, total)
    : 0
  const finalTotal = total - storeCreditUsed

  // Get combo price info for display
  const getIchibanComboInfo = (kuji_id: string) => {
    const items = cart.filter(item => item.ichiban_kuji_id === kuji_id)
    const totalCount = items.reduce((sum, item) => sum + item.quantity, 0)
    const kuji = ichibanKujis.find(k => k.id === kuji_id)
    const comboPrices = kuji?.combo_prices || []

    const applicableCombo = comboPrices
      .filter((combo: any) => combo.draws <= totalCount)
      .sort((a: any, b: any) => b.draws - a.draws)[0]

    return { totalCount, applicableCombo, kuji }
  }

  const handleCheckout = async () => {
    // 🔒 防止重複提交
    if (loading) {
      console.warn('Already processing checkout, ignoring duplicate request')
      return
    }

    if (cart.length === 0) {
      setError('購物車是空的')
      return
    }

    // 有未出貨商品時，必須選擇客戶（否則無法追蹤配送）
    const hasNotDeliveredItems = cart.some(item => item.isNotDelivered)
    if (!selectedCustomer && hasNotDeliveredItems) {
      const shouldAddCustomer = confirm('有未出貨商品，必須選擇客戶以便後續配送追蹤\n\n要建立新客戶嗎？')
      if (shouldAddCustomer) {
        setShowQuickAddCustomer(true)
        return
      } else {
        setError('有未出貨商品時，必須選擇客戶')
        return
      }
    }

    if (!selectedCustomer && !isPaid) {
      const shouldAddCustomer = confirm('未收款訂單需要選擇客戶\n\n要建立新客戶嗎？')
      if (shouldAddCustomer) {
        setShowQuickAddCustomer(true)
        return
      } else {
        setError('未收款訂單需要選擇客戶')
        return
      }
    }

    // 多元付款總額驗證
    if (isMultiPayment && isPaid) {
      const multiTotal = multiPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0)
      if (Math.abs(multiTotal - finalTotal) > 0.01) {
        setError(`多元付款總額 ${formatCurrency(multiTotal)} 與應收金額 ${formatCurrency(finalTotal)} 不符`)
        return
      }
    }

    // 購物金部分折抵確認：防止購物金不足以支付全額卻誤按結帳
    if (storeCreditUsed > 0 && finalTotal > 0 && isPaid && !isMultiPayment) {
      const paymentLabel = paymentAccounts.find(a => a.payment_method_code === paymentMethod)?.account_name || paymentMethod
      const confirmed = confirm(
        `購物金折抵 ${formatCurrency(storeCreditUsed)} 後，剩餘 ${formatCurrency(finalTotal)} 將以「${paymentLabel}」收款。\n\n確定已經收到 ${formatCurrency(finalTotal)}？\n（如果尚未收款，請按取消並選擇「待定」）`
      )
      if (!confirmed) return
    }

    setLoading(true)
    setError('')

    try {
      // Use combo price adjusted cart for checkout
      const checkoutCart = applyComboPrice()

      // 檢查購物車中是否有未出貨的商品（用於決定是否顯示出貨資訊）
      const hasNotDeliveredItems = cart.some(item => item.isNotDelivered)

      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_code: selectedCustomer?.customer_code || undefined,
          source: salesMode,
          payment_method: paymentMethod,
          is_paid: isPaid,
          use_store_credit: useStoreCredit,
          is_delivered: !hasNotDeliveredItems, // 保留向後兼容
          delivery_method: undefined,
          // 有未出貨商品時，預設 7 天後到期
          expected_delivery_date: hasNotDeliveredItems
            ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
            : undefined,
          delivery_note: undefined,
          note: note || undefined,
          discount_type: discountType,
          discount_value: discountValue,
          // 多元付款：傳送 payments 陣列
          payments: isMultiPayment && isPaid
            ? multiPayments
              .filter(p => parseFloat(p.amount) > 0)
              .map(p => ({ method: p.method, amount: parseFloat(p.amount) }))
            : undefined,
          // 傳送每個品項的出貨狀態（官方套獎品 realProductId 為 null，送 null 給後端）
          items: checkoutCart.map((item) => ({
            product_id: item.ichiban_kuji_prize_id ? (item.realProductId ?? null) : item.product_id,
            quantity: item.quantity,
            price: item.price,
            ichiban_kuji_prize_id: item.ichiban_kuji_prize_id,
            ichiban_kuji_id: item.ichiban_kuji_id,
            selection_option_id: item.selectionOptionId,
            isNotDelivered: item.isNotDelivered || false,
          })),
        }),
      })

      const data = await res.json()

      if (data.ok) {
        setCart([])
        setSelectedCustomer(null)
        setCustomerSearchQuery('')
        setPaymentMethod('cash')
        setIsPaid(true)

        setNote('')
        setDiscountType('none')
        setDiscountValue(0)
        setReceivedAmount('')
        setUseStoreCredit(true)
        // 重置多元付款
        setIsMultiPayment(false)
        setMultiPayments([{ method: 'cash', amount: '' }])
        mutateTodaySales() // Refresh today's sales
        mutateIchibanKujis() // Refresh ichiban kuji inventory
        mutateCustomers() // Refresh customers to update store credit
        globalMutate(SWR_KEYS.ACCOUNTS) // Refresh account balances

        // 顯示成功 Toast（現金才顯示找零）
        const received = parseFloat(receivedAmount) || finalTotal
        setSuccessToast({
          show: true,
          saleNo: data.data.sale_no,
          total: finalTotal,
          received: paymentMethod === 'cash' ? received : finalTotal,
          change: paymentMethod === 'cash' ? Math.max(0, received - finalTotal) : 0
        })
        // 3秒後自動消失
        setTimeout(() => setSuccessToast(null), 3000)

        // 自動列印收據（fire-and-forget，不阻擋 UI）
        if (receiptType === 'receipt') {
          if (printerStatus === 'connected') {
            // 從 server 取得 GB2312 bytes，再透過 Web Serial 送出
            const paymentLabel = paymentAccounts.find(a => a.payment_method_code === paymentMethod)?.account_name || paymentMethod
            const received = parseFloat(receivedAmount) || finalTotal
            const change = paymentMethod === 'cash' ? Math.max(0, received - finalTotal) : 0
            fetch('/api/print/receipt-bytes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sale_no: data.data.sale_no,
                payment_label: paymentLabel,
                is_paid: isPaid,
                total: finalTotal,
                discount_amount: discountAmount,
                received: paymentMethod === 'cash' ? received : finalTotal,
                change: paymentMethod === 'cash' ? change : 0,
                items: checkoutCart.map(item => ({
                  name: item.product.name,
                  quantity: item.quantity,
                  price: item.price,
                  isFreeGift: item.isFreeGift || false,
                })),
              }),
            })
              .then(r => r.arrayBuffer())
              .then(buf => printSerial(new Uint8Array(buf)))
              .catch(() => {})
          } else {
            // Fallback：透過伺服器 TCP 列印
            fetch('/api/print/receipt', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sale_id: data.data.id }),
            }).catch(() => {})
          }
        }
      } else {
        setError(data.error || '結帳失敗')
      }
    } catch (err) {
      setError('結帳失敗')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveDraft = async () => {
    if (cart.length === 0) {
      setError('購物車是空的')
      return
    }

    setLoading(true)
    setError('')

    try {
      // Use combo price adjusted cart for saving draft
      const draftCart = applyComboPrice()

      const res = await fetch('/api/sale-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_code: selectedCustomer?.customer_code || null,
          payment_method: paymentMethod,
          is_paid: isPaid,
          note: note || null,
          discount_type: discountType,
          discount_value: discountValue,
          items: draftCart.map((item) => ({
            product_id: item.ichiban_kuji_prize_id ? (item.realProductId ?? null) : item.product_id,
            quantity: item.quantity,
            price: item.price,
            product_name: item.product.name,
            ichiban_kuji_prize_id: item.ichiban_kuji_prize_id,
            ichiban_kuji_id: item.ichiban_kuji_id,
            selectionOptionId: item.selectionOptionId,
            isFreeGift: item.isFreeGift || false,
            isNotDelivered: item.isNotDelivered || false,
          })),
        }),
      })

      const data = await res.json()

      if (data.ok) {
        setCart([])
        setSelectedCustomer(null)
        setCustomerSearchQuery('')
        setPaymentMethod('cash')
        setIsPaid(true)
        setNote('')
        setDiscountType('none')
        setDiscountValue(0)
        setUseStoreCredit(true)
        mutateDrafts()
        alert('訂單已暫存')
      } else {
        setError(data.error || '暫存失敗')
      }
    } catch (err) {
      setError('暫存失敗')
    } finally {
      setLoading(false)
    }
  }

  const handleLoadDraft = async (draft: SaleDraft) => {
    setLoading(true)
    try {
      // 用已載入的 products 比對，不再重新 fetch
      const productMap = new Map(products.map(p => [p.id, p]))

      const itemsWithProducts = draft.items.map((item: any) => {
        const product = item.product_id ? productMap.get(item.product_id) : null
        const fallbackName = item.product_name || item.snapshot_name || 'Unknown'
        return {
          product_id: item.product_id,
          quantity: item.quantity,
          price: item.price,
          product: product || {
            id: item.product_id || 'unknown',
            item_code: '',
            name: fallbackName,
            barcode: null,
            price: item.price,
            cost: 0,
            avg_cost: 0,
            unit: '件',
            stock: 0,
            tags: [],
            is_active: true,
            allow_negative: true,
          } as Product,
          ichiban_kuji_prize_id: item.ichiban_kuji_prize_id,
          ichiban_kuji_id: item.ichiban_kuji_id,
          realProductId: item.product_id,
          selectionOptionId: item.selectionOptionId,
          isFreeGift: item.isFreeGift || false,
          isNotDelivered: item.isNotDelivered || false,
        }
      })

      setCart(itemsWithProducts)
      setSelectedCustomer(
        draft.customer_code
          ? customers.find((c) => c.customer_code === draft.customer_code) || null
          : null
      )
      setCustomerSearchQuery('')
      setPaymentMethod(draft.payment_method)
      setIsPaid(draft.is_paid)
      setNote(draft.note || '')
      setDiscountType(draft.discount_type)
      setDiscountValue(draft.discount_value)
      setShowDrafts(false)

      // Delete the draft
      await fetch(`/api/sale-drafts/${draft.id}`, { method: 'DELETE' })
      mutateDrafts()
    } catch (err) {
      setError('載入失敗')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteDraft = async (draftId: string) => {
    if (!confirm('確定要刪除這個暫存訂單嗎？')) return

    try {
      const res = await fetch(`/api/sale-drafts/${draftId}`, { method: 'DELETE' })
      const data = await res.json()

      if (data.ok) {
        mutateDrafts()
        alert('已刪除')
      } else {
        setError(data.error || '刪除失敗')
      }
    } catch (err) {
      setError('刪除失敗')
    }
  }

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
        // Create customer object immediately
        const newCustomer: Customer = {
          id: data.data.id,
          customer_code: data.data.customer_code,
          customer_name: data.data.customer_name,
          phone: data.data.phone,
          is_active: true,
          store_credit: 0,
          credit_limit: 0,
          loyalty_points: 0,
        }

        // Select the newly created customer
        setSelectedCustomer(newCustomer)
        setCustomerSearchQuery('')

        // Refresh customers list in background
        mutateCustomers()

        // Clear form and close modal
        setNewCustomerName('')
        setNewCustomerPhone('')
        setShowQuickAddCustomer(false)

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

  // Quick add product
  const openQuickAddProduct = () => {
    setQuickProductName(searchQuery)
    setQuickProductBarcode('')
    setQuickProductPrice('')
    setDuplicateWarning(null)
    setShowQuickAddProduct(true)
  }

  const checkDuplicateProductName = (name: string) => {
    if (!name.trim()) {
      setDuplicateWarning(null)
      return
    }
    const duplicate = products.find(p =>
      p.name.toLowerCase() === name.trim().toLowerCase()
    )
    if (duplicate) {
      setDuplicateWarning(`已存在同名商品「${duplicate.name}」(${duplicate.item_code})`)
    } else {
      setDuplicateWarning(null)
    }
  }

  const handleQuickAddProduct = async () => {
    if (!quickProductName.trim()) {
      alert('請輸入商品名稱')
      return
    }

    // 再次確認重複
    const duplicate = products.find(p =>
      p.name.toLowerCase() === quickProductName.trim().toLowerCase()
    )
    if (duplicate) {
      if (!confirm(`已存在同名商品「${duplicate.name}」(${duplicate.item_code})，確定要繼續建立嗎？`)) {
        return
      }
    }

    setAddingProduct(true)

    try {
      const res = await fetch('/api/products/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: quickProductName.trim(),
          barcode: quickProductBarcode.trim() || null,
          price: parseFloat(quickProductPrice) || 0,
        }),
      })

      const data = await res.json()

      if (data.ok) {
        const newProduct: Product = data.data

        // 加入購物車
        addToCart(newProduct, 1)

        // 重新載入商品列表
        mutateProducts()

        // 清空並關閉
        setQuickProductName('')
        setQuickProductBarcode('')
        setQuickProductPrice('')
        setShowQuickAddProduct(false)
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

  // Toggle pin/unpin product
  const togglePinProduct = (productId: string) => {
    setPinnedProductIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(productId)) {
        newSet.delete(productId)
      } else {
        newSet.add(productId)
      }
      // Save to localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem('pinnedProducts', JSON.stringify(Array.from(newSet)))
      }
      return newSet
    })
  }

  const filteredProducts = products
    .filter(p =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.item_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.barcode?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      const aIsPinned = pinnedProductIds.has(a.id)
      const bIsPinned = pinnedProductIds.has(b.id)
      if (aIsPinned && !bIsPinned) return -1
      if (!aIsPinned && bIsPinned) return 1
      return 0
    })

  const filteredCustomers = customers.filter(c =>
    c.customer_name.toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
    c.customer_code.toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
    c.phone?.toLowerCase().includes(customerSearchQuery.toLowerCase())
  )

  // 手機版渲染
  if (isMobile) {
    return (
      <MobilePOS
        cart={cart}
        setCart={setCart}
        products={products}
        customers={customers}
        paymentAccounts={paymentAccounts}
        selectedCustomer={selectedCustomer}
        setSelectedCustomer={setSelectedCustomer}
        paymentMethod={paymentMethod}
        setPaymentMethod={setPaymentMethod}
        isPaid={isPaid}
        setIsPaid={setIsPaid}
        loading={loading}
        error={error}
        finalTotal={finalTotal}
        discountAmount={discountAmount}
        storeCreditUsed={storeCreditUsed}
        useStoreCredit={useStoreCredit}
        setUseStoreCredit={setUseStoreCredit}
        handleCheckout={handleCheckout}
        addToCart={addToCart}
        removeFromCart={removeFromCart}
        updateQuantity={updateQuantity}
        toggleFreeGift={toggleFreeGift}
        toggleNotDelivered={toggleNotDelivered}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        note={note}
        setNote={setNote}
        drafts={drafts}
        handleSaveDraft={handleSaveDraft}
        handleLoadDraft={handleLoadDraft}
        handleDeleteDraft={handleDeleteDraft}
        businessDate={businessDate}
        alreadyClosed={alreadyClosed}
        closingStats={closingStats}
        fetchClosingStats={fetchClosingStats}
        handleClosing={handleClosing}
        setBusinessDate={async (date: string) => {
          setBusinessDate(date)
          await fetchClosingStats(date)
        }}
        fetchCustomers={mutateCustomers}
        fetchProducts={mutateProducts}
        printerStatus={printerStatus}
        connectPrinter={connectPrinter}
        disconnectPrinter={disconnectPrinter}
        printSerial={printSerial}
      />
    )
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: scrollbarStyles }} />
      <div className="h-screen bg-slate-900 flex flex-col overflow-hidden">
        {/* Header - 簡化配色 */}
        <div className={`border-b border-slate-700 px-6 py-3 flex items-center justify-between ${salesMode === 'live'
          ? 'bg-purple-900'
          : 'bg-slate-800'
          }`}>
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-white">
              收銀系統
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {/* 印表機連接按鈕 */}
            <button
              onClick={printerStatus === 'connected' ? disconnectPrinter : connectPrinter}
              disabled={printerStatus === 'connecting'}
              className={`font-medium px-3 py-2 rounded-lg transition-all text-sm ${
                printerStatus === 'connected'
                  ? 'bg-green-700 hover:bg-green-600 text-white'
                  : printerStatus === 'connecting'
                  ? 'bg-yellow-700 text-white cursor-wait'
                  : printerStatus === 'error'
                  ? 'bg-red-700 hover:bg-red-600 text-white'
                  : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
              }`}
              title={printerStatus === 'connected' ? '點擊斷開印表機' : '點擊選擇藍牙 COM port 連接印表機'}
            >
              {printerStatus === 'connected' ? '印表機已連接' : printerStatus === 'connecting' ? '連接中...' : printerStatus === 'error' ? '印表機錯誤' : '連接印表機'}
            </button>
            {printerStatus === 'connected' && (
              <button
                onClick={async () => {
                  const res = await fetch('/api/print/receipt-bytes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      sale_no: 'TEST-001',
                      payment_label: '測試',
                      is_paid: true,
                      total: 100,
                      discount_amount: 0,
                      items: [{ name: '測試商品 中文列印測試', quantity: 1, price: 100 }],
                    }),
                  })
                  if (!res.ok) { alert('取得列印資料失敗'); return }
                  const buf = await res.arrayBuffer()
                  const ok = await printSerial(new Uint8Array(buf))
                  if (!ok) alert('測試列印失敗，請重新連接印表機')
                }}
                className="font-medium px-3 py-2 rounded-lg transition-all text-sm bg-green-800 hover:bg-green-700 text-green-200"
              >
                測試列印
              </button>
            )}
            <button
              onClick={() => setShowDrafts(!showDrafts)}
              className="font-medium px-3 py-2 rounded-lg transition-all relative bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm"
            >
              暫存
              {drafts.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {drafts.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setShowTodaySales(!showTodaySales)}
              className="font-medium px-3 py-2 rounded-lg transition-all bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm"
            >
              交易記錄
            </button>
            <button
              onClick={() => {
                setShowClosingModal(true)
                fetchClosingStats()
              }}
              className="font-medium px-3 py-2 rounded-lg transition-all bg-emerald-600 hover:bg-emerald-500 text-white text-sm"
            >
              日結
            </button>
            <div className="text-sm ml-2 flex items-center gap-3">
              <span className="text-amber-400 font-medium" title="當前營業日（日結前的銷售都會記錄到這一天）">
                營業日：{businessDate}
              </span>
              <span className="text-slate-500">|</span>
              <span className="text-slate-400">
                {new Date().toLocaleString('zh-TW')}
              </span>
            </div>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left - 商品區 (2/3) */}
          <div className="flex-[2] flex flex-col bg-slate-800 p-3 overflow-hidden border-r border-slate-700">
            {/* 第一步：商品選擇 */}
            {!showCheckoutStep && (
              <>
                {/* Mode Toggle */}
                <div className="mb-3 flex gap-2">
                  <button
                    onClick={() => setInventoryMode('products')}
                    className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${inventoryMode === 'products'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                  >
                    商品庫
                  </button>
                  <button
                    onClick={() => setInventoryMode('ichiban')}
                    className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${inventoryMode === 'ichiban'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                  >
                    一番賞
                  </button>
                </div>
              </>
            )}

            {!showCheckoutStep && inventoryMode === 'products' && (
              <>
                <div className="mb-3 flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      const value = e.target.value
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
                    }}
                    placeholder="掃描或搜尋商品..."
                    className="flex-1 rounded-lg px-3 py-2.5 text-sm text-white bg-slate-700 border border-slate-600 focus:border-indigo-500 focus:outline-none placeholder-slate-400"
                  />
                  <button
                    onClick={() => setShowCameraScanner(true)}
                    className="px-3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors flex items-center gap-1"
                    title="相機掃描"
                  >
                    相機
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  <div className="grid grid-cols-3 gap-2">
                    {filteredProducts.map((product) => {
                      const isPinned = pinnedProductIds.has(product.id)
                      const isLowStock = product.stock <= 3 && product.stock > 0
                      const isNegativeStock = product.stock <= 0
                      return (
                        <button
                          key={product.id}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            togglePinProduct(product.id)
                          }}
                          className={`rounded-lg p-2.5 transition-all active:scale-95 flex flex-col min-h-[90px] relative ${isNegativeStock
                            ? 'bg-slate-700 hover:bg-slate-600 cursor-pointer border border-red-500/50'
                            : 'bg-slate-700 hover:bg-slate-600 cursor-pointer'
                            }`}
                          title={isPinned ? '右鍵取消固定' : '右鍵固定到最上面'}
                          onClick={() => {
                            addToCart(product, 1)
                          }}
                        >
                          {/* 標籤區 */}
                          <div className="absolute top-1.5 right-1.5 flex gap-1">
                            {isPinned && <span className="text-xs">已固定</span>}
                            {isLowStock && <span className="text-[10px] bg-amber-500 text-white px-1 rounded">低庫存</span>}
                          </div>
                          {/* 商品名 */}
                          <div className="text-xs text-slate-300 line-clamp-2 mb-auto pr-6">{product.name}</div>
                          {/* 價格 - 最大 */}
                          <div className="text-lg font-bold text-white mt-1">{formatCurrency(product.price)}</div>
                          {/* 庫存 - 小字 */}
                          <div className="text-[10px] text-slate-400">庫存 {product.stock}</div>
                        </button>
                      )
                    })}

                    {/* 找不到商品時顯示建立選項 */}
                    {searchQuery.trim() && filteredProducts.length === 0 && (
                      <div className="col-span-3 flex flex-col items-center justify-center py-8">
                        <div className="text-slate-400 mb-3">找不到「{searchQuery}」</div>
                        <button
                          onClick={openQuickAddProduct}
                          className="bg-green-600 hover:bg-green-700 text-white font-bold px-6 py-3 rounded-lg transition-all"
                        >
                          + 快速建立商品
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {!showCheckoutStep && inventoryMode === 'ichiban' && (
              <>
                <div className="mb-3">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      const value = e.target.value
                      setSearchQuery(value)

                      // 清除上次的定时器
                      if (scanTimeoutRef.current) {
                        clearTimeout(scanTimeoutRef.current)
                      }

                      // 设置新的定时器，扫描枪通常在100ms内完成输入
                      scanTimeoutRef.current = setTimeout(() => {
                        if (value.trim()) {
                          // 查找匹配的一番赏（精确匹配条码）
                          const matchedKuji = ichibanKujis.find(
                            kuji => kuji.barcode && kuji.barcode.toLowerCase() === value.toLowerCase()
                          )

                          if (matchedKuji) {
                            // 自动展开对应的一番赏
                            setExpandedKujiId(matchedKuji.id)
                            // 清空搜索框
                            setSearchQuery('')
                          }
                        }
                      }, 100)
                    }}
                    placeholder="掃描條碼或搜尋一番賞"
                    className="w-full border-2 border-gray-400 dark:border-gray-600 rounded px-3 py-2 text-sm text-black dark:text-gray-100 bg-white dark:bg-gray-700 focus:border-teal-500 dark:focus:border-teal-400 focus:outline-none"
                  />
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  <div className="grid grid-cols-3 gap-2">
                    {!expandedKujiId ? (
                      // 顯示一番賞系列
                      <>
                        {ichibanKujis
                          .filter((kuji) => {
                            const searchLower = searchQuery.toLowerCase()
                            return kuji.name.toLowerCase().includes(searchLower) ||
                              (kuji.barcode && kuji.barcode.toLowerCase().includes(searchLower))
                          })
                          .map((kuji) => {
                            const totalRemaining = (kuji.ichiban_kuji_prizes || []).reduce(
                              (sum: number, prize: any) => sum + prize.remaining,
                              0
                            )
                            const prizeCount = (kuji.ichiban_kuji_prizes || []).length

                            return (
                              <button
                                key={kuji.id}
                                onClick={() => setExpandedKujiId(kuji.id)}
                                className="rounded p-4 shadow hover:shadow-md transition-all active:scale-95 flex flex-col items-center justify-center min-h-[120px] border-2 bg-teal-200 hover:bg-teal-300 border-teal-400 dark:bg-teal-900 dark:hover:bg-teal-800 dark:border-teal-700"
                              >
                                <div className="text-lg font-bold mb-2 text-center text-teal-950 dark:text-teal-100">
                                  {kuji.name}
                                </div>
                                <div className="text-sm text-teal-800 dark:text-teal-300 mb-1">
                                  賞品數: {prizeCount}
                                </div>
                                <div className="text-sm text-teal-800 dark:text-teal-300">
                                  剩餘總數: {totalRemaining}
                                </div>
                              </button>
                            )
                          })}
                        {ichibanKujis.filter((kuji) => {
                          const searchLower = searchQuery.toLowerCase()
                          return kuji.name.toLowerCase().includes(searchLower) ||
                            (kuji.barcode && kuji.barcode.toLowerCase().includes(searchLower))
                        }).length === 0 && (
                            <div className="col-span-3 text-center text-gray-500 dark:text-gray-400 py-10">
                              <div className="text-4xl mb-2"></div>
                              <div>{searchQuery ? '找不到相關的一番賞' : '目前沒有一番賞'}</div>
                            </div>
                          )}
                      </>
                    ) : (
                      // 顯示選中系列的賞品
                      <>
                        {(() => {
                          const selectedKuji = ichibanKujis.find(k => k.id === expandedKujiId)
                          if (!selectedKuji) return null

                          return (
                            <>
                              {/* 返回按鈕 */}
                              <div className="col-span-3">
                                <button
                                  onClick={() => setExpandedKujiId(null)}
                                  className="flex items-center gap-2 px-4 py-2 bg-teal-200 hover:bg-teal-300 dark:bg-teal-900 dark:hover:bg-teal-800 rounded text-teal-950 dark:text-teal-100 font-medium transition-colors"
                                >
                                  <span>←</span>
                                  <span>{selectedKuji.name}</span>
                                </button>
                              </div>

                              {/* 賞品列表 */}
                              {(selectedKuji.ichiban_kuji_prizes || []).map((prize: any) => {
                                const options = prize.ichiban_kuji_prize_options || []
                                const isSelection = options.length > 0
                                return (
                                  <button
                                    key={prize.id}
                                    onClick={() => addIchibanPrize(selectedKuji, prize)}
                                    disabled={prize.remaining <= 0}
                                    className={`rounded p-3 shadow hover:shadow-md transition-all active:scale-95 flex flex-col items-center justify-center min-h-[100px] border-2 ${prize.remaining <= 0
                                      ? 'bg-gray-300 dark:bg-gray-700 border-gray-400 dark:border-gray-600 text-gray-500 cursor-not-allowed opacity-50'
                                      : isSelection
                                        ? 'bg-violet-700 hover:bg-violet-800 text-white border-violet-800'
                                        : 'bg-teal-700 hover:bg-teal-800 text-white border-teal-800'
                                      }`}
                                  >
                                    <div className="text-xs font-bold mb-1 text-center px-2 py-0.5 bg-white/20 rounded">
                                      {prize.prize_tier}
                                      {isSelection && <span className="ml-1">{options.length}選1</span>}
                                    </div>
                                    <div className="text-sm font-bold text-center mb-1 line-clamp-2">
                                      {isSelection ? '複選獎' : (prize.products?.name || prize.prize_name || prize.prize_tier)}
                                    </div>
                                    <div className="text-lg font-bold">{formatCurrency(selectedKuji.price || 0)}</div>
                                    <div className="text-xs mt-1">剩餘: {prize.remaining}</div>
                                  </button>
                                )
                              })}
                            </>
                          )
                        })()}
                      </>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* 第二步：付款方式選擇 */}
            {showCheckoutStep && (
              <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
                {/* 付款方式標題 + 已收款 Toggle */}
                <div className="flex items-center justify-between mb-3">
                  <label className="block font-medium text-sm text-slate-300">付款方式</label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">已收款</span>
                    <button
                      onClick={() => setIsPaid(!isPaid)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        isPaid ? 'bg-indigo-600' : 'bg-slate-600'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          isPaid ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* 付款方式網格 - 大區塊 */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {paymentAccounts.map((account) => (
                    <button
                      key={account.id}
                      onClick={() => setPaymentMethod(account.payment_method_code as PaymentMethod)}
                      className={`py-4 px-3 rounded-lg font-semibold text-sm transition-all ${
                        paymentMethod === account.payment_method_code
                          ? 'bg-indigo-600 text-white shadow-lg'
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      {(account.display_name || account.account_name).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')}
                    </button>
                  ))}
                </div>

                {/* 收款計算區 */}
                <div className="bg-slate-700/50 rounded-lg p-3 mb-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-400">應收</label>
                    <span className="text-sm font-bold text-white">{formatCurrency(finalTotal)}</span>
                  </div>
                  <input
                    type="number"
                    value={receivedAmount}
                    onChange={(e) => setReceivedAmount(e.target.value)}
                    placeholder="收多少"
                    className="w-full border-2 border-slate-600 rounded-lg px-3 py-2 text-base text-white bg-slate-600 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none text-right font-semibold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  {receivedAmount && parseFloat(receivedAmount) > 0 && (
                    <div className="border-t border-slate-600 pt-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-400">應找</span>
                        <span className={`text-sm font-bold ${parseFloat(receivedAmount) >= finalTotal ? 'text-green-400' : 'text-red-400'}`}>
                          {formatCurrency(Math.max(0, parseFloat(receivedAmount) - finalTotal))}
                        </span>
                      </div>
                      {parseFloat(receivedAmount) < finalTotal && (
                        <div className="text-xs text-red-400 text-right">
                          還差 {formatCurrency(finalTotal - parseFloat(receivedAmount))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 多元付款按鈕 */}
                {!isMultiPayment && (
                  <button
                    onClick={() => {
                      setIsMultiPayment(true)
                      setMultiPayments([{ method: paymentMethod as PaymentMethod, amount: String(finalTotal) }])
                    }}
                    className="w-full py-2 text-xs text-slate-400 hover:text-white border border-dashed border-slate-500 rounded hover:border-slate-400 transition-colors mb-2"
                  >
                    + 切換多元付款
                  </button>
                )}

                {/* 多元付款列表 */}
                {isMultiPayment && (
                  <div className="space-y-2 p-3 bg-slate-700/50 rounded-lg border border-orange-500 mb-2">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium text-orange-400">多元付款模式</div>
                      <button
                        onClick={() => {
                          setIsMultiPayment(false)
                          setMultiPayments([{ method: 'cash', amount: '' }])
                        }}
                        className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-600 hover:bg-slate-500 transition-colors"
                      >
                        返回
                      </button>
                    </div>
                    {multiPayments.map((payment, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <select
                          value={payment.method}
                          onChange={(e) => {
                            const updated = [...multiPayments]
                            updated[index].method = e.target.value as PaymentMethod
                            setMultiPayments(updated)
                          }}
                          className="flex-1 rounded px-2 py-1.5 text-sm bg-slate-600 text-white border border-slate-500 focus:border-indigo-500 focus:outline-none"
                        >
                          {paymentAccounts.map((account) => (
                            <option key={account.id} value={account.payment_method_code as string}>
                              {account.display_name || account.account_name}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          value={payment.amount}
                          onChange={(e) => {
                            const updated = [...multiPayments]
                            updated[index].amount = e.target.value
                            setMultiPayments(updated)
                          }}
                          placeholder="金額"
                          className="w-24 rounded px-2 py-1.5 text-sm text-right bg-slate-600 text-white border border-slate-500 focus:border-indigo-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        {multiPayments.length > 1 && (
                          <button
                            onClick={() => {
                              setMultiPayments(multiPayments.filter((_, i) => i !== index))
                            }}
                            className="text-red-400 hover:text-red-300 px-1"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        setMultiPayments([...multiPayments, { method: 'cash', amount: '' }])
                      }}
                      className="w-full py-1.5 text-xs text-slate-400 hover:text-white border border-dashed border-slate-500 rounded hover:border-slate-400 transition-colors"
                    >
                      ＋ 新增付款方式
                    </button>
                  </div>
                )}

                {/* 收據選擇 */}
                <div className="flex gap-2 mt-auto">
                  <button
                    onClick={() => setReceiptType('receipt')}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                      receiptType === 'receipt'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    列印
                  </button>
                  <button
                    onClick={() => setReceiptType('none')}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                      receiptType === 'none'
                        ? 'bg-slate-600 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    不列印
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right - 結帳區 (1/3 - 側邊欄) */}
          <div className="flex-1 bg-slate-800 flex flex-col">
            {error && (
              <div className="bg-red-100 dark:bg-red-900 border-2 border-red-500 dark:border-red-600 text-red-700 dark:text-red-200 rounded-lg px-4 py-3 m-4 mb-0">
                {error}
              </div>
            )}

            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
              {/* STEP 1: 購物清單 + 折扣 + 備註 (當 !showCheckoutStep 時) */}
              {!showCheckoutStep && (
                <>
                  {/* Customer */}
                  <div className="relative">
                    <label className="block font-medium mb-1.5 text-sm text-slate-300">客戶</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          ref={customerInputRef}
                          type="text"
                          value={customerSearchQuery}
                          onChange={(e) => {
                            setCustomerSearchQuery(e.target.value)
                            setShowCustomerDropdown(true)
                          }}
                          onFocus={() => setShowCustomerDropdown(true)}
                          placeholder={selectedCustomer ? selectedCustomer.customer_name : '散客 (點擊搜尋)'}
                          className="w-full rounded-lg px-3 py-2 text-sm text-white bg-slate-700 border border-slate-600 focus:border-indigo-500 focus:outline-none"
                        />
                        {selectedCustomer && (
                          <button
                            onClick={() => {
                              setSelectedCustomer(null)
                              setCustomerSearchQuery('')
                            }}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-red-600 font-bold"
                          >
                            ×
                          </button>
                        )}

                        {/* Dropdown */}
                        {showCustomerDropdown && (
                          <div className="customer-dropdown absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border-2 border-gray-400 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto custom-scrollbar">
                            {/* 散客選項 */}
                            <button
                              onClick={() => {
                                setSelectedCustomer(null)
                                setCustomerSearchQuery('')
                                setShowCustomerDropdown(false)
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-black dark:text-gray-100 border-b border-gray-200 dark:border-gray-600"
                            >
                              <div className="font-bold">散客</div>
                              <div className="text-xs text-gray-500">不選擇客戶</div>
                            </button>

                            {/* 過濾後的客戶列表 */}
                            {filteredCustomers.map((customer) => (
                              <button
                                key={customer.id}
                                onClick={() => {
                                  setSelectedCustomer(customer)
                                  setCustomerSearchQuery('')
                                  setShowCustomerDropdown(false)
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-black dark:text-gray-100 border-b border-gray-200 dark:border-gray-600 last:border-b-0"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="font-bold">{customer.customer_name}</div>
                                  <div className={`text-sm font-semibold ${customer.store_credit >= 0
                                    ? 'text-green-600 dark:text-green-400'
                                    : 'text-red-600 dark:text-red-400'
                                    }`}>
                                    ${customer.store_credit?.toFixed(2) || '0.00'}
                                  </div>
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                  {customer.customer_code} {customer.phone && `• ${customer.phone}`}
                                </div>
                              </button>
                            ))}

                            {filteredCustomers.length === 0 && customerSearchQuery && (
                              <div className="px-3 py-4 text-center text-gray-500 dark:text-gray-400">
                                找不到客戶
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => setShowQuickAddCustomer(true)}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 py-2 rounded-lg text-lg transition-all flex items-center justify-center"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* 購物清單顯示 - 只在有商品時才顯示 */}
                  {cart.length > 0 && (
                    <div className="flex-1 overflow-hidden flex flex-col">
                      <label className="block font-medium text-sm text-slate-300 mb-2">
                        {cart.length} 項商品
                      </label>
                      <div className="flex-1 overflow-y-auto space-y-2">
                        {displayCart.map((item) => (
                          <div key={`display-${item.indices?.[0]}`} className="bg-slate-700 rounded p-3">
                            {/* 商品名 + 價格 + 數量控制 + 總價 + 刪除 */}
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex-1 min-w-0">
                                <div className="text-white font-medium text-xs line-clamp-1">
                                  {item.product.name}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-slate-400 text-xs">${item.price}</span>
                                
                                {/* 數量控制按鈕 */}
                                {!item.ichiban_kuji_id ? (
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => updateQuantity(item.indices![0], item.quantity - 1)}
                                      className="w-6 h-6 bg-slate-600 hover:bg-slate-500 rounded text-xs font-bold text-white"
                                    >
                                      −
                                    </button>
                                    <input
                                      type="number"
                                      min="1"
                                      value={item.quantity}
                                      onChange={(e) => {
                                        const newQty = parseInt(e.target.value) || 1
                                        if (newQty > 0) {
                                          updateQuantity(item.indices![0], newQty)
                                        }
                                      }}
                                      className="w-8 h-6 text-center text-xs bg-slate-600 text-white border border-slate-500 rounded focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    />
                                    <button
                                      onClick={() => updateQuantity(item.indices![0], item.quantity + 1)}
                                      className="w-6 h-6 bg-slate-600 hover:bg-slate-500 rounded text-xs font-bold text-white"
                                    >
                                      +
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-slate-400 text-xs">{item.quantity} 抽</span>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                <span className="text-emerald-400 font-bold text-sm">
                                  ${item.price * item.quantity}
                                </span>
                                <button
                                  onClick={() => {
                                    if (item.indices && item.indices.length > 0) {
                                      const sortedIndices = [...item.indices].sort((a, b) => b - a)
                                      sortedIndices.forEach(idx => {
                                        removeFromCart(cart[idx].product_id, idx)
                                      })
                                    }
                                  }}
                                  className="text-red-400 hover:text-red-300 font-bold text-lg"
                                >
                                  ×
                                </button>
                              </div>
                            </div>

                            {/* 贈品 + 未出貨複選框 */}
                            {!item.ichiban_kuji_id && (
                              <div className="flex items-center gap-3 mt-2">
                                <label className="flex items-center gap-1 cursor-pointer text-xs">
                                  <input
                                    type="checkbox"
                                    checked={cart[item.indices![0]]?.isFreeGift || false}
                                    onChange={() => toggleFreeGift(item.indices![0])}
                                    className="w-4 h-4"
                                  />
                                  <span className="text-slate-400">贈品</span>
                                </label>
                                <label className="flex items-center gap-1 cursor-pointer text-xs">
                                  <input
                                    type="checkbox"
                                    checked={cart[item.indices![0]]?.isNotDelivered || false}
                                    onChange={() => toggleNotDelivered(item.indices![0])}
                                    className="w-4 h-4"
                                  />
                                  <span className="text-slate-400">未出貨</span>
                                </label>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* STEP 2: 付款方式網格 (當 showCheckoutStep 時) */}
              {showCheckoutStep && (
                <>
                  {/* 訂單摘要 */}
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-slate-300">訂單摘要</h3>
                    <div className="bg-slate-700 rounded p-3 space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">小計</span>
                        <span className="text-white">{formatCurrency(subtotal)}</span>
                      </div>
                      {discountAmount > 0 && (
                        <div className="flex justify-between text-xs text-red-400">
                          <span>折扣</span>
                          <span>-{formatCurrency(discountAmount)}</span>
                        </div>
                      )}
                      <div className="border-t border-slate-600 pt-2 flex justify-between text-sm font-bold">
                        <span className="text-slate-300">應收</span>
                        <span className="text-white">{formatCurrency(finalTotal)}</span>
                      </div>
                    </div>
                  </div>

                  {/* 折扣 + 備註 */}
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => {
                          setDiscountType('percent')
                          setShowNoteInput(false)
                        }}
                        className={`py-2 rounded-lg font-bold text-xs border-2 transition-all ${
                          discountType === 'percent'
                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                            : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
                        }`}
                      >
                        % 折扣
                      </button>
                      <button
                        onClick={() => {
                          setDiscountType('amount')
                          setShowNoteInput(false)
                        }}
                        className={`py-2 rounded-lg font-bold text-xs border-2 transition-all ${
                          discountType === 'amount'
                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                            : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
                        }`}
                      >
                        $ 折扣
                      </button>
                      <button
                        onClick={() => {
                          setShowNoteInput(!showNoteInput)
                          setDiscountType('none')
                        }}
                        className={`py-2 rounded-lg font-bold text-xs border-2 transition-all ${
                          showNoteInput
                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                            : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
                        }`}
                      >
                        備註
                      </button>
                    </div>
                    {(discountType === 'percent' || discountType === 'amount') && (
                      <input
                        type="number"
                        value={discountValue}
                        onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)}
                        min="0"
                        max={discountType === 'percent' ? 100 : subtotal}
                        step={discountType === 'percent' ? 1 : 1}
                        className="w-full border-2 border-slate-500 rounded-lg px-3 py-2 text-sm text-white bg-slate-600 focus:border-indigo-500 focus:outline-none"
                        placeholder={discountType === 'percent' ? '折扣 %' : '折扣金額'}
                      />
                    )}
                    {showNoteInput && (
                      <input
                        type="text"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="輸入訂單備註..."
                        className="w-full border-2 border-slate-600 rounded-lg px-3 py-2 text-sm text-white bg-slate-700 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                      />
                    )}
                  </div>
                </>
              )}
            </div>



            {/* 應收金額顯示 (第二步時) */}
            {showCheckoutStep && (
              <div className="px-3 py-2 border-t border-slate-700">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">應收</span>
                  <span className="text-lg font-bold text-white">{formatCurrency(finalTotal)}</span>
                </div>
              </div>
            )}

            {/* Checkout Button - Fixed at bottom */}
            <div className="p-3 border-t border-slate-700 bg-slate-800">
              {!showCheckoutStep && (
                <>
                  {/* 應收金額顯示 (第一步時) */}
                  <div className="flex items-center justify-between mb-3 px-2 py-1">
                    <span className="text-xs font-medium text-slate-400">應收</span>
                    <span className="text-lg font-bold text-white">{formatCurrency(finalTotal)}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowCheckoutStep(true)}
                      disabled={cart.length === 0 || loading}
                      className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-600 text-white font-bold text-lg py-3 rounded-lg transition-all active:scale-[0.98] disabled:cursor-not-allowed"
                    >
                      {loading ? '處理中...' : '繼續 →'}
                    </button>
                    {cart.length > 0 && (
                      <button
                        onClick={handleSaveDraft}
                        disabled={loading}
                        className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-600 text-slate-300 font-medium py-3 rounded-lg transition-all"
                      >
                        暫存
                      </button>
                    )}
                  </div>
                </>
              )}

              {showCheckoutStep && (
                <>
                  <button
                    onClick={() => handleCheckout()}
                    disabled={loading || cart.length === 0}
                    className="w-full bg-green-600 hover:bg-green-500 disabled:bg-slate-600 text-white font-bold text-lg py-3 rounded-lg transition-all active:scale-[0.98] disabled:cursor-not-allowed mb-2"
                  >
                    {loading ? '處理中...' : '確認結帳'}
                  </button>
                  <button
                    onClick={() => setShowCheckoutStep(false)}
                    className="w-full bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium py-2 rounded-lg transition-all text-sm"
                  >
                    ← 返回編輯
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 支付方式選擇 Modal - 已廢棄，現在在第二步中顯示 */}
        {/* showPaymentSelection && showPaymentSelectionModal 已移除 */}

        {/* 結帳確認 Modal - 已廢棄，現在在右邊側邊欄内直接切換 */}
        {/* showCheckoutStep Modal 已移除 */}

        {/* Draft Orders Sidebar */}
        {showDrafts && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center" onClick={() => setShowDrafts(false)}>
            <div className="bg-white dark:bg-gray-800 w-[600px] max-h-[80vh] rounded-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="bg-orange-500 text-white px-6 py-4 rounded-t-lg flex items-center justify-between">
                <h2 className="text-xl font-bold">暫存訂單</h2>
                <button onClick={() => setShowDrafts(false)} className="text-2xl hover:text-gray-200">×</button>
              </div>
              <div className="p-4 overflow-y-auto custom-scrollbar max-h-[calc(80vh-80px)]">
                {drafts.length === 0 ? (
                  <div className="text-center text-gray-500 dark:text-gray-400 py-10">
                    <div className="text-4xl mb-2"></div>
                    <div>目前沒有暫存訂單</div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {drafts.map((draft) => {
                      const draftSubtotal = draft.items.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0)
                      let draftDiscountAmount = 0
                      if (draft.discount_type === 'percent') {
                        draftDiscountAmount = (draftSubtotal * draft.discount_value) / 100
                      } else if (draft.discount_type === 'amount') {
                        draftDiscountAmount = draft.discount_value
                      }
                      const draftTotal = Math.max(0, draftSubtotal - draftDiscountAmount)

                      return (
                        <div key={draft.id} className="border-2 border-gray-300 dark:border-gray-600 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-700">
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <div className="font-bold text-black dark:text-gray-100">
                                {draft.customers?.customer_name || '散客'}
                              </div>
                              <div className="text-sm text-gray-600 dark:text-gray-400">
                                {new Date(draft.created_at).toLocaleString('zh-TW')}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xl font-bold text-black dark:text-gray-100">{formatCurrency(draftTotal)}</div>
                              <div className="text-sm text-gray-600 dark:text-gray-400">{draft.items.length} 項商品</div>
                            </div>
                          </div>
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={() => handleLoadDraft(draft)}
                              className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 rounded-lg transition-all"
                            >
                              載入
                            </button>
                            <button
                              onClick={() => handleDeleteDraft(draft.id)}
                              className="bg-red-500 hover:bg-red-600 text-white font-bold px-4 py-2 rounded-lg transition-all"
                            >
                              刪除
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Today's Sales Sidebar */}
        {showTodaySales && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center" onClick={() => setShowTodaySales(false)}>
            <div className="bg-white dark:bg-gray-800 w-[600px] max-h-[80vh] rounded-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className={`text-white px-6 py-4 rounded-t-lg flex items-center justify-between ${salesMode === 'live' ? 'bg-pink-600' : 'bg-blue-500'
                }`}>
                <h2 className="text-xl font-bold">
                  今日交易 - {salesMode === 'live' ? '直播模式' : '店裡模式'}
                </h2>
                <button onClick={() => setShowTodaySales(false)} className="text-2xl hover:text-gray-200">×</button>
              </div>
              <div className="p-4 overflow-y-auto custom-scrollbar max-h-[calc(80vh-80px)]">
                {todaySales.length === 0 ? (
                  <div className="text-center text-gray-500 dark:text-gray-400 py-10">
                    <div className="text-4xl mb-2"></div>
                    <div>今天還沒有交易記錄</div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {todaySales.map((sale) => (
                      <div key={sale.id} className="border-2 border-gray-300 dark:border-gray-600 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-700">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <div className="font-bold text-black dark:text-gray-100">{sale.sale_no}</div>
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                              {sale.customers?.customer_name || '散客'}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-500">
                              {new Date(sale.created_at).toLocaleString('zh-TW')}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xl font-bold text-black dark:text-gray-100">{formatCurrency(sale.total)}</div>
                            <div className={`text-sm ${sale.is_paid ? 'text-green-600' : 'text-red-600'}`}>
                              {sale.is_paid ? '已收款' : '未收款'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Quick Add Customer Modal */}
        {showQuickAddCustomer && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center" onClick={() => setShowQuickAddCustomer(false)}>
            <div className="bg-white dark:bg-gray-800 w-[500px] rounded-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="bg-green-500 text-white px-6 py-4 rounded-t-lg flex items-center justify-between">
                <h2 className="text-xl font-bold">快速建立客戶</h2>
                <button onClick={() => setShowQuickAddCustomer(false)} className="text-2xl hover:text-gray-200">×</button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block font-bold mb-2 text-black dark:text-gray-100">
                    客戶名稱 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        phoneInputRef.current?.focus()
                      }
                    }}
                    placeholder="請輸入客戶名稱"
                    className="w-full border-2 border-gray-400 dark:border-gray-600 rounded-lg px-4 py-3 text-lg text-black dark:text-gray-100 bg-white dark:bg-gray-700 focus:border-black dark:focus:border-blue-500 focus:outline-none"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block font-bold mb-2 text-black dark:text-gray-100">
                    客戶電話 <span className="text-red-500">*</span>
                  </label>
                  <input
                    ref={phoneInputRef}
                    type="tel"
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !addingCustomer) {
                        handleQuickAddCustomer()
                      }
                    }}
                    placeholder="請輸入客戶電話"
                    className="w-full border-2 border-gray-400 dark:border-gray-600 rounded-lg px-4 py-3 text-lg text-black dark:text-gray-100 bg-white dark:bg-gray-700 focus:border-black dark:focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleQuickAddCustomer}
                    disabled={addingCustomer}
                    className="flex-1 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white font-bold py-3 rounded-lg transition-all"
                  >
                    {addingCustomer ? '建立中...' : '建立客戶'}
                  </button>
                  <button
                    onClick={() => setShowQuickAddCustomer(false)}
                    className="flex-1 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 text-black dark:text-gray-100 font-bold py-3 rounded-lg transition-all"
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Quick Add Product Modal */}
        {showQuickAddProduct && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center" onClick={() => setShowQuickAddProduct(false)}>
            <div className="bg-white dark:bg-gray-800 w-[500px] rounded-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="bg-indigo-600 text-white px-6 py-4 rounded-t-lg flex items-center justify-between">
                <h2 className="text-xl font-bold">快速建立商品</h2>
                <button onClick={() => setShowQuickAddProduct(false)} className="text-2xl hover:text-gray-200">×</button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block font-bold mb-2 text-black dark:text-gray-100">
                    商品名稱 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={quickProductName}
                    onChange={(e) => {
                      setQuickProductName(e.target.value)
                      checkDuplicateProductName(e.target.value)
                    }}
                    placeholder="請輸入商品名稱"
                    className="w-full border-2 border-gray-400 dark:border-gray-600 rounded-lg px-4 py-3 text-lg text-black dark:text-gray-100 bg-white dark:bg-gray-700 focus:border-indigo-500 focus:outline-none"
                    autoFocus
                  />
                  {duplicateWarning && (
                    <div className="mt-2 text-amber-600 dark:text-amber-400 text-sm font-medium">
                      ⚠️ {duplicateWarning}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block font-bold mb-2 text-black dark:text-gray-100">
                    條碼（選填）
                  </label>
                  <input
                    type="text"
                    value={quickProductBarcode}
                    onChange={(e) => setQuickProductBarcode(e.target.value)}
                    placeholder="請輸入條碼"
                    className="w-full border-2 border-gray-400 dark:border-gray-600 rounded-lg px-4 py-3 text-lg text-black dark:text-gray-100 bg-white dark:bg-gray-700 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-2 text-black dark:text-gray-100">
                    售價（選填）
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
                    placeholder="0"
                    min="0"
                    className="w-full border-2 border-gray-400 dark:border-gray-600 rounded-lg px-4 py-3 text-lg text-black dark:text-gray-100 bg-white dark:bg-gray-700 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleQuickAddProduct}
                    disabled={addingProduct}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-bold py-3 rounded-lg transition-all"
                  >
                    {addingProduct ? '建立中...' : '建立並加入購物車'}
                  </button>
                  <button
                    onClick={() => setShowQuickAddProduct(false)}
                    className="flex-1 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 text-black dark:text-gray-100 font-bold py-3 rounded-lg transition-all"
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Quantity Input Modal */}
        {showQuantityModal && quantityModalProduct && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center" onClick={closeQuantityModal}>
            <div className="bg-white dark:bg-gray-800 w-[400px] rounded-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="bg-blue-600 text-white px-6 py-4 rounded-t-lg flex items-center justify-between">
                <h2 className="text-xl font-bold">輸入數量</h2>
                <button onClick={closeQuantityModal} className="text-2xl hover:text-gray-200">×</button>
              </div>
              <form onSubmit={handleQuantitySubmit} className="p-6 space-y-4">
                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                  <div className="font-bold text-lg text-center text-gray-900 dark:text-gray-100 mb-2">
                    {quantityModalProduct.name}
                  </div>
                  <div className="text-center text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {formatCurrency(quantityModalProduct.price)}
                  </div>
                  <div className="text-center text-sm text-gray-600 dark:text-gray-400 mt-2">
                    庫存: {quantityModalProduct.stock}
                  </div>
                </div>

                <div>
                  <label className="block font-bold mb-2 text-black dark:text-gray-100">
                    數量 <span className="text-red-500">*</span>
                  </label>
                  <input
                    ref={quantityInputRef}
                    type="number"
                    min="1"
                    step="1"
                    value={quantityInput}
                    onChange={(e) => setQuantityInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleQuantitySubmit(e)
                      }
                    }}
                    className="w-full text-center text-3xl font-bold border-2 border-gray-400 dark:border-gray-600 rounded-lg px-4 py-4 text-black dark:text-gray-100 bg-white dark:bg-gray-700 focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none"
                    placeholder="請輸入數量"
                  />
                </div>

                {/* Quick number buttons */}
                <div className="grid grid-cols-4 gap-2">
                  {[1, 5, 10, 20, 50, 100].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setQuantityInput(String(num))}
                      className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-black dark:text-gray-100 font-bold py-2 rounded-lg transition-all"
                    >
                      {num}
                    </button>
                  ))}
                </div>

                <div className="flex gap-3">
                  <button
                    type="submit"
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg transition-all text-lg"
                  >
                    確認加入
                  </button>
                  <button
                    type="button"
                    onClick={closeQuantityModal}
                    className="flex-1 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 text-black dark:text-gray-100 font-bold py-3 rounded-lg transition-all"
                  >
                    取消
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Business Day Closing Modal (日結對話框) */}
        {showClosingModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={() => setShowClosingModal(false)}>
            <div className="bg-white dark:bg-gray-800 w-full max-w-2xl rounded-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="bg-gradient-to-r from-green-600 to-green-700 text-white px-6 py-4 rounded-t-lg">
                <h2 className="text-2xl font-bold">營業日結算</h2>
              </div>
              {!closingStats ? (
                <div className="p-12 text-center text-gray-500 dark:text-gray-400">載入中...</div>
              ) : (
                <>

                  <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                    {/* 日期選擇 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        營業日期
                      </label>
                      <input
                        type="date"
                        value={businessDate}
                        onChange={async (e) => {
                          const newDate = e.target.value
                          setBusinessDate(newDate)
                          await fetchClosingStats(newDate)
                        }}
                        className="w-full border dark:border-gray-600 rounded-lg px-4 py-2 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    {/* 已日結警告 */}
                    {alreadyClosed && (
                      <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-700 rounded-lg p-4">
                        <div className="text-red-800 dark:text-red-300 font-semibold">
                          {businessDate} 已經日結過了，無法重複日結
                        </div>
                      </div>
                    )}

                    {/* 統計摘要 */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
                        <div className="text-sm font-medium text-blue-800 dark:text-blue-400 mb-1">
                          總銷售筆數
                        </div>
                        <div className="text-2xl font-bold text-blue-600 dark:text-blue-300">
                          {closingStats.sales_count} 筆
                        </div>
                      </div>
                      <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                        <div className="text-sm font-medium text-green-800 dark:text-green-400 mb-1">
                          原始營業額
                        </div>
                        <div className="text-2xl font-bold text-green-600 dark:text-green-300">
                          {formatCurrency((closingStats.total_sales || 0) + (closingStats.store_credit_used || 0))}
                        </div>
                        {(closingStats.store_credit_used || 0) > 0 && (
                          <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                            實收: {formatCurrency(closingStats.total_sales || 0)}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 購物金資訊 */}
                    {((closingStats.store_credit_used || 0) > 0 || (closingStats.store_credit_granted || 0) > 0) && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4 border-2 border-orange-200 dark:border-orange-700">
                          <div className="text-sm font-medium text-orange-800 dark:text-orange-400 mb-1">
                            購物金折抵
                          </div>
                          <div className="text-xl font-bold text-orange-600 dark:text-orange-300">
                            {formatCurrency(closingStats.store_credit_used || 0)}
                          </div>
                        </div>
                        <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border-2 border-purple-200 dark:border-purple-700">
                          <div className="text-sm font-medium text-purple-800 dark:text-purple-400 mb-1">
                            購物金轉出
                          </div>
                          <div className="text-xl font-bold text-purple-600 dark:text-purple-300">
                            {formatCurrency(closingStats.store_credit_granted || 0)}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 已收款 vs 未收款 */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-4 border-2 border-emerald-200 dark:border-emerald-700">
                        <div className="text-sm font-medium text-emerald-800 dark:text-emerald-400 mb-1">
                          已收款
                        </div>
                        <div className="text-xl font-bold text-emerald-600 dark:text-emerald-300">
                          {formatCurrency(closingStats.paid_sales || 0)}
                        </div>
                        <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                          {closingStats.paid_count || 0} 筆
                        </div>
                      </div>
                      <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4 border-2 border-orange-200 dark:border-orange-700">
                        <div className="text-sm font-medium text-orange-800 dark:text-orange-400 mb-1">
                          未收款
                        </div>
                        <div className="text-xl font-bold text-orange-600 dark:text-orange-300">
                          {formatCurrency(closingStats.unpaid_sales || 0)}
                        </div>
                        <div className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                          {closingStats.unpaid_count || 0} 筆
                        </div>
                      </div>
                    </div>

                    {/* 已收款明細（按帳戶分類） */}
                    <div className="border-t dark:border-gray-700 pt-4">
                      <h3 className="font-semibold text-lg mb-3 text-gray-900 dark:text-gray-100">已收款明細</h3>
                      {closingStats.sales_by_account && Object.keys(closingStats.sales_by_account).length > 0 ? (
                        <div className="grid grid-cols-2 gap-3">
                          {Object.entries(closingStats.sales_by_account as Record<string, number>).map(([accountId, amount]) => {
                            const isUntracked = accountId === '__untracked__'
                            const account = isUntracked ? null : rawPaymentAccounts.find((a: any) => a.id === accountId)
                            const label = isUntracked ? '其他／未入帳' : (account?.account_name || accountId)
                            return (
                              <div key={accountId} className={`flex justify-between items-center rounded px-4 py-2 border ${isUntracked ? 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600' : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700'}`}>
                                <span className={isUntracked ? 'text-gray-500 dark:text-gray-400' : 'text-emerald-700 dark:text-emerald-300'}>{label}</span>
                                <span className={`font-semibold ${isUntracked ? 'text-gray-700 dark:text-gray-300' : 'text-emerald-900 dark:text-emerald-100'}`}>
                                  {formatCurrency(amount)}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <p className="text-gray-400 dark:text-gray-500 text-sm">無已收款記錄</p>
                      )}
                    </div>

                    {/* 備註 */}
                    <div className="border-t dark:border-gray-700 pt-4">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        備註（選填）
                      </label>
                      <textarea
                        value={closingNote}
                        onChange={(e) => setClosingNote(e.target.value)}
                        placeholder="例如：早班、晚班、值班人員等..."
                        className="w-full border dark:border-gray-600 rounded-lg px-4 py-2 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:border-blue-500 focus:outline-none"
                        rows={3}
                      />
                    </div>
                  </div>

                  <div className="border-t dark:border-gray-700 px-6 py-4 flex gap-3">
                    <button
                      onClick={handleClosing}
                      disabled={closingInProgress || alreadyClosed}
                      className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-bold py-3 rounded-lg transition-all"
                    >
                      {closingInProgress ? '結算中...' : alreadyClosed ? '已日結' : '確認日結'}
                    </button>
                    <button
                      onClick={() => setShowClosingModal(false)}
                      disabled={closingInProgress}
                      className="flex-1 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 disabled:bg-gray-200 text-gray-900 dark:text-gray-100 font-bold py-3 rounded-lg transition-all"
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

      {/* 結帳成功 Toast */}
      {successToast && (
        <div
          className="fixed top-6 right-6 z-[100] animate-in slide-in-from-right duration-300"
          onClick={() => setSuccessToast(null)}
        >
          <div className="bg-emerald-600 text-white rounded-xl shadow-2xl p-5 min-w-[280px] cursor-pointer hover:bg-emerald-700 transition-colors">
            <div className="flex items-center gap-3 mb-3">
              <div className="text-2xl">✓</div>
              <div>
                <div className="font-bold text-lg">結帳成功</div>
                <div className="text-sm text-emerald-200">{successToast.saleNo}</div>
              </div>
            </div>
            <div className="space-y-1 text-sm border-t border-emerald-500 pt-3">
              <div className="flex justify-between">
                <span className="text-emerald-200">總計</span>
                <span className="font-bold">{formatCurrency(successToast.total)}</span>
              </div>
              {successToast.change > 0 && (
                <>
                  <div className="flex justify-between">
                    <span className="text-emerald-200">收款</span>
                    <span className="font-bold">{formatCurrency(successToast.received)}</span>
                  </div>
                  <div className="flex justify-between border-t border-emerald-500 pt-2 mt-2">
                    <span className="text-emerald-100 font-medium">找零</span>
                    <span className="font-bold text-xl text-yellow-300">{formatCurrency(successToast.change)}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 相機掃描 Modal */}
      <CameraScanner
        isOpen={showCameraScanner}
        onClose={() => setShowCameraScanner(false)}
        onScan={handleCameraScan}
      />

      {/* 複選獎選項彈窗 */}
      {selectionDialog && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={() => setSelectionDialog(null)}>
          <div
            className="mx-4 max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl bg-white dark:bg-gray-800 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-gray-200 dark:border-gray-700 px-5 py-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {selectionDialog.prize.prize_tier} - 選擇獎品
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                請從以下選項中選擇一個
              </p>
            </div>
            <div className="p-4 space-y-2">
              {selectionDialog.options.map((option: any) => (
                <button
                  key={option.id}
                  onClick={() => handleSelectOption(option)}
                  className="w-full rounded-lg border-2 border-violet-200 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/30 p-4 text-left hover:border-violet-500 dark:hover:border-violet-500 hover:bg-violet-100 dark:hover:bg-violet-900/50 transition-colors"
                >
                  <div className="font-semibold text-gray-900 dark:text-gray-100">
                    {option.products?.name || '未知商品'}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                    {option.products?.item_code}
                  </div>
                </button>
              ))}
            </div>
            <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-3 text-right">
              <button
                onClick={() => setSelectionDialog(null)}
                className="rounded px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
