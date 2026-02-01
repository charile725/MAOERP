'use client'

import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { formatCurrency, formatDate, formatDateTime, formatPaymentMethod } from '@/lib/utils'

// Portal Dropdown 組件
function PortalDropdown({
  trigger,
  children,
  isOpen,
  onClose
}: {
  trigger: React.ReactNode
  children: React.ReactNode
  isOpen: boolean
  onClose: () => void
}) {
  const triggerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.right + window.scrollX - 128, // 128 = w-32
      })
    }
  }, [isOpen])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose])

  return (
    <>
      <div ref={triggerRef}>{trigger}</div>
      {isOpen && typeof window !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'absolute', top: position.top, left: position.left }}
          className="w-32 rounded-lg bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700 z-[9999]"
        >
          {children}
        </div>,
        document.body
      )}
    </>
  )
}

type SaleItem = {
  id: string
  quantity: number
  price: number
  cost?: number
  snapshot_name: string
  product_id: string
  products: {
    item_code: string
    unit: string
  }
  is_delivered?: boolean
  delivered_quantity?: number
  store_credit_qty?: number
  store_credit_amount?: number
}

type Sale = {
  id: string
  sale_no: string
  customer_code: string | null
  sale_date: string
  source: string
  payment_method: string
  is_paid: boolean
  note: string | null
  subtotal?: number // 原始銷售額 (Gross Sales)
  discount_amount?: number // 折扣金額
  store_credit_used?: number // 使用的購物金
  total: number // 實收金額 (Net Collected)
  status: string
  fulfillment_status?: string | null
  created_at: string
  item_count?: number
  total_quantity?: number
  avg_price?: number
  profit?: number
  total_cost?: number
  sale_items?: SaleItem[]
  customers?: {
    customer_name: string
  } | null
}

type CustomerGroup = {
  customer_code: string | null
  customer_name: string
  sales: Sale[]
  total_pending: number
  pending_count: number
  total_revenue: number
  total_profit: number
}

type ProductStats = {
  product_name: string
  item_code: string
  total_quantity: number
  total_sales: number
  customer_purchases: {
    customer_name: string
    customer_code: string | null
    quantity: number
    sales_count: number
  }[]
}

// 計算品項的實際處理狀態
// 已處理 = 已出貨 OR 已轉購物金
const getItemResolvedStatus = (item: SaleItem) => {
  const deliveredQty = item.delivered_quantity || 0
  const storeCreditQty = item.store_credit_qty || 0
  const resolvedQty = deliveredQty + storeCreditQty
  return {
    isFullyResolved: resolvedQty >= item.quantity,
    isPartiallyResolved: resolvedQty > 0 && resolvedQty < item.quantity,
    resolvedQty,
    deliveredQty,
    storeCreditQty,
  }
}

// 計算訂單的實際處理狀態（考慮出貨和購物金轉換）
const getActualFulfillmentStatus = (sale: Sale): 'completed' | 'partial' | 'none' => {
  const items = sale.sale_items || []
  if (items.length === 0) return sale.fulfillment_status as any || 'none'

  let fullyResolvedCount = 0
  let partiallyResolvedCount = 0

  items.forEach(item => {
    const status = getItemResolvedStatus(item)
    if (status.isFullyResolved) {
      fullyResolvedCount++
    } else if (status.isPartiallyResolved) {
      partiallyResolvedCount++
    }
  })

  if (fullyResolvedCount === items.length) {
    return 'completed'
  } else if (fullyResolvedCount > 0 || partiallyResolvedCount > 0) {
    return 'partial'
  }
  return 'none'
}

// 取得處理狀態的顯示文字
const getFulfillmentLabel = (sale: Sale): { text: string, className: string } => {
  const status = getActualFulfillmentStatus(sale)
  const items = sale.sale_items || []

  // 檢查是否有轉購物金的品項
  const hasStoreCredit = items.some(item => (item.store_credit_qty || 0) > 0)

  if (status === 'completed') {
    if (hasStoreCredit) {
      return { text: '✓ 已全部處理', className: 'text-green-600 dark:text-green-400' }
    }
    return { text: '🚚 已出貨', className: 'text-blue-600 dark:text-blue-400' }
  } else if (status === 'partial') {
    if (hasStoreCredit) {
      return { text: '⚡ 部分處理', className: 'text-amber-600 dark:text-amber-400' }
    }
    return { text: '⚡ 部分出貨', className: 'text-amber-600 dark:text-amber-400' }
  }
  return { text: '• 待處理', className: 'text-gray-500 dark:text-gray-400' }
}

export default function SalesPage() {
  const [customerGroups, setCustomerGroups] = useState<CustomerGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set())
  const [expandedSales, setExpandedSales] = useState<Set<string>>(new Set())
  const [keyword, setKeyword] = useState('')
  const [productKeyword, setProductKeyword] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [delivering, setDelivering] = useState<string | null>(null)
  const [showUndeliveredOnly, setShowUndeliveredOnly] = useState(false)
  const [groupByCustomer, setGroupByCustomer] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<'all' | 'pos' | 'live'>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)
  const itemsPerPage = 50
  const [productStats, setProductStats] = useState<ProductStats | null>(null)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [batchDelivering, setBatchDelivering] = useState(false)
  const [selectedItemsDetails, setSelectedItemsDetails] = useState<SaleItem[]>([])
  const [itemQuantities, setItemQuantities] = useState<Map<string, number>>(new Map())
  const [showQuantityModal, setShowQuantityModal] = useState(false)

  // 銷貨更正 & 轉購物金相關狀態
  const [showCorrectionModal, setShowCorrectionModal] = useState(false)
  const [showStoreCreditModal, setShowStoreCreditModal] = useState(false)
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
  const [correctionItems, setCorrectionItems] = useState<{ sale_item_id: string; new_quantity: number; new_price?: number }[]>([])
  const [storeCreditAmount, setStoreCreditAmount] = useState<string>('')
  const [correcting, setCorrecting] = useState(false)
  const [convertingToStoreCredit, setConvertingToStoreCredit] = useState(false)
  const [convertingItemId, setConvertingItemId] = useState<string | null>(null)
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null)

  const toggleCustomer = (customerKey: string) => {
    const newExpanded = new Set(expandedCustomers)
    if (newExpanded.has(customerKey)) {
      newExpanded.delete(customerKey)
    } else {
      newExpanded.add(customerKey)
    }
    setExpandedCustomers(newExpanded)
  }

  const toggleSale = (id: string) => {
    const newExpanded = new Set(expandedSales)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedSales(newExpanded)
  }

  const fetchSales = async (page = 1) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (keyword) params.set('keyword', keyword)
      if (productKeyword) params.set('product_keyword', productKeyword)
      if (sourceFilter !== 'all') params.set('source', sourceFilter)
      if (groupByCustomer) params.set('group_by_customer', 'true') // 按客戶分組時不分頁
      params.set('page', page.toString())
      params.set('limit', itemsPerPage.toString())

      const res = await fetch(`/api/sales?${params}`)
      const data = await res.json()
      if (data.ok) {
        const allSales = data.data || []

        // 更新分頁信息
        if (data.pagination) {
          setTotalPages(data.pagination.totalPages)
          setTotalRecords(data.pagination.total)
          setCurrentPage(data.pagination.page)
        }

        // 計算商品統計（只在有商品關鍵字時）
        if (productKeyword && allSales.length > 0) {
          const stats: { [key: string]: ProductStats } = {}
          const customerMap: { [productKey: string]: { [customerKey: string]: { customer_name: string, customer_code: string | null, quantity: number, sales_count: number } } } = {}

          allSales.forEach((sale: Sale) => {
            if (sale.sale_items) {
              sale.sale_items.forEach((item: SaleItem) => {
                const productKey = `${item.product_id}`
                const customerKey = sale.customer_code || 'WALK_IN'
                const customerName = sale.customer_code ? (sale.customers?.customer_name || sale.customer_code) : '散客'

                // 初始化商品統計
                if (!stats[productKey]) {
                  stats[productKey] = {
                    product_name: item.snapshot_name,
                    item_code: item.products.item_code,
                    total_quantity: 0,
                    total_sales: 0,
                    customer_purchases: []
                  }
                  customerMap[productKey] = {}
                }

                // 累加總數量和總銷售額
                stats[productKey].total_quantity += item.quantity
                stats[productKey].total_sales += item.quantity * item.price

                // 累加客戶購買記錄
                if (!customerMap[productKey][customerKey]) {
                  customerMap[productKey][customerKey] = {
                    customer_name: customerName,
                    customer_code: sale.customer_code,
                    quantity: 0,
                    sales_count: 0
                  }
                }
                customerMap[productKey][customerKey].quantity += item.quantity
                customerMap[productKey][customerKey].sales_count += 1
              })
            }
          })

          // 轉換客戶購買記錄為陣列並排序
          Object.keys(stats).forEach(productKey => {
            stats[productKey].customer_purchases = Object.values(customerMap[productKey])
              .sort((a, b) => b.quantity - a.quantity)
          })

          // 取第一個商品的統計（如果搜尋結果有多個商品，顯示第一個）
          const firstProduct = Object.values(stats)[0]
          setProductStats(firstProduct || null)
        } else {
          setProductStats(null)
        }

        if (groupByCustomer) {
          // 按客戶分組
          const groups: { [key: string]: CustomerGroup } = {}

          allSales.forEach((sale: Sale) => {
            // 根据showUndeliveredOnly过滤（考慮出貨和購物金轉換）
            if (showUndeliveredOnly && getActualFulfillmentStatus(sale) === 'completed') {
              return // 只显示未處理完的
            }

            // 計算 Gross Sales（優先用 subtotal，否則從 sale_items 計算）
            const grossSales = sale.subtotal || sale.sale_items?.reduce((sum, item) =>
              sum + (item.price * item.quantity), 0) || 0

            // 計算這筆銷售的毛利（扣除已轉購物金的數量）
            const totalCost = sale.sale_items?.reduce((sum, item) => {
              const effectiveQty = item.quantity - (item.store_credit_qty || 0)
              return sum + (item.cost || 0) * effectiveQty
            }, 0) || 0
            const saleProfit = grossSales - totalCost
            sale.profit = saleProfit
            sale.total_cost = totalCost

            const key = sale.customer_code || 'WALK_IN'

            if (!groups[key]) {
              groups[key] = {
                customer_code: sale.customer_code,
                customer_name: sale.customer_code
                  ? (sale.customers?.customer_name || sale.customer_code)
                  : '散客',
                sales: [],
                total_pending: 0,
                pending_count: 0,
                total_revenue: 0,
                total_profit: 0
              }
            }

            groups[key].sales.push(sale)
            groups[key].total_revenue += grossSales // 使用 Gross Sales
            groups[key].total_profit += saleProfit

            // 统计待處理（考慮出貨和購物金轉換）
            if (getActualFulfillmentStatus(sale) !== 'completed') {
              groups[key].total_pending += sale.total
              groups[key].pending_count += 1
            }
          })

          setCustomerGroups(Object.values(groups))
        } else {
          // 不分组，直接显示列表，但根据showUndeliveredOnly过滤（考慮出貨和購物金轉換）
          const filteredSales = showUndeliveredOnly
            ? allSales.filter((s: Sale) => getActualFulfillmentStatus(s) !== 'completed')
            : allSales

          // 不分组情況，計算每筆銷售的毛利（扣除已轉購物金的數量）
          let totalRevenue = 0
          let totalProfit = 0
          const salesWithProfit = filteredSales.map((sale: Sale) => {
            // 計算 Gross Sales
            const grossSales = sale.subtotal || sale.sale_items?.reduce((sum: number, item: SaleItem) =>
              sum + (item.price * item.quantity), 0) || 0

            const totalCost = sale.sale_items?.reduce((sum: number, item: SaleItem) => {
              const effectiveQty = item.quantity - (item.store_credit_qty || 0)
              return sum + (item.cost || 0) * effectiveQty
            }, 0) || 0
            const saleProfit = grossSales - totalCost
            totalRevenue += grossSales // 使用 Gross Sales
            totalProfit += saleProfit
            return { ...sale, profit: saleProfit, total_cost: totalCost }
          })

          // 用单个组包装所有销售
          setCustomerGroups([{
            customer_code: null,
            customer_name: '所有銷售',
            sales: salesWithProfit,
            total_pending: 0,
            pending_count: 0,
            total_revenue: totalRevenue,
            total_profit: totalProfit
          }])
        }
      }
    } catch (err) {
      console.error('Failed to fetch sales:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSales(1) // 篩選條件變更時重置到第一頁
  }, [showUndeliveredOnly, groupByCustomer, sourceFilter])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchSales(1) // 搜尋時重置到第一頁
  }

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      fetchSales(newPage)
    }
  }

  const handleDelete = async (id: string, saleNo: string) => {
    setDeleting(id)
    try {
      const res = await fetch(`/api/sales/${id}`, {
        method: 'DELETE',
      })

      const data = await res.json()

      if (data.ok) {
        alert('刪除成功，庫存已回補')
        fetchSales()
      } else {
        alert(`刪除失敗：${data.error}`)
      }
    } catch (err) {
      alert('刪除失敗')
    } finally {
      setDeleting(null)
    }
  }

  const handleDeliverItem = async (item: SaleItem) => {
    const deliveredQty = item.delivered_quantity || 0
    const remainingQty = item.quantity - deliveredQty

    if (remainingQty <= 0) {
      alert('此商品已全部出貨')
      return
    }

    const qtyInput = prompt(`出貨數量（剩餘: ${remainingQty} ${item.products.unit}）：`, remainingQty.toString())

    if (qtyInput === null) {
      return // 用戶取消
    }

    const quantity = parseInt(qtyInput)

    if (isNaN(quantity) || quantity <= 0) {
      alert('請輸入有效的數量')
      return
    }

    if (quantity > remainingQty) {
      alert(`出貨數量不能超過剩餘數量（${remainingQty}）`)
      return
    }

    setDelivering(item.id)
    try {
      const res = await fetch('/api/sale-items/batch-deliver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{
            sale_item_id: item.id,
            quantity: quantity
          }]
        })
      })

      const data = await res.json()

      if (data.ok) {
        alert(data.message || '出貨成功！')
        fetchSales()
      } else {
        alert(`出貨失敗：${data.error}`)
      }
    } catch (err) {
      alert('出貨失敗')
    } finally {
      setDelivering(null)
    }
  }

  const handleBatchDeliver = () => {
    if (selectedItemIds.size === 0) {
      alert('請先選擇要出貨的商品')
      return
    }

    // 收集所有選中商品的詳細信息
    const items: SaleItem[] = []
    customerGroups.forEach(group => {
      group.sales.forEach(sale => {
        sale.sale_items?.forEach(item => {
          if (selectedItemIds.has(item.id)) {
            items.push(item)
          }
        })
      })
    })

    // 初始化每個商品的數量為其最大數量
    const newQuantities = new Map<string, number>()
    items.forEach(item => {
      newQuantities.set(item.id, item.quantity)
    })

    setSelectedItemsDetails(items)
    setItemQuantities(newQuantities)
    setShowQuantityModal(true)
  }

  const confirmBatchDeliver = async () => {
    // 計算總出貨數量
    const totalQty = Array.from(selectedItemIds).reduce((sum, id) => {
      return sum + (itemQuantities.get(id) || 0)
    }, 0)

    if (!confirm(`確定要批量出貨 ${selectedItemIds.size} 項商品（共 ${totalQty} 件）嗎？\n\n此操作將會扣除庫存。`)) {
      return
    }

    setBatchDelivering(true)
    try {
      // 構建包含數量的出貨項目陣列
      const items = Array.from(selectedItemIds).map(id => ({
        sale_item_id: id,
        quantity: itemQuantities.get(id) || 0
      }))

      const res = await fetch('/api/sale-items/batch-deliver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      })

      const data = await res.json()

      if (data.ok) {
        alert(data.message || '批量出貨成功！')
        setSelectedItemIds(new Set())
        setItemQuantities(new Map())
        setShowQuantityModal(false)
        fetchSales()
      } else {
        alert(`批量出貨失敗：${data.error}`)
      }
    } catch (err) {
      alert('批量出貨失敗')
    } finally {
      setBatchDelivering(false)
    }
  }

  // 開啟銷貨更正 Modal
  const openCorrectionModal = (sale: Sale) => {
    setSelectedSale(sale)
    // 初始化每個品項的更正數量為原始數量
    const items = sale.sale_items?.map(item => ({
      sale_item_id: item.id,
      new_quantity: item.quantity,
      new_price: item.price,
    })) || []
    setCorrectionItems(items)
    setShowCorrectionModal(true)
  }

  // 開啟轉購物金 Modal
  const openStoreCreditModal = (sale: Sale) => {
    setSelectedSale(sale)
    setStoreCreditAmount(sale.total.toString())
    setShowStoreCreditModal(true)
  }

  // 執行銷貨更正
  const handleCorrection = async () => {
    if (!selectedSale) return

    // 檢查是否有變更
    const hasChanges = correctionItems.some((item, index) => {
      const original = selectedSale.sale_items?.[index]
      return original && (item.new_quantity !== original.quantity || item.new_price !== original.price)
    })

    if (!hasChanges) {
      alert('沒有任何變更')
      return
    }

    if (!confirm('確定要執行銷貨更正嗎？此操作將會調整庫存和應收帳款。')) {
      return
    }

    setCorrecting(true)
    try {
      const res = await fetch(`/api/sales/${selectedSale.id}/correction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: correctionItems,
          note: '手動銷貨更正',
        }),
      })

      const data = await res.json()

      if (data.ok) {
        alert(`銷貨更正成功！\n\n原金額：${formatCurrency(data.data.original_total)}\n更正後：${formatCurrency(data.data.corrected_total)}\n差額：${formatCurrency(data.data.adjustment_amount)}\n回補庫存：${data.data.inventory_restored} 件`)
        setShowCorrectionModal(false)
        setSelectedSale(null)
        fetchSales()
      } else {
        alert(`更正失敗：${data.error}`)
      }
    } catch (err) {
      alert('更正失敗')
    } finally {
      setCorrecting(false)
    }
  }

  // 執行轉購物金
  const handleToStoreCredit = async () => {
    if (!selectedSale) return

    const amount = parseFloat(storeCreditAmount)
    if (isNaN(amount) || amount <= 0) {
      alert('請輸入有效的金額')
      return
    }

    if (amount > selectedSale.total) {
      alert(`金額不能超過銷售總額 ${formatCurrency(selectedSale.total)}`)
      return
    }

    if (!selectedSale.customer_code) {
      alert('此銷售單沒有關聯客戶，無法轉為購物金')
      return
    }

    if (!confirm(`確定要將 ${formatCurrency(amount)} 轉為客戶購物金嗎？\n\n此操作將會回補庫存並清除應收帳款。`)) {
      return
    }

    setConvertingToStoreCredit(true)
    try {
      const res = await fetch(`/api/sales/${selectedSale.id}/to-store-credit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amount,
          refund_inventory: true,
          note: '銷貨轉購物金',
        }),
      })

      const data = await res.json()

      if (data.ok) {
        alert(`轉購物金成功！\n\n客戶：${data.data.customer_name}\n轉換金額：${formatCurrency(data.data.conversion_amount)}\n購物金餘額：${formatCurrency(data.data.store_credit_before)} → ${formatCurrency(data.data.store_credit_after)}\n回補庫存：${data.data.inventory_restored} 件`)
        setShowStoreCreditModal(false)
        setSelectedSale(null)
        fetchSales()
      } else {
        alert(`轉換失敗：${data.error}`)
      }
    } catch (err) {
      alert('轉換失敗')
    } finally {
      setConvertingToStoreCredit(false)
    }
  }

  // 執行單品轉購物金（只適用於售價為 $0 的品項）
  const handleItemToStoreCredit = async (item: SaleItem, sale: Sale) => {
    if (!sale.customer_code) {
      alert('此銷售單沒有關聯客戶，無法轉為購物金')
      return
    }

    // 只允許售價為 0 的品項
    if (item.price !== 0) {
      alert('只有售價為 $0 的品項才能轉購物金')
      return
    }

    // 計算剩餘可轉換數量
    const alreadyConverted = item.store_credit_qty || 0
    const remainingConvertible = item.quantity - alreadyConverted

    if (remainingConvertible <= 0) {
      alert('此品項已全部轉換為購物金')
      return
    }

    // 步驟 1：先輸入數量
    const quantityInput = prompt(`將「${item.snapshot_name}」轉為購物金\n\n步驟 1/2：請輸入轉換數量\n（原數量：${item.quantity} 件，已轉：${alreadyConverted} 件，剩餘可轉：${remainingConvertible} 件）`, remainingConvertible.toString())

    if (quantityInput === null) {
      return // 用戶取消
    }

    const quantity = parseInt(quantityInput)
    if (isNaN(quantity) || quantity <= 0) {
      alert('請輸入有效的數量（正整數）')
      return
    }

    if (quantity > remainingConvertible) {
      alert(`轉換數量不能超過剩餘可轉數量（${remainingConvertible}）`)
      return
    }

    // 步驟 2：再輸入金額
    const amountInput = prompt(`將「${item.snapshot_name}」(${quantity} 件) 轉為購物金\n\n步驟 2/2：請輸入購物金金額\n（此金額將作為購物金及回補成本）`)

    if (amountInput === null) {
      return // 用戶取消
    }

    const amount = parseFloat(amountInput)
    if (isNaN(amount) || amount <= 0) {
      alert('請輸入有效的金額')
      return
    }

    const unitCost = amount / quantity
    if (!confirm(`確定要將 ${formatCurrency(amount)} 轉為購物金嗎？\n\n• 轉換數量：${quantity} / ${item.quantity} 件\n• 購物金增加：${formatCurrency(amount)}\n• 庫存回補：${quantity} 件\n• 回補成本：${formatCurrency(unitCost)}/件`)) {
      return
    }

    setConvertingItemId(item.id)
    try {
      const res = await fetch(`/api/sale-items/${item.id}/to-store-credit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amount,
          quantity: quantity,
          note: `單品轉購物金 - ${item.snapshot_name} (${quantity}/${item.quantity}件)`,
        }),
      })

      const data = await res.json()

      if (data.ok) {
        alert(`轉購物金成功！\n\n客戶：${data.data.customer_name}\n商品：${data.data.product_name}\n轉換數量：${data.data.converted_quantity} / ${data.data.original_quantity} 件\n購物金：${formatCurrency(data.data.store_credit_before)} → ${formatCurrency(data.data.store_credit_after)}\n回補庫存：${data.data.inventory_restored} 件\n新平均成本：${formatCurrency(data.data.new_avg_cost)}`)
        fetchSales()
      } else {
        alert(`轉換失敗：${data.error}`)
      }
    } catch (err) {
      alert('轉換失敗')
    } finally {
      setConvertingItemId(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">銷售記錄</h1>
        </div>

        {/* Search & Filters */}
        <div className="mb-6 rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
          <form onSubmit={handleSearch} className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜尋銷售單號或客戶名稱"
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
            <div className="space-y-3">
              <div className="flex gap-4 items-center">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={groupByCustomer}
                    onChange={(e) => setGroupByCustomer(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-gray-900 dark:text-gray-100">按客戶分組</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showUndeliveredOnly}
                    onChange={(e) => setShowUndeliveredOnly(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-gray-900 dark:text-gray-100">顯示未出貨</span>
                </label>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100">
                  銷售通路
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSourceFilter('all')}
                    className={`flex-1 rounded px-4 py-2 text-sm font-medium transition-colors ${sourceFilter === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                      }`}
                  >
                    全部
                  </button>
                  <button
                    type="button"
                    onClick={() => setSourceFilter('pos')}
                    className={`flex-1 rounded px-4 py-2 text-sm font-medium transition-colors ${sourceFilter === 'pos'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                      }`}
                  >
                    🏪 店裡
                  </button>
                  <button
                    type="button"
                    onClick={() => setSourceFilter('live')}
                    className={`flex-1 rounded px-4 py-2 text-sm font-medium transition-colors ${sourceFilter === 'live'
                      ? 'bg-pink-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                      }`}
                  >
                    📱 直播
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>

        {/* 商品統計卡片 */}
        {productStats && (
          <div className="rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 p-6 shadow-lg border border-blue-200 dark:border-blue-800">
            <div className="mb-4">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">
                📊 商品銷售統計
              </h3>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {productStats.item_code} - {productStats.product_name}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
                <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">總銷售數量</div>
                <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                  {productStats.total_quantity}
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
                <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">總銷售額</div>
                <div className="text-3xl font-bold text-green-600 dark:text-green-400">
                  {formatCurrency(productStats.total_sales)}
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                購買客戶明細（共 {productStats.customer_purchases.length} 位）
              </h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {productStats.customer_purchases.map((customer, index) => (
                  <div
                    key={`${customer.customer_code || 'WALK_IN'}-${index}`}
                    className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm"
                  >
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {customer.customer_name}
                      </div>
                      {customer.customer_code && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {customer.customer_code}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                        {customer.quantity} 個
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {customer.sales_count} 筆訂單
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="rounded-lg bg-white dark:bg-gray-800 shadow overflow-visible">
          {loading ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">載入中...</div>
          ) : customerGroups.length === 0 || customerGroups[0]?.sales.length === 0 ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">沒有銷售記錄</div>
          ) : groupByCustomer ? (
            // 分組视图
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {customerGroups.map((group) => {
                const isExpanded = expandedCustomers.has(group.customer_code || 'WALK_IN')

                return (
                  <div key={group.customer_code || 'WALK_IN'}>
                    {/* Customer Header */}
                    <div
                      className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                      onClick={() => toggleCustomer(group.customer_code || 'WALK_IN')}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-blue-600">
                          {isExpanded ? '▼' : '▶'}
                        </span>
                        <span className="font-semibold text-gray-900 dark:text-gray-100">
                          {group.customer_name}
                        </span>
                        {group.customer_code && (
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            ({group.customer_code})
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-sm text-gray-500 dark:text-gray-400">總毛利</div>
                          <div className={`text-lg font-bold ${group.total_profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {group.total_profit >= 0 ? '+' : ''}{formatCurrency(group.total_profit)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-gray-500 dark:text-gray-400">待出貨</div>
                          <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                            {formatCurrency(group.total_pending)}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {group.pending_count} 筆訂單
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Sales Details */}
                    {isExpanded && (
                      <div className="bg-gray-50 dark:bg-gray-900 px-4 pb-4">
                        <table className="w-full">
                          <thead className="border-b">
                            <tr>
                              <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">銷售單號</th>
                              <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">付款方式</th>
                              <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">銷售日期</th>
                              <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">總金額</th>
                              <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">毛利</th>
                              <th className="pb-2 text-center text-xs font-semibold text-gray-900 dark:text-gray-100">付款</th>
                              <th className="pb-2 text-center text-xs font-semibold text-gray-900 dark:text-gray-100">出貨</th>
                              <th className="pb-2 text-center text-xs font-semibold text-gray-900 dark:text-gray-100">操作</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {group.sales.map((sale) => (
                              <React.Fragment key={sale.id}>
                                <tr className="hover:bg-white dark:hover:bg-gray-800">
                                  <td className="py-2 text-sm text-gray-900 dark:text-gray-100">
                                    <div className="flex items-center gap-2 cursor-pointer" onClick={() => toggleSale(sale.id)}>
                                      <span className="text-blue-600">
                                        {expandedSales.has(sale.id) ? '▼' : '▶'}
                                      </span>
                                      {sale.sale_no}
                                      {sale.note && sale.note.trim() !== '' && (
                                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded" title={sale.note}>
                                          備註
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-2 text-sm text-gray-900 dark:text-gray-100">
                                    {formatPaymentMethod(sale.payment_method)}
                                  </td>
                                  <td className="py-2 text-sm text-gray-900 dark:text-gray-100">
                                    {formatDateTime(sale.created_at)}
                                  </td>
                                  <td className="py-2 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
                                    {formatCurrency(sale.total)}
                                  </td>
                                  <td className={`py-2 text-right text-sm font-semibold ${(sale.profit || 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {(sale.profit || 0) >= 0 ? '+' : ''}{formatCurrency(sale.profit || 0)}
                                  </td>
                                  <td className="py-2 text-center text-sm">
                                    <span
                                      className={`inline-flex items-center gap-1 text-xs ${sale.status === 'store_credit'
                                        ? 'text-purple-600 dark:text-purple-400'
                                        : sale.is_paid
                                          ? 'text-green-600 dark:text-green-400'
                                          : 'text-gray-500 dark:text-gray-400'
                                        }`}
                                    >
                                      {sale.status === 'store_credit' ? '💰 轉購物金' : sale.is_paid ? '✓ 已收' : '○ 未收'}
                                    </span>
                                  </td>
                                  <td className="py-2 text-center text-sm">
                                    {(() => {
                                      const label = getFulfillmentLabel(sale)
                                      return (
                                        <span className={`inline-flex items-center gap-1 text-xs ${label.className}`}>
                                          {label.text}
                                        </span>
                                      )
                                    })()}
                                  </td>
                                  <td className="py-2 text-center text-sm" onClick={(e) => e.stopPropagation()}>
                                    <PortalDropdown
                                      isOpen={openDropdownId === sale.id}
                                      onClose={() => setOpenDropdownId(null)}
                                      trigger={
                                        <button
                                          onClick={() => setOpenDropdownId(openDropdownId === sale.id ? null : sale.id)}
                                          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-lg font-bold"
                                          title="更多操作"
                                        >
                                          ⋯
                                        </button>
                                      }
                                    >
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setOpenDropdownId(null)
                                          openCorrectionModal(sale)
                                        }}
                                        className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-t-lg"
                                      >
                                        ✏️ 更正
                                      </button>
                                      {sale.customer_code && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            setOpenDropdownId(null)
                                            openStoreCreditModal(sale)
                                          }}
                                          className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                                        >
                                          💰 轉購物金
                                        </button>
                                      )}
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setOpenDropdownId(null)
                                          if (confirm(`確定要作廢銷售單 ${sale.sale_no} 嗎？\n\n此操作將會回補庫存，且無法復原。`)) {
                                            handleDelete(sale.id, sale.sale_no)
                                          }
                                        }}
                                        disabled={deleting === sale.id}
                                        className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-b-lg disabled:opacity-50"
                                      >
                                        {deleting === sale.id ? '處理中...' : '🗑️ 刪除'}
                                      </button>
                                    </PortalDropdown>
                                  </td>
                                </tr>
                                {expandedSales.has(sale.id) && sale.sale_items && (
                                  <tr key={`${sale.id}-items`}>
                                    <td colSpan={7} className="bg-white dark:bg-gray-800 py-2 px-4">
                                      {/* 備註顯示 */}
                                      {sale.note && sale.note.trim() !== '' && (
                                        <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                                          <div className="text-xs font-medium text-blue-800 dark:text-blue-200">
                                            📝 備註：{sale.note}
                                          </div>
                                        </div>
                                      )}
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">商品明細</div>
                                      </div>
                                      <table className="w-full text-xs">
                                        <thead className="border-b">
                                          <tr>
                                            <th className="pb-1 text-left text-gray-600 dark:text-gray-400">品號</th>
                                            <th className="pb-1 text-left text-gray-600 dark:text-gray-400">商品名稱</th>
                                            <th className="pb-1 text-right text-gray-600 dark:text-gray-400">訂單數量</th>
                                            <th className="pb-1 text-right text-gray-600 dark:text-gray-400">已出貨</th>
                                            <th className="pb-1 text-right text-gray-600 dark:text-gray-400">單價</th>
                                            <th className="pb-1 text-right text-gray-600 dark:text-gray-400">小計</th>
                                            <th className="pb-1 text-center text-gray-600 dark:text-gray-400">操作</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {sale.sale_items.map((item) => {
                                            const deliveredQty = item.delivered_quantity || 0
                                            const remainingQty = item.quantity - deliveredQty
                                            return (
                                              <tr key={item.id}>
                                                <td className="py-1 text-gray-700 dark:text-gray-300">{item.products.item_code}</td>
                                                <td className="py-1 text-gray-700 dark:text-gray-300">{item.snapshot_name}</td>
                                                <td className="py-1 text-right text-gray-700 dark:text-gray-300">
                                                  {item.quantity} {item.products.unit}
                                                </td>
                                                <td className="py-1 text-right">
                                                  <span
                                                    className={`font-medium ${item.is_delivered
                                                      ? 'text-green-600 dark:text-green-400'
                                                      : deliveredQty > 0
                                                        ? 'text-yellow-600 dark:text-yellow-400'
                                                        : 'text-gray-600 dark:text-gray-400'
                                                      }`}
                                                  >
                                                    {deliveredQty} / {item.quantity}
                                                  </span>
                                                </td>
                                                <td className="py-1 text-right text-gray-700 dark:text-gray-300">
                                                  {formatCurrency(item.price)}
                                                </td>
                                                <td className="py-1 text-right text-gray-700 dark:text-gray-300">
                                                  {formatCurrency(item.price * item.quantity)}
                                                </td>
                                                <td className="py-1 text-center">
                                                  <div className="flex items-center justify-center gap-1">
                                                    {!item.is_delivered && (
                                                      <button
                                                        onClick={() => handleDeliverItem(item)}
                                                        disabled={delivering === item.id}
                                                        className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white hover:bg-blue-700 disabled:bg-gray-400"
                                                      >
                                                        {delivering === item.id ? '處理中...' : '出貨'}
                                                      </button>
                                                    )}
                                                    {sale.customer_code && item.price === 0 && (() => {
                                                      const alreadyConverted = item.store_credit_qty || 0
                                                      const isFullyConverted = alreadyConverted >= item.quantity
                                                      const isPartiallyConverted = alreadyConverted > 0 && !isFullyConverted

                                                      if (isFullyConverted) {
                                                        return (
                                                          <span className="rounded bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs text-green-600 dark:text-green-400">
                                                            已轉購物金
                                                          </span>
                                                        )
                                                      }

                                                      return (
                                                        <>
                                                          {isPartiallyConverted && (
                                                            <span className="text-xs text-amber-600 dark:text-amber-400 mr-1">
                                                              已轉 {alreadyConverted}/{item.quantity}
                                                            </span>
                                                          )}
                                                          <button
                                                            onClick={() => handleItemToStoreCredit(item, sale)}
                                                            disabled={convertingItemId === item.id}
                                                            className="rounded px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 disabled:opacity-50"
                                                          >
                                                            {convertingItemId === item.id ? '處理中...' : '💰'}
                                                          </button>
                                                        </>
                                                      )
                                                    })()}
                                                  </div>
                                                </td>
                                              </tr>
                                            )
                                          })}
                                        </tbody>
                                      </table>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            // 原始列表视图
            <>
              {/* 分頁資訊 */}
              {customerGroups[0]?.sales && customerGroups[0].sales.length > 0 && (
                <div className="mb-4 flex items-center justify-between">
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    共 {totalRecords} 筆記錄
                    {totalRecords > itemsPerPage && (
                      <span> · 顯示第 {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, totalRecords)} 筆</span>
                    )}
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">銷售單號</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">客戶</th>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">總金額</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">商品摘要</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">付款方式</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">銷售日期</th>
                      <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">付款</th>
                      <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">出貨</th>
                      <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {(() => {
                      // 數據已經是服務器端分頁過的，直接使用
                      const paginatedSales = customerGroups[0]?.sales || []

                      return paginatedSales.map((sale) => (
                        <React.Fragment key={sale.id}>
                          <tr
                            className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                            onClick={() => toggleSale(sale.id)}
                          >
                            <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">
                              <div className="flex items-center gap-2">
                                <span className="text-gray-400 text-xs">
                                  {expandedSales.has(sale.id) ? '▾' : '▸'}
                                </span>
                                {sale.sale_no}
                                {sale.note && sale.note.trim() !== '' && (
                                  <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded" title={sale.note}>
                                    備註
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                              {sale.customers?.customer_name || '散客'}
                            </td>
                            <td className={`px-6 py-4 text-right text-lg font-semibold ${sale.total > 0
                              ? 'text-gray-900 dark:text-gray-100'
                              : 'text-gray-400 dark:text-gray-500'
                              }`}>
                              {formatCurrency(sale.total)}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                              {sale.item_count || 0} 項 / {sale.total_quantity || 0} 件
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                              {formatPaymentMethod(sale.payment_method)}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{formatDateTime(sale.created_at)}</td>
                            <td className="px-6 py-4 text-center text-sm">
                              <span
                                className={`inline-flex items-center gap-1 text-xs ${sale.status === 'store_credit'
                                  ? 'text-purple-600 dark:text-purple-400'
                                  : sale.is_paid
                                    ? 'text-green-600 dark:text-green-400'
                                    : 'text-gray-500 dark:text-gray-400'
                                  }`}
                              >
                                {sale.status === 'store_credit' ? '💰 轉購物金' : sale.is_paid ? '✓ 已收' : '○ 未收'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-center text-sm">
                              {(() => {
                                const label = getFulfillmentLabel(sale)
                                return (
                                  <span className={`inline-flex items-center gap-1 text-xs ${label.className}`}>
                                    {label.text}
                                  </span>
                                )
                              })()}
                            </td>
                            <td className="px-6 py-4 text-center text-sm" onClick={(e) => e.stopPropagation()}>
                              <PortalDropdown
                                isOpen={openDropdownId === sale.id}
                                onClose={() => setOpenDropdownId(null)}
                                trigger={
                                  <button
                                    onClick={() => setOpenDropdownId(openDropdownId === sale.id ? null : sale.id)}
                                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-lg font-bold"
                                    title="更多操作"
                                  >
                                    ⋯
                                  </button>
                                }
                              >
                                <button
                                  onClick={() => {
                                    setOpenDropdownId(null)
                                    openCorrectionModal(sale)
                                  }}
                                  className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-t-lg"
                                >
                                  ✏️ 更正
                                </button>
                                {sale.customer_code && (
                                  <button
                                    onClick={() => {
                                      setOpenDropdownId(null)
                                      openStoreCreditModal(sale)
                                    }}
                                    className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                                  >
                                    💰 轉購物金
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    setOpenDropdownId(null)
                                    if (confirm(`確定要作廢銷售單 ${sale.sale_no} 嗎？\n\n此操作將會回補庫存，且無法復原。`)) {
                                      handleDelete(sale.id, sale.sale_no)
                                    }
                                  }}
                                  disabled={deleting === sale.id}
                                  className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-b-lg disabled:opacity-50"
                                >
                                  {deleting === sale.id ? '處理中...' : '🗑️ 刪除'}
                                </button>
                              </PortalDropdown>
                            </td>
                          </tr>
                          {expandedSales.has(sale.id) && sale.sale_items && (
                            <tr key={`${sale.id}-details`}>
                              <td colSpan={9} className="bg-gray-50 dark:bg-gray-900 px-6 py-4">
                                <div className="ml-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                                  {/* 備註顯示 */}
                                  {sale.note && sale.note.trim() !== '' && (
                                    <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                                      <div className="text-sm text-blue-800 dark:text-blue-200">
                                        📝 <span className="font-medium">備註：</span>{sale.note}
                                      </div>
                                    </div>
                                  )}
                                  <div className="flex items-center justify-between mb-3">
                                    <h4 className="font-semibold text-gray-900 dark:text-gray-100">銷售明細</h4>
                                  </div>
                                  <table className="w-full">
                                    <thead className="border-b">
                                      <tr>
                                        <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">品號</th>
                                        <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">商品名稱</th>
                                        <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">訂單數量</th>
                                        <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">已出貨</th>
                                        <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">售價</th>
                                        <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">小計</th>
                                        <th className="pb-2 text-center text-xs font-semibold text-gray-900 dark:text-gray-100">操作</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                      {sale.sale_items.map((item) => {
                                        const deliveredQty = item.delivered_quantity || 0
                                        const remainingQty = item.quantity - deliveredQty
                                        return (
                                          <tr key={item.id}>
                                            <td className="py-2 text-sm text-gray-900 dark:text-gray-100">{item.products.item_code}</td>
                                            <td className="py-2 text-sm text-gray-900 dark:text-gray-100">{item.snapshot_name}</td>
                                            <td className="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                                              {item.quantity} {item.products.unit}
                                            </td>
                                            <td className="py-2 text-right text-sm">
                                              <span
                                                className={`font-medium ${item.is_delivered
                                                  ? 'text-green-600 dark:text-green-400'
                                                  : deliveredQty > 0
                                                    ? 'text-yellow-600 dark:text-yellow-400'
                                                    : 'text-gray-600 dark:text-gray-400'
                                                  }`}
                                              >
                                                {deliveredQty} / {item.quantity}
                                              </span>
                                            </td>
                                            <td className="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                                              {formatCurrency(item.price)}
                                            </td>
                                            <td className="py-2 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
                                              {formatCurrency(item.quantity * item.price)}
                                            </td>
                                            <td className="py-2 text-center">
                                              <div className="flex items-center justify-center gap-1">
                                                {!item.is_delivered && (
                                                  <button
                                                    onClick={() => handleDeliverItem(item)}
                                                    disabled={delivering === item.id}
                                                    className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:bg-gray-400"
                                                  >
                                                    {delivering === item.id ? '處理中...' : '出貨'}
                                                  </button>
                                                )}
                                                {sale.customer_code && item.price === 0 && (() => {
                                                  const alreadyConverted = item.store_credit_qty || 0
                                                  const isFullyConverted = alreadyConverted >= item.quantity
                                                  const isPartiallyConverted = alreadyConverted > 0 && !isFullyConverted

                                                  if (isFullyConverted) {
                                                    return (
                                                      <span className="rounded bg-green-100 dark:bg-green-900/30 px-2 py-1 text-xs text-green-600 dark:text-green-400">
                                                        已轉購物金
                                                      </span>
                                                    )
                                                  }

                                                  return (
                                                    <>
                                                      {isPartiallyConverted && (
                                                        <span className="text-xs text-amber-600 dark:text-amber-400 mr-1">
                                                          已轉 {alreadyConverted}/{item.quantity}
                                                        </span>
                                                      )}
                                                      <button
                                                        onClick={() => handleItemToStoreCredit(item, sale)}
                                                        disabled={convertingItemId === item.id}
                                                        className="rounded px-2 py-1 text-xs text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 disabled:opacity-50"
                                                      >
                                                        {convertingItemId === item.id ? '處理中...' : '💰'}
                                                      </button>
                                                    </>
                                                  )
                                                })()}
                                              </div>
                                            </td>
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

              {/* 分頁導航 */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-2">
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1 || loading}
                    className="rounded bg-gray-200 dark:bg-gray-700 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    上一頁
                  </button>

                  <div className="flex items-center gap-1">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => {
                      // 顯示前 3 頁、當前頁周圍、最後 3 頁
                      const showPage = page <= 3 || page > totalPages - 3 || Math.abs(page - currentPage) <= 1
                      const showEllipsis = (page === 4 && currentPage > 5) || (page === totalPages - 3 && currentPage < totalPages - 4)

                      if (showEllipsis) {
                        return <span key={page} className="px-2 text-gray-500">...</span>
                      }

                      if (!showPage) return null

                      return (
                        <button
                          key={page}
                          onClick={() => handlePageChange(page)}
                          disabled={loading}
                          className={`min-w-[2.5rem] rounded px-3 py-2 text-sm font-medium ${currentPage === page
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                            } disabled:opacity-50`}
                        >
                          {page}
                        </button>
                      )
                    })}
                  </div>

                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages || loading}
                    className="rounded bg-gray-200 dark:bg-gray-700 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    下一頁
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 銷貨更正 Modal */}
      {showCorrectionModal && selectedSale && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  ✏️ 銷貨更正 - {selectedSale.sale_no}
                </h2>
                <button
                  onClick={() => {
                    setShowCorrectionModal(false)
                    setSelectedSale(null)
                  }}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  ✕
                </button>
              </div>

              <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <div className="text-sm text-blue-800 dark:text-blue-200">
                  <strong>原始總額：</strong> {formatCurrency(selectedSale.total)}
                </div>
                <div className="text-xs text-blue-600 dark:text-blue-300 mt-1">
                  修改數量後，系統將自動調整庫存與應收帳款
                </div>
              </div>

              <table className="w-full mb-6">
                <thead className="border-b">
                  <tr>
                    <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">商品</th>
                    <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">原數量</th>
                    <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">新數量</th>
                    <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">單價</th>
                    <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">新小計</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {selectedSale.sale_items?.map((item, index) => {
                    const correctionItem = correctionItems[index]
                    const newSubtotal = (correctionItem?.new_quantity || 0) * (correctionItem?.new_price || item.price)
                    return (
                      <tr key={item.id}>
                        <td className="py-2 text-sm text-gray-900 dark:text-gray-100">
                          <div>{item.snapshot_name}</div>
                          <div className="text-xs text-gray-500">{item.products.item_code}</div>
                        </td>
                        <td className="py-2 text-right text-sm text-gray-500">{item.quantity}</td>
                        <td className="py-2 text-right">
                          <input
                            type="number"
                            min="0"
                            value={correctionItem?.new_quantity ?? item.quantity}
                            onChange={(e) => {
                              const newItems = [...correctionItems]
                              newItems[index] = {
                                ...newItems[index],
                                new_quantity: parseInt(e.target.value) || 0,
                              }
                              setCorrectionItems(newItems)
                            }}
                            className="w-20 px-2 py-1 text-right rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                          />
                        </td>
                        <td className="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                          {formatCurrency(correctionItem?.new_price || item.price)}
                        </td>
                        <td className="py-2 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {formatCurrency(newSubtotal)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="border-t">
                  <tr>
                    <td colSpan={4} className="py-2 text-right font-semibold text-gray-900 dark:text-gray-100">
                      更正後總額：
                    </td>
                    <td className="py-2 text-right text-lg font-bold text-green-600 dark:text-green-400">
                      {formatCurrency(
                        correctionItems.reduce((sum, item, index) => {
                          const originalItem = selectedSale.sale_items?.[index]
                          return sum + (item.new_quantity * (item.new_price || originalItem?.price || 0))
                        }, 0)
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>

              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => {
                    setShowCorrectionModal(false)
                    setSelectedSale(null)
                  }}
                  className="px-4 py-2 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  取消
                </button>
                <button
                  onClick={handleCorrection}
                  disabled={correcting}
                  className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400"
                >
                  {correcting ? '處理中...' : '確認更正'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 轉購物金 Modal */}
      {showStoreCreditModal && selectedSale && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  💰 轉購物金 - {selectedSale.sale_no}
                </h2>
                <button
                  onClick={() => {
                    setShowStoreCreditModal(false)
                    setSelectedSale(null)
                  }}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  ✕
                </button>
              </div>

              <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                <div className="text-sm text-amber-800 dark:text-amber-200">
                  <strong>客戶：</strong> {selectedSale.customers?.customer_name || selectedSale.customer_code}
                </div>
                <div className="text-sm text-amber-800 dark:text-amber-200 mt-1">
                  <strong>銷售總額：</strong> {formatCurrency(selectedSale.total)}
                </div>
                <div className="text-xs text-amber-600 dark:text-amber-300 mt-2">
                  將銷售金額轉為客戶購物金，庫存將回補
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                  轉換金額
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={selectedSale.total}
                  value={storeCreditAmount}
                  onChange={(e) => setStoreCreditAmount(e.target.value)}
                  className="w-full px-4 py-2 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => setStoreCreditAmount(selectedSale.total.toString())}
                    className="text-xs px-2 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
                  >
                    全額轉換
                  </button>
                  <button
                    onClick={() => setStoreCreditAmount((selectedSale.total / 2).toString())}
                    className="text-xs px-2 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
                  >
                    半額
                  </button>
                </div>
              </div>

              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => {
                    setShowStoreCreditModal(false)
                    setSelectedSale(null)
                  }}
                  className="px-4 py-2 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  取消
                </button>
                <button
                  onClick={handleToStoreCredit}
                  disabled={convertingToStoreCredit}
                  className="px-4 py-2 rounded bg-amber-600 text-white hover:bg-amber-700 disabled:bg-gray-400"
                >
                  {convertingToStoreCredit ? '處理中...' : '確認轉換'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
