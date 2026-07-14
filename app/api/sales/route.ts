import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { saleDraftSchema } from '@/lib/schemas'
import { fromZodError } from 'zod-validation-error'
import { generateCode } from '@/lib/utils'
import { updateAccountBalance } from '@/lib/account-service'
import { getTaiwanTime } from '@/lib/timezone'

// GET /api/sales - List sales with items summary
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const dateFrom = searchParams.get('date_from')
    const dateTo = searchParams.get('date_to')
    const businessDate = searchParams.get('business_date') // 用於日結：查詢特定營業日的訂單
    const createdFrom = searchParams.get('created_from') // 用於日結：從某時間點之後創建的訂單
    const createdTo = searchParams.get('created_to') // 用於營業日報表：到某時間點之前創建的訂單
    const customerCode = searchParams.get('customer_code')
    const source = searchParams.get('source')
    const keyword = searchParams.get('keyword')
    const groupByCustomer = searchParams.get('group_by_customer') === 'true' // 按客戶分組時不分頁
    const undeliveredOnly = searchParams.get('undelivered_only') === 'true'

    // 分頁參數
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = (page - 1) * limit

    let query = (supabaseServer
      .from('sales') as any)
      .select(`
        *,
        customers:customer_code (
          customer_name
        ),
        sale_items (
          id,
          quantity,
          price,
          snapshot_name,
          product_id,
          cost,
          store_credit_qty,
          store_credit_amount,
          is_points_redemption,
          points_earned,
          points_used,
          products (
            item_code,
            unit
          )
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })

    if (businessDate) {
      query = query.eq('sale_date', businessDate)
    }

    if (dateFrom) {
      query = query.gte('sale_date', dateFrom)
    }

    if (dateTo) {
      query = query.lte('sale_date', dateTo)
    }

    if (createdFrom) {
      // 使用 gt (大於) 避免邊界重複，日結時間點的訂單已經在上一個營業日中
      query = query.gt('created_at', createdFrom)
    }

    if (createdTo) {
      query = query.lte('created_at', createdTo)
    }

    if (customerCode) {
      query = query.eq('customer_code', customerCode)
    }

    if (source) {
      query = query.eq('source', source)
    }

    if (undeliveredOnly) {
      query = query.neq('fulfillment_status', 'completed')
    }

    // Search by keyword in sale_no, customer_name, product name or item_code
    // 有關鍵字時需要取得所有資料再做客戶端過濾（因為商品搜尋無法在 DB 層面完成）
    let matchingCustomerCodes: string[] = []
    if (keyword) {
      const { data: matchingCustomers } = await (supabaseServer
        .from('customers') as any)
        .select('customer_code')
        .ilike('customer_name', `%${keyword}%`)
      matchingCustomerCodes = matchingCustomers?.map((c: any) => c.customer_code) || []
    }

    // 有關鍵字、按客戶分組、查詢特定營業日、日期範圍查詢、或未出貨篩選時不使用服務器端分頁
    const noPagination = keyword || groupByCustomer || businessDate || (dateFrom && dateTo) || undeliveredOnly
    if (!noPagination) {
      query = query.range(offset, offset + limit - 1)
    }

    let data: any[] | null = null
    let error: any = null
    let count: number | null = null

    if (noPagination) {
      // Supabase 預設最多回傳 1000 筆，需要分批載入全部資料
      const allData: any[] = []
      const BATCH = 1000
      let from = 0
      while (true) {
        const { data: batch, error: batchError, count: batchCount } = await query.range(from, from + BATCH - 1)
        if (batchError) { error = batchError; break }
        if (batchCount != null && count == null) count = batchCount
        allData.push(...(batch || []))
        if (!batch || batch.length < BATCH) break
        from += BATCH
      }
      if (!error) data = allData
    } else {
      const result = await query
      data = result.data
      error = result.error
      count = result.count
    }

    if (error) {
      console.error('[Sales API] Query error:', {
        error: error.message,
        params: {
          dateFrom,
          dateTo,
          createdFrom,
          createdTo,
          source,
          customerCode,
          keyword
        }
      })
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    // 統一關鍵字過濾：單號、客戶名稱、商品名稱、品號
    let filteredData = data
    if (keyword) {
      const kw = keyword.toLowerCase()
      filteredData = (data || []).filter((sale: any) => {
        // 匹配銷售單號
        if (sale.sale_no?.toLowerCase().includes(kw)) return true
        // 匹配客戶
        if (matchingCustomerCodes.includes(sale.customer_code)) return true
        // 匹配商品名稱或品號
        const items = sale.sale_items || []
        return items.some((item: any) =>
          item.snapshot_name?.toLowerCase().includes(kw) ||
          item.products?.item_code?.toLowerCase().includes(kw)
        )
      })
    }

    // Get delivery status for all sale_items - 單次查詢取代分批迴圈
    const allSaleItemIds = filteredData?.flatMap((sale: any) =>
      sale.sale_items?.map((item: any) => item.id) || []
    ) || []

    const deliveryQuantityMap: { [key: string]: number } = {}

    if (allSaleItemIds.length > 0) {
      // 分批查詢避免 URL 過長（每批最多 50 個 ID）
      const BATCH_SIZE = 50
      const allDeliveryItems: any[] = []

      for (let i = 0; i < allSaleItemIds.length; i += BATCH_SIZE) {
        const batchIds = allSaleItemIds.slice(i, i + BATCH_SIZE)
        const { data: batchItems, error: batchError } = await (supabaseServer
          .from('delivery_items') as any)
          .select(`
            sale_item_id,
            quantity,
            deliveries!inner (
              status
            )
          `)
          .in('sale_item_id', batchIds)
          .eq('deliveries.status', 'confirmed')

        if (!batchError && batchItems) {
          allDeliveryItems.push(...batchItems)
        }
      }

      // 計算每個 sale_item 已出貨的數量
      allDeliveryItems.forEach((di: any) => {
        const currentQty = deliveryQuantityMap[di.sale_item_id] || 0
        deliveryQuantityMap[di.sale_item_id] = currentQty + di.quantity
      })

      console.log('[Sales API] deliveryQuantityMap entries:', Object.keys(deliveryQuantityMap).length)
    }

    // Calculate summary for each sale and add delivery status to items
    const salesWithSummary = filteredData?.map((sale: any) => {
      const items = sale.sale_items || []
      const totalQuantity = items.reduce((sum: number, item: any) => sum + item.quantity, 0)
      const avgPrice = items.length > 0
        ? items.reduce((sum: number, item: any) => sum + item.price, 0) / items.length
        : 0

      // Add delivery status and quantity to each item
      const itemsWithDeliveryStatus = items.map((item: any) => {
        const deliveredQty = deliveryQuantityMap[item.id] || 0
        return {
          ...item,
          delivered_quantity: deliveredQty,
          is_delivered: deliveredQty >= item.quantity
        }
      })

      return {
        ...sale,
        item_count: items.length,
        total_quantity: totalQuantity,
        avg_price: avgPrice,
        sale_items: itemsWithDeliveryStatus
      }
    })

    // 當有 keyword、groupByCustomer、businessDate、或未出貨篩選時，使用過濾後的數據長度作為 total
    const noServerPagination = keyword || groupByCustomer || businessDate || (dateFrom && dateTo) || undeliveredOnly
    const actualTotal = noServerPagination ? (salesWithSummary?.length || 0) : (count || salesWithSummary?.length || 0)

    return NextResponse.json({
      ok: true,
      data: salesWithSummary,
      pagination: {
        page: noServerPagination ? 1 : page,
        limit,
        total: actualTotal,
        totalPages: noServerPagination ? 1 : (count ? Math.ceil(count / limit) : 1)
      }
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}

// POST /api/sales - Create sale
export async function POST(request: NextRequest) {
  // ⏱️ 暫時的結帳效能量測，找到瓶頸後移除
  const t0 = performance.now()
  let tLast = t0
  const marks: string[] = []
  const mark = (label: string) => {
    const now = performance.now()
    marks.push(`${label}: ${(now - tLast).toFixed(0)}ms`)
    tLast = now
  }

  try {
    const body = await request.json()
    mark('parse body')
    const { is_delivered = true, delivery_method, expected_delivery_date, delivery_note, ...saleData } = body

    // Validate input
    const validation = saleDraftSchema.safeParse(saleData)
    if (!validation.success) {
      const error = fromZodError(validation.error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      )
    }

    const draft = validation.data

    // 安全檢查：有未出貨商品時必須有客戶（否則無法追蹤配送）
    const hasNotDeliveredItems = draft.items.some(item => item.isNotDelivered)
    if (hasNotDeliveredItems && !draft.customer_code) {
      return NextResponse.json(
        { ok: false, error: '有未出貨商品時，必須選擇客戶' },
        { status: 400 }
      )
    }

    // Determine primary payment method and account
    // If payments array provided, use largest amount; otherwise use single payment_method
    let primaryPaymentMethod = draft.payment_method
    if (draft.payments && draft.payments.length > 0) {
      // Find payment with largest amount
      const largest = draft.payments.reduce((max, p) => p.amount > max.amount ? p : max, draft.payments[0])
      primaryPaymentMethod = largest.method
    }

    // 這三個查詢彼此不相依，並行送出（序列化的話每個都要多等一次 round-trip）
    const [{ data: latestSale }, { data: account }, { data: businessDaySetting }] = await Promise.all([
      // Generate sale_no - 只取最大編號（避免 Supabase 預設 1000 筆 limit）
      (supabaseServer
        .from('sales') as any)
        .select('sale_no')
        .order('created_at', { ascending: false })
        .limit(100),
      // Get account_id based on primary payment_method
      (supabaseServer
        .from('accounts') as any)
        .select('id')
        .eq('payment_method_code', primaryPaymentMethod)
        .eq('is_active', true)
        .single(),
      // 從 business_day_settings 取得當前營業日
      // 這樣即使跨日（凌晨）營業，在日結前的銷售仍會記錄到正確的營業日
      (supabaseServer
        .from('business_day_settings') as any)
        .select('current_business_date')
        .eq('source', draft.source)
        .single(),
    ])

    mark('sale_no + account + businessDay (parallel)')

    let saleCount = 0
    if (latestSale && latestSale.length > 0) {
      const maxNumber = latestSale.reduce((max: number, sale: any) => {
        const match = sale.sale_no.match(/\d+/)
        if (match) {
          const num = parseInt(match[0], 10)
          return num > max ? num : max
        }
        return max
      }, 0)
      saleCount = maxNumber
    }

    let saleNo = generateCode('S', saleCount)

    const accountId = account?.id || null

    // 取得台灣時間 (UTC+8)
    const now = new Date()
    const taiwanTime = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    const createdAt = taiwanTime.toISOString() // 完整的台灣時間戳記

    let saleDate = taiwanTime.toISOString().split('T')[0] // 預設使用當前日期
    if (businessDaySetting?.current_business_date) {
      saleDate = businessDaySetting.current_business_date
    }

    // Start transaction-like operations
    // 1. Create sale (draft) — 含重試機制避免 sale_no 重複
    let sale: any = null
    let saleError: any = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await (supabaseServer
        .from('sales') as any)
        .insert({
          sale_no: saleNo,
          customer_code: draft.customer_code || null,
          sale_date: saleDate, // 設定台灣時間的日期
          source: draft.source,
          payment_method: draft.payment_method,
          account_id: accountId,
          is_paid: draft.is_paid,
          note: draft.note || null,
          discount_type: draft.discount_type || 'none',
          discount_value: draft.discount_value || 0,
          status: 'draft',
          total: 0,
          fulfillment_status: 'none', // 初始為未履約
          delivery_method: delivery_method || null,
          expected_delivery_date: expected_delivery_date || null,
          delivery_note: delivery_note || null,
          created_at: createdAt, // 手動設定為台灣時間
        })
        .select()
        .single()

      if (error?.code === '23505' && error?.message?.includes('sale_no')) {
        // sale_no 重複，直接遞增編號再試
        const match = saleNo.match(/\d+/)
        const currentNum = match ? parseInt(match[0], 10) : saleCount
        saleNo = generateCode('S', currentNum)
        console.warn(`[Sales API] sale_no 重複，重試 → ${saleNo} (attempt ${attempt + 1})`)
        continue
      }

      sale = data
      saleError = error
      break
    }

    mark('insert sales (draft)')

    if (saleError || !sale) {
      return NextResponse.json(
        { ok: false, error: saleError?.message || '建立銷售單失敗' },
        { status: 500 }
      )
    }

    // 2. Check stock availability for each item（批次查詢優化）
    // 分離一般商品和一番賞
    // 一番賞若有 realProductId 也要一起撈：組 sale_items 時需要它的 cost / name。
    // 下面用到 productMap 的地方都各自有 ichiban_kuji_prize_id 的守衛，放寬不影響庫存檢查。
    const productIds = draft.items
      .map(i => i.product_id)
      .filter((id): id is string => !!id)
    const prizeIds = draft.items.filter(i => i.ichiban_kuji_prize_id).map(i => i.ichiban_kuji_prize_id).filter((id): id is string => !!id)

    // 批次查詢商品（含積分欄位）
    // cost / avg_cost 一併撈出來，下面組 sale_items 時就不必每筆商品各查一次
    let productMap = new Map<string, { stock: number; allow_negative: boolean; name: string; is_points_base: boolean; points_cost: number | null; cost: number | null; avg_cost: number | null }>()
    if (productIds.length > 0) {
      const { data: products } = await (supabaseServer
        .from('products') as any)
        .select('id, stock, allow_negative, name, is_points_base, points_cost, cost, avg_cost')
        .in('id', productIds)
      if (products) {
        productMap = new Map(products.map((p: any) => [p.id, p]))
      }
    }

    mark('products batch')

    // 積分安全檢查：積分底數商品必須有客戶
    const hasPointsBaseItems = draft.items.some(item => {
      if (!item.product_id || item.ichiban_kuji_prize_id) return false
      return productMap.get(item.product_id)?.is_points_base === true
    })
    if (hasPointsBaseItems && !draft.customer_code) {
      await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
      return NextResponse.json(
        { ok: false, error: '銷售積分底數時必須選擇客戶' },
        { status: 400 }
      )
    }

    // 積分兌換安全檢查：必須有客戶且積分足夠
    const totalManualPointsNeeded = draft.items.reduce((sum, item) => sum + (item.points_used_manual || 0), 0)
    if (totalManualPointsNeeded > 0) {
      if (!draft.customer_code) {
        await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
        return NextResponse.json(
          { ok: false, error: '積分兌換時必須選擇客戶' },
          { status: 400 }
        )
      }
      // 計算本次同時獲得的積分（積分底數）
      let totalPointsEarned = 0
      for (const item of draft.items) {
        if (item.product_id && !item.ichiban_kuji_prize_id) {
          const product = productMap.get(item.product_id)
          if (product?.is_points_base) {
            totalPointsEarned += item.quantity
          }
        }
      }
      const { data: customerForPoints } = await (supabaseServer
        .from('customers') as any)
        .select('loyalty_points')
        .eq('customer_code', draft.customer_code)
        .single()
      const currentPoints = customerForPoints?.loyalty_points || 0
      if (currentPoints + totalPointsEarned < totalManualPointsNeeded) {
        await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
        return NextResponse.json(
          { ok: false, error: `積分不足！需要 ${totalManualPointsNeeded} 積分，目前 ${currentPoints + totalPointsEarned} 積分` },
          { status: 400 }
        )
      }
    }

    // 批次查詢一番賞
    let prizeMap = new Map<string, { remaining: number; prize_tier: string }>()
    if (prizeIds.length > 0) {
      const { data: prizes } = await (supabaseServer
        .from('ichiban_kuji_prizes') as any)
        .select('id, remaining, prize_tier')
        .in('id', prizeIds)
      if (prizes) {
        prizeMap = new Map(prizes.map((p: any) => [p.id, p]))
      }
    }

    // 驗證庫存
    for (const item of draft.items) {
      if (item.ichiban_kuji_prize_id) {
        const prize = prizeMap.get(item.ichiban_kuji_prize_id)

        if (!prize) {
          await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
          return NextResponse.json(
            { ok: false, error: `Prize not found: ${item.ichiban_kuji_prize_id}` },
            { status: 400 }
          )
        }

        if (prize.remaining < item.quantity) {
          await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
          return NextResponse.json(
            {
              ok: false,
              error: `${prize.prize_tier} 庫存不足。剩餘: ${prize.remaining}, 需要: ${item.quantity}`,
            },
            { status: 400 }
          )
        }
      } else if (item.product_id) {
        const product = productMap.get(item.product_id)

        if (!product) {
          await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
          return NextResponse.json(
            { ok: false, error: `Product not found: ${item.product_id}` },
            { status: 400 }
          )
        }

        // 移除庫存檢查，允許所有商品負庫存銷售
        // if (!product.allow_negative && product.stock < item.quantity) { ... }
      }
    }

    // 3. 複選獎：驗證 selection_option_id 並取得 product 資訊
    // 建立 optionMap 以便後續使用
    const optionMap = new Map<string, any>()
    for (const item of draft.items) {
      if (item.selection_option_id) {
        const { data: option, error: optErr } = await (supabaseServer
          .from('ichiban_kuji_prize_options') as any)
          .select('id, prize_id, product_id, is_consumed, products(id, name, item_code, cost)')
          .eq('id', item.selection_option_id)
          .single()

        if (optErr || !option) {
          await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
          return NextResponse.json(
            { ok: false, error: `找不到複選獎選項: ${item.selection_option_id}` },
            { status: 400 }
          )
        }
        if (option.is_consumed) {
          await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
          return NextResponse.json(
            { ok: false, error: `複選獎選項已被使用` },
            { status: 400 }
          )
        }
        optionMap.set(item.selection_option_id, option)
      }
    }

    mark('points/prize/stock/store-credit checks')

    // Get product details and insert sale items (subtotal is auto-calculated by database)
    const saleItems = await Promise.all(
      draft.items.map(async (item) => {
        // 複選獎：使用選項的 product
        if (item.selection_option_id) {
          const option = optionMap.get(item.selection_option_id)
          const optProduct = option?.products

          const { data: kuji } = await (supabaseServer
            .from('ichiban_kuji') as any)
            .select('avg_cost, name')
            .eq('id', item.ichiban_kuji_id)
            .single()

          const { data: prize } = await (supabaseServer
            .from('ichiban_kuji_prizes') as any)
            .select('prize_tier')
            .eq('id', item.ichiban_kuji_prize_id)
            .single()

          return {
            sale_id: sale.id,
            product_id: optProduct?.id || option?.product_id,
            quantity: item.quantity,
            price: item.price,
            cost: kuji?.avg_cost || 0,
            snapshot_name: `${kuji?.name || ''} ${prize?.prize_tier || ''} - ${optProduct?.name || ''}`,
            ichiban_kuji_prize_id: item.ichiban_kuji_prize_id || null,
            ichiban_kuji_id: item.ichiban_kuji_id || null,
            is_points_redemption: false,
            points_earned: 0,
            points_used: 0,
          }
        }

        // 官方套賞項沒有 product_id，需從 prize + kuji 取得資訊
        if (item.ichiban_kuji_prize_id && !item.product_id) {
          const { data: prize } = await (supabaseServer
            .from('ichiban_kuji_prizes') as any)
            .select('prize_tier, prize_name, kuji_id')
            .eq('id', item.ichiban_kuji_prize_id)
            .single()

          const { data: kuji } = await (supabaseServer
            .from('ichiban_kuji') as any)
            .select('avg_cost, name')
            .eq('id', item.ichiban_kuji_id || prize?.kuji_id)
            .single()

          const displayName = prize?.prize_name || prize?.prize_tier || ''
          return {
            sale_id: sale.id,
            product_id: null,
            quantity: item.quantity,
            price: item.price,
            cost: kuji?.avg_cost || 0,
            snapshot_name: displayName ? `${kuji?.name || ''} ${displayName}` : null,
            ichiban_kuji_prize_id: item.ichiban_kuji_prize_id,
            ichiban_kuji_id: item.ichiban_kuji_id || prize?.kuji_id || null,
            is_points_redemption: false,
            points_earned: 0,
            points_used: 0,
          }
        }

        const product = item.product_id ? productMap.get(item.product_id) : null

        const isPointsBase = product?.is_points_base === true
        const manualPointsUsed = item.points_used_manual || 0
        const isPointsRedemption = manualPointsUsed > 0

        return {
          sale_id: sale.id,
          product_id: item.product_id,
          quantity: item.quantity,
          price: item.price,
          cost: product?.avg_cost || product?.cost || 0,  // 優先使用加權平均成本
          snapshot_name: product?.name || null,
          ichiban_kuji_prize_id: item.ichiban_kuji_prize_id || null,
          ichiban_kuji_id: item.ichiban_kuji_id || null,
          is_points_redemption: isPointsRedemption,
          points_earned: isPointsBase && !isPointsRedemption ? item.quantity : 0,
          points_used: manualPointsUsed,
        }
      })
    )

    mark('build saleItems (kuji/prize lookups)')

    const { data: insertedSaleItems, error: itemsError } = await (supabaseServer
      .from('sale_items') as any)
      .insert(saleItems)
      .select()

    mark('insert sale_items')

    if (itemsError) {
      // Rollback: delete the sale
      await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
      return NextResponse.json(
        { ok: false, error: itemsError.message },
        { status: 500 }
      )
    }

    // 3.5. 處理積分（獲得 + 使用）
    if (draft.customer_code) {
      const totalPointsEarned = saleItems.reduce((sum, si) => sum + (si.points_earned || 0), 0)
      const totalPointsUsed = saleItems.reduce((sum, si) => sum + (si.points_used || 0), 0)

      if (totalPointsEarned > 0 || totalPointsUsed > 0) {
        const { data: customerForPoints } = await (supabaseServer
          .from('customers') as any)
          .select('loyalty_points')
          .eq('customer_code', draft.customer_code)
          .single()

        const currentPoints = customerForPoints?.loyalty_points || 0
        const newPoints = currentPoints + totalPointsEarned - totalPointsUsed

        // 更新客戶積分
        await (supabaseServer
          .from('customers') as any)
          .update({ loyalty_points: newPoints })
          .eq('customer_code', draft.customer_code)

        // 記錄積分日誌
        const pointsLogs: any[] = []
        if (totalPointsEarned > 0) {
          pointsLogs.push({
            customer_code: draft.customer_code,
            amount: totalPointsEarned,
            balance_before: currentPoints,
            balance_after: currentPoints + totalPointsEarned,
            type: 'earn',
            ref_type: 'sale',
            ref_id: sale.id,
            ref_no: saleNo,
            note: `銷售單 ${saleNo} 獲得積分`,
          })
        }
        if (totalPointsUsed > 0) {
          const balanceBeforeRedeem = currentPoints + totalPointsEarned
          pointsLogs.push({
            customer_code: draft.customer_code,
            amount: -totalPointsUsed,
            balance_before: balanceBeforeRedeem,
            balance_after: balanceBeforeRedeem - totalPointsUsed,
            type: 'redeem',
            ref_type: 'sale',
            ref_id: sale.id,
            ref_no: saleNo,
            note: `銷售單 ${saleNo} 積分兌換`,
          })
        }
        if (pointsLogs.length > 0) {
          const { error: pointsLogError } = await (supabaseServer
            .from('customer_points_logs') as any)
            .insert(pointsLogs)
          if (pointsLogError) {
            console.error('[Sales API] 積分日誌寫入失敗:', pointsLogError)
          }
        }
      }
    }

    // 4. Calculate total with discount
    const subtotal = draft.items.reduce((sum, item) => sum + (item.quantity * item.price), 0)

    let discountAmount = 0
    if (draft.discount_type === 'percent') {
      discountAmount = (subtotal * (draft.discount_value || 0)) / 100
    } else if (draft.discount_type === 'amount') {
      discountAmount = draft.discount_value || 0
    }

    const total = Math.max(0, subtotal - discountAmount)

    // 4.5. 自动使用购物金抵扣（如果有客户且购物金余额 > 0）
    let storeCreditUsed = 0
    let finalTotal = total

    if (draft.customer_code && draft.use_store_credit !== false) {
      // 获取客户购物金余额
      const { data: customer, error: customerError } = await (supabaseServer
        .from('customers') as any)
        .select('store_credit, credit_limit')
        .eq('customer_code', draft.customer_code)
        .single()

      if (customer && customer.store_credit > 0) {
        // 计算可使用的购物金（不超过订单总额）
        storeCreditUsed = Math.min(customer.store_credit, total)
        finalTotal = total - storeCreditUsed

        // 更新客户购物金余额
        const newBalance = customer.store_credit - storeCreditUsed
        const { error: updateCustomerError } = await (supabaseServer
          .from('customers') as any)
          .update({ store_credit: newBalance })
          .eq('customer_code', draft.customer_code)

        if (updateCustomerError) {
          // Rollback: delete items and sale
          await (supabaseServer.from('sale_items') as any).delete().eq('sale_id', sale.id)
          await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
          return NextResponse.json(
            { ok: false, error: '更新客户购物金失败' },
            { status: 500 }
          )
        }

        // 记录购物金使用日志（使用台灣時間）
        const { error: logError } = await (supabaseServer
          .from('customer_balance_logs') as any)
          .insert({
            customer_code: draft.customer_code,
            amount: -storeCreditUsed,
            balance_before: customer.store_credit,
            balance_after: newBalance,
            type: 'sale',
            ref_type: 'sale',
            ref_id: sale.id,
            ref_no: saleNo,
            note: `销售单 ${saleNo} 使用购物金`,
            created_by: null, // TODO: 从会话获取当前用户
            created_at: getTaiwanTime(),
          })

        if (logError) {
          console.error('Failed to create balance log:', logError)
          // 日志失败不影响销售流程，只记录错误
        }
      }
    }

    // 4.6. 安全檢查：購物金部分折抵時，如果沒有明確的付款覆蓋剩餘金額，強制設為未收款
    // 防止購物金不足以支付全額卻以 is_paid=true 結帳，導致帳戶餘額虛增、無 AR 追蹤
    let effectiveIsPaid = draft.is_paid
    if (storeCreditUsed > 0 && finalTotal > 0 && draft.is_paid) {
      const hasExplicitPayments = draft.payments && draft.payments.length > 0
      const explicitTotal = hasExplicitPayments
        ? draft.payments!.reduce((sum, p) => sum + p.amount, 0)
        : 0

      if (!hasExplicitPayments || explicitTotal < finalTotal) {
        // 沒有足夠的明確付款覆蓋剩餘金額，強制設為未收款並建立 AR
        effectiveIsPaid = false
        console.warn(`[Sales API] 銷售 ${saleNo} 購物金折抵 $${storeCreditUsed} 後剩餘 $${finalTotal}，無明確付款覆蓋，自動設為未收款`)

        await (supabaseServer.from('sales') as any)
          .update({ is_paid: false, payment_method: 'pending' })
          .eq('id', sale.id)
      }
    }

    // 5. Deduct ONLY ichiban kuji remaining (product stock is auto-deducted by DB trigger)
    for (let idx = 0; idx < draft.items.length; idx++) {
      const item = draft.items[idx]
      const insertedItem = insertedSaleItems[idx]
      // 如果是從一番賞售出，扣除一番賞的 remaining
      if (item.ichiban_kuji_prize_id) {
        const { data: prize, error: fetchPrizeError } = await (supabaseServer
          .from('ichiban_kuji_prizes') as any)
          .select('remaining')
          .eq('id', item.ichiban_kuji_prize_id)
          .single()

        if (fetchPrizeError) {
          // Rollback: delete items and sale
          await (supabaseServer.from('sale_items') as any).delete().eq('sale_id', sale.id)
          await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
          return NextResponse.json(
            { ok: false, error: `Failed to fetch prize: ${fetchPrizeError.message}` },
            { status: 500 }
          )
        }

        // 檢查一番賞庫存
        if (prize.remaining < item.quantity) {
          // Rollback: delete items and sale
          await (supabaseServer.from('sale_items') as any).delete().eq('sale_id', sale.id)
          await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
          return NextResponse.json(
            { ok: false, error: `該賞已售完或庫存不足` },
            { status: 400 }
          )
        }

        // 扣除一番賞庫的 remaining
        const { error: updatePrizeError } = await (supabaseServer
          .from('ichiban_kuji_prizes') as any)
          .update({ remaining: prize.remaining - item.quantity })
          .eq('id', item.ichiban_kuji_prize_id)

        if (updatePrizeError) {
          // Rollback: delete items and sale
          await (supabaseServer.from('sale_items') as any).delete().eq('sale_id', sale.id)
          await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
          return NextResponse.json(
            { ok: false, error: `Failed to deduct prize inventory: ${updatePrizeError.message}` },
            { status: 500 }
          )
        }

        // 複選獎：標記選項為已消耗
        if (item.selection_option_id && insertedItem) {
          const { error: consumeError } = await (supabaseServer
            .from('ichiban_kuji_prize_options') as any)
            .update({
              is_consumed: true,
              consumed_sale_item_id: insertedItem.id,
            })
            .eq('id', item.selection_option_id)

          if (consumeError) {
            console.error(`[Sales API] Failed to consume option ${item.selection_option_id}:`, consumeError)
          }
        }
      }
    }

    // 6. Update sale to confirmed（不扣庫存，改由 delivery confirmed 扣庫存）
    // 注意：fulfillment_status 會在創建出貨單後根據部分出貨邏輯更新
    const { data: confirmedSale, error: confirmError } = await (supabaseServer
      .from('sales') as any)
      .update({
        subtotal: subtotal,  // 原始銷售額 (Gross Sales)
        discount_amount: discountAmount,  // 折扣金額
        store_credit_used: storeCreditUsed,  // 使用的購物金
        total: finalTotal,  // 實收金額 (Net Collected) = subtotal - discount - store_credit
        status: 'confirmed',
        updated_at: taiwanTime.toISOString(), // 使用台灣時間
      })
      .eq('id', sale.id)
      .select()
      .single()

    mark('update sales → confirmed')

    if (confirmError) {
      // Rollback: restore customer store credit if used
      if (storeCreditUsed > 0 && draft.customer_code) {
        const { data: customer } = await (supabaseServer
          .from('customers') as any)
          .select('store_credit')
          .eq('customer_code', draft.customer_code)
          .single()

        if (customer) {
          const newBalance = customer.store_credit + storeCreditUsed
          await (supabaseServer
            .from('customers') as any)
            .update({ store_credit: newBalance })
            .eq('customer_code', draft.customer_code)

          // 記錄退還日誌 (Bug fix: 原本漏記)
          await (supabaseServer
            .from('customer_balance_logs') as any)
            .insert({
              customer_code: draft.customer_code,
              amount: storeCreditUsed,
              balance_before: customer.store_credit,
              balance_after: newBalance,
              type: 'refund',
              ref_type: 'sale_rollback',
              ref_id: sale.id,
              ref_no: saleNo,
              note: `銷售單 ${saleNo} 確認失敗，退還購物金`,
              created_at: getTaiwanTime(),
            })
        }
      }

      // Rollback: restore ONLY ichiban kuji remaining
      for (const item of draft.items) {
        // 恢復一番賞庫存
        if (item.ichiban_kuji_prize_id) {
          const { data: prize } = await (supabaseServer
            .from('ichiban_kuji_prizes') as any)
            .select('remaining')
            .eq('id', item.ichiban_kuji_prize_id)
            .single()

          if (prize) {
            await (supabaseServer
              .from('ichiban_kuji_prizes') as any)
              .update({ remaining: prize.remaining + item.quantity })
              .eq('id', item.ichiban_kuji_prize_id)
          }
        }
      }
      // Delete items and sale
      await (supabaseServer.from('sale_items') as any).delete().eq('sale_id', sale.id)
      await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
      return NextResponse.json(
        { ok: false, error: confirmError.message },
        { status: 500 }
      )
    }

    // 6.5. 更新帳戶餘額（僅當已付款時）
    if (effectiveIsPaid) {
      // Determine payments to process
      const paymentsToProcess = draft.payments && draft.payments.length > 0
        ? draft.payments
        : [{ method: draft.payment_method, amount: finalTotal }]

      // Process each payment
      for (const payment of paymentsToProcess) {
        // 單一付款時就是開頭查過的 primary account，直接沿用省一次 round-trip
        let paymentAccount: { id: string } | null =
          payment.method === primaryPaymentMethod && accountId ? { id: accountId } : null

        if (!paymentAccount) {
          const { data } = await (supabaseServer
            .from('accounts') as any)
            .select('id')
            .eq('payment_method_code', payment.method)
            .eq('is_active', true)
            .single()
          paymentAccount = data
        }

        if (paymentAccount) {
          const accountUpdate = await updateAccountBalance({
            supabase: supabaseServer,
            accountId: paymentAccount.id,
            paymentMethod: payment.method,
            amount: payment.amount,
            direction: 'increase', // 銷售收款 = 現金流入
            transactionType: 'sale',
            referenceId: sale.id,
            referenceNo: saleNo,
            note: draft.payments && draft.payments.length > 1
              ? `多元付款 - ${payment.method}: $${payment.amount}`
              : draft.note
          })

          if (!accountUpdate.success) {
            console.error(`[Sales API] 銷售 ${saleNo} 更新帳戶 ${payment.method} 餘額失敗:`, accountUpdate.error)
          }
        } else {
          console.warn(`[Sales API] 找不到付款方式 ${payment.method} 對應的帳戶`)
        }
      }
    }

    mark('updateAccountBalance (帳戶餘額)')

    // 7. 創建出貨單（支援部分出貨）
    // Helper: 取得目前最大的 delivery number（使用 RPC 避免 1000 筆限制）
    const getMaxDeliveryNumber = async (): Promise<number> => {
      const { data, error } = await supabaseServer.rpc('get_max_delivery_number')
      if (error) {
        console.warn('[getMaxDeliveryNumber] RPC error:', error.message)
        return 0
      }
      return data || 0
    }

    // Helper: 創建出貨單（含 retry 機制，失敗後重新查詢最大編號）
    const createDeliveryWithRetry = async (
      deliveryData: any,
      maxRetries = 10
    ): Promise<{ data: any; error: any }> => {
      let lastError: any = null

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        // 每次嘗試都重新查詢最大編號，確保取得最新值
        const currentMax = await getMaxDeliveryNumber()
        // 加入隨機偏移減少並發衝突 (0-2)
        const randomOffset = Math.floor(Math.random() * 3)
        const nextNumber = currentMax + 1 + randomOffset
        const deliveryNo = generateCode('D', nextNumber - 1)

        console.log(`[Sales API] Attempting delivery_no: ${deliveryNo} (attempt ${attempt + 1}/${maxRetries}, max=${currentMax})`)

        const { data, error } = await (supabaseServer
          .from('deliveries') as any)
          .insert({ ...deliveryData, delivery_no: deliveryNo })
          .select()
          .single()

        if (!error) {
          console.log(`[Sales API] Created delivery: ${deliveryNo}`)
          return { data, error: null }
        }

        lastError = error
        console.warn(`[Sales API] Insert failed (attempt ${attempt + 1}):`, error.message || error)

        // 如果是 unique constraint error，繼續 retry
        const isUniqueError = error.code === '23505' ||
          error.message?.includes('duplicate') ||
          error.message?.includes('unique')

        if (!isUniqueError) {
          break
        }

        // 隨機延遲減少衝突 (50-150ms)
        const delay = 50 + Math.floor(Math.random() * 100)
        await new Promise(resolve => setTimeout(resolve, delay))
      }

      console.error(`[Sales API] Failed after ${maxRetries} attempts, last error:`, lastError)
      return { data: null, error: lastError || { message: '無法生成唯一的出貨單號，請重試' } }
    }

    // 分離已出貨和未出貨的品項
    const deliveredItems: { saleItem: any, draftItem: any }[] = []
    const notDeliveredItems: { saleItem: any, draftItem: any }[] = []

    insertedSaleItems.forEach((saleItem: any, index: number) => {
      const draftItem = draft.items[index]
      if (draftItem.isNotDelivered) {
        notDeliveredItems.push({ saleItem, draftItem })
      } else {
        deliveredItems.push({ saleItem, draftItem })
      }
    })

    let confirmedDelivery: any = null
    let draftDelivery: any = null

    // 8a. 創建已出貨的出貨單（如果有已出貨品項）
    if (deliveredItems.length > 0) {
      const { data: delivery, error: deliveryError } = await createDeliveryWithRetry({
        sale_id: sale.id,
        status: 'confirmed',
        delivery_date: taiwanTime.toISOString(),
        method: delivery_method || null,
        note: delivery_note || null,
      })

      if (deliveryError) {
        await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
        return NextResponse.json(
          { ok: false, error: deliveryError.message },
          { status: 500 }
        )
      }

      confirmedDelivery = delivery

      // 創建已出貨的出貨明細
      const confirmedDeliveryItems = deliveredItems.map(({ saleItem }) => ({
        delivery_id: delivery.id,
        sale_item_id: saleItem.id,
        product_id: saleItem.product_id,
        quantity: saleItem.quantity,
      }))

      const { error: deliveryItemsError } = await (supabaseServer
        .from('delivery_items') as any)
        .insert(confirmedDeliveryItems)

      if (deliveryItemsError) {
        await (supabaseServer.from('deliveries') as any).delete().eq('id', delivery.id)
        await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
        return NextResponse.json(
          { ok: false, error: deliveryItemsError.message },
          { status: 500 }
        )
      }

      // 扣庫存（只扣已出貨的品項）
      for (const { saleItem, draftItem } of deliveredItems) {
        if (!draftItem.ichiban_kuji_prize_id) {
          await (supabaseServer
            .from('inventory_logs') as any)
            .insert({
              product_id: draftItem.product_id,
              ref_type: 'delivery',
              ref_id: delivery.id,
              qty_change: -draftItem.quantity,
              memo: `出貨扣庫存 - ${delivery.delivery_no}`,
            })
        }
      }
    }

    // 8b. 創建未出貨的出貨單（如果有未出貨品項）
    if (notDeliveredItems.length > 0) {
      const { data: delivery, error: deliveryError } = await createDeliveryWithRetry({
        sale_id: sale.id,
        status: 'draft',
        delivery_date: null,
        method: delivery_method || null,
        note: delivery_note || null,
      })

      if (deliveryError) {
        if (confirmedDelivery) {
          await (supabaseServer.from('deliveries') as any).delete().eq('id', confirmedDelivery.id)
        }
        await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
        return NextResponse.json(
          { ok: false, error: deliveryError.message },
          { status: 500 }
        )
      }

      draftDelivery = delivery

      // 創建未出貨的出貨明細
      const draftDeliveryItems = notDeliveredItems.map(({ saleItem }) => ({
        delivery_id: delivery.id,
        sale_item_id: saleItem.id,
        product_id: saleItem.product_id,
        quantity: saleItem.quantity,
      }))

      const { error: deliveryItemsError } = await (supabaseServer
        .from('delivery_items') as any)
        .insert(draftDeliveryItems)

      if (deliveryItemsError) {
        await (supabaseServer.from('deliveries') as any).delete().eq('id', delivery.id)
        if (confirmedDelivery) {
          await (supabaseServer.from('deliveries') as any).delete().eq('id', confirmedDelivery.id)
        }
        await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
        return NextResponse.json(
          { ok: false, error: deliveryItemsError.message },
          { status: 500 }
        )
      }
    }

    mark('deliveries + delivery_items + inventory_logs')

    // 9. 更新訂單履約狀態
    const hasDelivered = deliveredItems.length > 0
    const hasNotDelivered = notDeliveredItems.length > 0
    let fulfillmentStatus = 'none'
    if (hasDelivered && !hasNotDelivered) {
      fulfillmentStatus = 'completed'
    } else if (hasDelivered && hasNotDelivered) {
      fulfillmentStatus = 'partial'
    }

    await (supabaseServer
      .from('sales') as any)
      .update({ fulfillment_status: fulfillmentStatus })
      .eq('id', sale.id)

    // 10. 自動創建應收帳款（AR）記錄 - 如果客戶未付款且有應收金額
    if (draft.customer_code && !effectiveIsPaid && finalTotal > 0) {
      // 計算每個商品的到期日（預設 7 天後）
      const dueDate = new Date(taiwanTime)
      dueDate.setDate(dueDate.getDate() + 7)
      const dueDateStr = dueDate.toISOString().split('T')[0]

      // 計算總小計（用於按比例分配）
      const totalSubtotal = insertedSaleItems.reduce((sum: number, item: any) => sum + item.subtotal, 0)

      // 為每個銷售明細創建 AR 記錄（按比例分配扣除購物金後的金額）
      let remainingAmount = finalTotal // 用於處理四捨五入誤差
      const arRecords = insertedSaleItems.map((saleItem: any, index: number) => {
        let itemAmount: number
        if (index === insertedSaleItems.length - 1) {
          // 最後一筆用剩餘金額，避免四捨五入誤差
          itemAmount = remainingAmount
        } else {
          // 按比例分配
          itemAmount = Math.round(finalTotal * (saleItem.subtotal / totalSubtotal))
          remainingAmount -= itemAmount
        }

        return {
          partner_type: 'customer',
          partner_code: draft.customer_code,
          direction: 'AR',
          ref_type: 'sale',
          ref_id: sale.id,
          sale_item_id: saleItem.id,
          amount: itemAmount,
          received_paid: 0,
          due_date: dueDateStr,
          status: 'unpaid',
          note: storeCreditUsed > 0
            ? `銷售單 ${saleNo}（已使用購物金 $${storeCreditUsed}）`
            : `銷售單 ${saleNo}`,
        }
      }).filter((ar: any) => ar.amount > 0) // 過濾掉金額為 0 的記錄

      if (arRecords.length > 0) {
        const { error: arError } = await (supabaseServer
          .from('partner_accounts') as any)
          .insert(arRecords)

        if (arError) {
          console.error('Failed to create AR records:', arError)
          // AR 創建失敗不影響銷售流程，只記錄錯誤
        }
      }
    }

    mark('fulfillment_status + AR')

    console.log(
      `\n⏱️  [結帳耗時] 總計 ${(performance.now() - t0).toFixed(0)}ms  (${draft.items.length} 個品項)\n` +
      marks.map(m => `      ${m}`).join('\n') + '\n'
    )

    return NextResponse.json(
      { ok: true, data: confirmedSale },
      { status: 201 }
    )
  } catch (error) {
    console.error('[Sales API] 系統錯誤:', error)
    console.log(`⏱️  [結帳耗時-失敗] ${(performance.now() - t0).toFixed(0)}ms\n` + marks.map(m => `      ${m}`).join('\n'))
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
