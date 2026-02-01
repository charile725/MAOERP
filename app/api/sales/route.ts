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
    const createdFrom = searchParams.get('created_from') // 用於日結：從某時間點之後創建的訂單
    const createdTo = searchParams.get('created_to') // 用於營業日報表：到某時間點之前創建的訂單
    const customerCode = searchParams.get('customer_code')
    const source = searchParams.get('source')
    const keyword = searchParams.get('keyword')
    const productKeyword = searchParams.get('product_keyword')

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
          products (
            item_code,
            unit
          )
        )
      `)
      .order('created_at', { ascending: false })

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

    // Search by keyword in sale_no, customer_code, or customer_name
    if (keyword) {
      // First find customer codes that match the keyword
      const { data: matchingCustomers } = await (supabaseServer
        .from('customers') as any)
        .select('customer_code')
        .ilike('customer_name', `%${keyword}%`)

      const matchingCodes = matchingCustomers?.map((c: any) => c.customer_code) || []

      // Build the search query
      if (matchingCodes.length > 0) {
        query = query.or(`sale_no.ilike.%${keyword}%,customer_code.in.(${matchingCodes.join(',')})`)
      } else {
        query = query.ilike('sale_no', `%${keyword}%`)
      }
    }

    const { data, error } = await query

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
          keyword,
          productKeyword
        }
      })
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    // Filter by product if needed
    let filteredData = data
    if (productKeyword) {
      filteredData = data?.filter((sale: any) => {
        const items = sale.sale_items || []
        return items.some((item: any) =>
          item.snapshot_name?.toLowerCase().includes(productKeyword.toLowerCase()) ||
          item.products?.item_code?.toLowerCase().includes(productKeyword.toLowerCase())
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

    return NextResponse.json({ ok: true, data: salesWithSummary })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/sales - Create sale
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
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

    // Generate sale_no - 查找所有销售记录中的最大编号
    const { data: allSales } = await supabaseServer
      .from('sales')
      .select('sale_no')

    let saleCount = 0
    if (allSales && allSales.length > 0) {
      // 從所有 sale_no 中找出最大的數字
      const maxNumber = allSales.reduce((max: number, sale: any) => {
        const match = sale.sale_no.match(/\d+/)
        if (match) {
          const num = parseInt(match[0], 10)
          return num > max ? num : max
        }
        return max
      }, 0)
      saleCount = maxNumber
    }

    const saleNo = generateCode('S', saleCount)

    // Determine primary payment method and account
    // If payments array provided, use largest amount; otherwise use single payment_method
    let primaryPaymentMethod = draft.payment_method
    if (draft.payments && draft.payments.length > 0) {
      // Find payment with largest amount
      const largest = draft.payments.reduce((max, p) => p.amount > max.amount ? p : max, draft.payments[0])
      primaryPaymentMethod = largest.method
    }

    // Get account_id based on primary payment_method
    const { data: account } = await (supabaseServer
      .from('accounts') as any)
      .select('id')
      .eq('payment_method_code', primaryPaymentMethod)
      .eq('is_active', true)
      .single()

    const accountId = account?.id || null

    // 取得台灣時間 (UTC+8)
    const now = new Date()
    const taiwanTime = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    const createdAt = taiwanTime.toISOString() // 完整的台灣時間戳記

    // 直接使用當前台灣日期作為 sale_date（營業日）
    // 修正：之前的邏輯是「日結日期+1天」，這會導致15號日結後，15號的銷售變成16號
    // 正確做法：使用銷售當下的台灣日期
    const saleDate = taiwanTime.toISOString().split('T')[0]

    // Start transaction-like operations
    // 1. Create sale (draft)
    const { data: sale, error: saleError } = await (supabaseServer
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

    if (saleError) {
      return NextResponse.json(
        { ok: false, error: saleError.message },
        { status: 500 }
      )
    }

    // 2. Check stock availability for each item
    for (const item of draft.items) {
      // 如果是從一番賞售出，檢查一番賞庫存
      if (item.ichiban_kuji_prize_id) {
        const { data: prize } = await (supabaseServer
          .from('ichiban_kuji_prizes') as any)
          .select('remaining, prize_tier')
          .eq('id', item.ichiban_kuji_prize_id)
          .single()

        if (!prize) {
          // Rollback: delete the sale
          await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
          return NextResponse.json(
            { ok: false, error: `Prize not found: ${item.ichiban_kuji_prize_id}` },
            { status: 400 }
          )
        }

        if (prize.remaining < item.quantity) {
          // Rollback: delete the sale
          await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
          return NextResponse.json(
            {
              ok: false,
              error: `${prize.prize_tier} 庫存不足。剩餘: ${prize.remaining}, 需要: ${item.quantity}`,
            },
            { status: 400 }
          )
        }
      } else {
        // 一般商品，檢查商品庫存
        const { data: product } = await (supabaseServer
          .from('products') as any)
          .select('stock, allow_negative, name')
          .eq('id', item.product_id)
          .single()

        if (!product) {
          // Rollback: delete the sale
          await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
          return NextResponse.json(
            { ok: false, error: `Product not found: ${item.product_id}` },
            { status: 400 }
          )
        }

        if (!product.allow_negative && product.stock < item.quantity) {
          // Rollback: delete the sale
          await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
          return NextResponse.json(
            {
              ok: false,
              error: `${product.name} 庫存不足。剩餘: ${product.stock}, 需要: ${item.quantity}`,
            },
            { status: 400 }
          )
        }
      }
    }

    // 3. Get product details and insert sale items (subtotal is auto-calculated by database)
    const saleItems = await Promise.all(
      draft.items.map(async (item) => {
        const { data: product } = await (supabaseServer
          .from('products') as any)
          .select('name, cost, avg_cost')
          .eq('id', item.product_id)
          .single()

        return {
          sale_id: sale.id,
          product_id: item.product_id,
          quantity: item.quantity,
          price: item.price,
          cost: product?.avg_cost || product?.cost || 0,  // 優先使用加權平均成本
          snapshot_name: product?.name || null,
          ichiban_kuji_prize_id: item.ichiban_kuji_prize_id || null,
          ichiban_kuji_id: item.ichiban_kuji_id || null,
        }
      })
    )

    const { data: insertedSaleItems, error: itemsError } = await (supabaseServer
      .from('sale_items') as any)
      .insert(saleItems)
      .select()

    if (itemsError) {
      // Rollback: delete the sale
      await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
      return NextResponse.json(
        { ok: false, error: itemsError.message },
        { status: 500 }
      )
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

    if (draft.customer_code) {
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

    // 5. Deduct ONLY ichiban kuji remaining (product stock is auto-deducted by DB trigger)
    for (const item of draft.items) {
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

    if (confirmError) {
      // Rollback: restore customer store credit if used
      if (storeCreditUsed > 0 && draft.customer_code) {
        const { data: customer } = await (supabaseServer
          .from('customers') as any)
          .select('store_credit')
          .eq('customer_code', draft.customer_code)
          .single()

        if (customer) {
          await (supabaseServer
            .from('customers') as any)
            .update({ store_credit: customer.store_credit + storeCreditUsed })
            .eq('customer_code', draft.customer_code)
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
    if (draft.is_paid) {
      // Determine payments to process
      const paymentsToProcess = draft.payments && draft.payments.length > 0
        ? draft.payments
        : [{ method: draft.payment_method, amount: finalTotal }]

      // Process each payment
      for (const payment of paymentsToProcess) {
        // Get account for this payment method
        const { data: paymentAccount } = await (supabaseServer
          .from('accounts') as any)
          .select('id')
          .eq('payment_method_code', payment.method)
          .eq('is_active', true)
          .single()

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

    // 7. 創建出貨單（支援部分出貨）
    const { data: allDeliveries } = await (supabaseServer
      .from('deliveries') as any)
      .select('delivery_no')

    let deliveryCount = 0
    if (allDeliveries && allDeliveries.length > 0) {
      const maxNumber = allDeliveries.reduce((max: number, delivery: any) => {
        const match = delivery.delivery_no.match(/\d+/)
        if (match) {
          const num = parseInt(match[0], 10)
          return num > max ? num : max
        }
        return max
      }, 0)
      deliveryCount = maxNumber
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
      const deliveryNo = generateCode('D', deliveryCount)
      deliveryCount++

      const { data: delivery, error: deliveryError } = await (supabaseServer
        .from('deliveries') as any)
        .insert({
          delivery_no: deliveryNo,
          sale_id: sale.id,
          status: 'confirmed',
          delivery_date: taiwanTime.toISOString(),
          method: delivery_method || null,
          note: delivery_note || null,
        })
        .select()
        .single()

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
              memo: `出貨扣庫存 - ${deliveryNo}`,
            })
        }
      }
    }

    // 8b. 創建未出貨的出貨單（如果有未出貨品項）
    if (notDeliveredItems.length > 0) {
      const deliveryNo = generateCode('D', deliveryCount)

      const { data: delivery, error: deliveryError } = await (supabaseServer
        .from('deliveries') as any)
        .insert({
          delivery_no: deliveryNo,
          sale_id: sale.id,
          status: 'draft',
          delivery_date: null,
          method: delivery_method || null,
          note: delivery_note || null,
        })
        .select()
        .single()

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
    if (draft.customer_code && !draft.is_paid && finalTotal > 0) {
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

    return NextResponse.json(
      { ok: true, data: confirmedSale },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
