import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { generateCode } from '@/lib/utils'

type OrderPreview = {
  rowNumber: number
  customerName: string
  customerPhone: string
  items: {
    identifier: string // 品號 or 一番賞名稱/賞項
    quantity: number
  }[]
  paymentMethod: string
  note: string
  isPaid: boolean
  discountType: 'none' | 'percent' | 'amount'
  discountValue: number
}

// POST /api/live-import - Batch create sales from live stream orders
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { orders } = body as { orders: OrderPreview[] }

    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      return NextResponse.json(
        { ok: false, error: '訂單資料格式錯誤' },
        { status: 400 }
      )
    }

    const results: {
      success: number
      failed: number
      errors: { row: number; error: string }[]
    } = {
      success: 0,
      failed: 0,
      errors: []
    }

    // Process each order
    for (const order of orders) {
      try {
        // 1. Match or create customer
        let customerCode: string | null = null

        if (order.customerName || order.customerPhone) {
          // Try to find existing customer by phone or name
          let customerQuery = supabaseServer.from('customers') as any

          if (order.customerPhone) {
            customerQuery = customerQuery.select('*').eq('phone', order.customerPhone)
          } else if (order.customerName) {
            customerQuery = customerQuery.select('*').eq('customer_name', order.customerName)
          }

          const { data: existingCustomers } = await customerQuery

          if (existingCustomers && existingCustomers.length > 0) {
            // Use existing customer
            customerCode = existingCustomers[0].customer_code
          } else {
            // Create new customer
            const { count } = await supabaseServer
              .from('customers')
              .select('*', { count: 'exact', head: true })

            const newCustomerCode = generateCode('C', count || 0)

            const { data: newCustomer, error: customerError } = await (supabaseServer
              .from('customers') as any)
              .insert({
                customer_code: newCustomerCode,
                customer_name: order.customerName || '散客',
                phone: order.customerPhone || null,
                payment_method: order.paymentMethod,
                is_active: true
              })
              .select()
              .single()

            if (customerError) {
              throw new Error(`建立客戶失敗: ${customerError.message}`)
            }

            customerCode = newCustomer.customer_code
          }
        }

        // 2. Match products and ichiban kuji
        type SaleItem = {
          product_id: string
          quantity: number
          price: number
          ichiban_kuji_prize_id?: string
          ichiban_kuji_id?: string
        }

        const saleItems: SaleItem[] = []

        for (const item of order.items) {
          const identifier = item.identifier.trim()

          // Check if it's an ichiban kuji item (format: "一番賞名稱/賞項")
          if (identifier.includes('/')) {
            const [kujiName, prizeTier] = identifier.split('/').map(s => s.trim())

            // Find ichiban kuji by name
            const { data: kuji } = await (supabaseServer
              .from('ichiban_kuji') as any)
              .select('id, price, name')
              .ilike('name', kujiName)
              .eq('is_active', true)
              .single()

            if (!kuji) {
              throw new Error(`找不到一番賞: ${kujiName}`)
            }

            // Find prize by tier
            const { data: prize } = await (supabaseServer
              .from('ichiban_kuji_prizes') as any)
              .select('id, product_id, remaining, prize_tier, products (price)')
              .eq('kuji_id', kuji.id)
              .ilike('prize_tier', prizeTier)
              .single()

            if (!prize) {
              throw new Error(`找不到賞項: ${kujiName}/${prizeTier}`)
            }

            if (prize.remaining < item.quantity) {
              throw new Error(`${kujiName}/${prizeTier} 庫存不足 (剩餘: ${prize.remaining})`)
            }

            saleItems.push({
              product_id: prize.product_id,
              quantity: item.quantity,
              price: prize.products.price || kuji.price,
              ichiban_kuji_prize_id: prize.id,
              ichiban_kuji_id: kuji.id
            })
          } else {
            // Regular product - match by item_code or barcode
            const { data: product } = await (supabaseServer
              .from('products') as any)
              .select('id, price, stock, allow_negative, name')
              .or(`item_code.ilike.${identifier},barcode.ilike.${identifier}`)
              .eq('is_active', true)
              .single()

            if (!product) {
              throw new Error(`找不到商品: ${identifier}`)
            }

            if (!product.allow_negative && product.stock < item.quantity) {
              throw new Error(`${product.name} 庫存不足 (剩餘: ${product.stock})`)
            }

            saleItems.push({
              product_id: product.id,
              quantity: item.quantity,
              price: product.price
            })
          }
        }

        // 3. Create sale (using similar logic to POST /api/sales)
        // Generate sale_no
        const { count } = await supabaseServer
          .from('sales')
          .select('*', { count: 'exact', head: true })

        const saleNo = generateCode('S', count || 0)

        // Get account_id based on payment_method
        const { data: account } = await (supabaseServer
          .from('accounts') as any)
          .select('id')
          .eq('payment_method_code', order.paymentMethod)
          .eq('is_active', true)
          .single()

        const accountId = account?.id || null

        // 取得台灣時間 (UTC+8)
        const now = new Date()
        const taiwanTime = new Date(now.getTime() + 8 * 60 * 60 * 1000)
        const createdAt = taiwanTime.toISOString() // 完整的台灣時間戳記

        // 根據上次日結時間決定 sale_date（營業日）
        let saleDate: string
        const { data: lastClosing } = await (supabaseServer
          .from('business_day_closings') as any)
          .select('closing_time')
          .eq('source', 'live')
          .order('closing_time', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (lastClosing?.closing_time) {
          // 日結後使用「日結日期 + 1 天」作為新的營業日
          const closingDate = new Date(lastClosing.closing_time)
          closingDate.setDate(closingDate.getDate() + 1)
          saleDate = closingDate.toISOString().split('T')[0]
        } else {
          // 第一次使用（沒有日結記錄），使用當天台灣時區的零點日期
          saleDate = taiwanTime.toISOString().split('T')[0]
        }

        // Create sale (draft)
        const { data: sale, error: saleError } = await (supabaseServer
          .from('sales') as any)
          .insert({
            sale_no: saleNo,
            customer_code: customerCode,
            sale_date: saleDate,
            source: 'live',
            payment_method: order.paymentMethod,
            account_id: accountId,
            is_paid: order.isPaid,
            note: order.note || null,
            discount_type: order.discountType,
            discount_value: order.discountValue,
            status: 'draft',
            total: 0,
            created_at: createdAt,
          })
          .select()
          .single()

        if (saleError) {
          throw new Error(`建立銷售單失敗: ${saleError.message}`)
        }

        // Insert sale items with product details
        const saleItemsWithDetails = await Promise.all(
          saleItems.map(async (item) => {
            const { data: product } = await (supabaseServer
              .from('products') as any)
              .select('name, cost')
              .eq('id', item.product_id)
              .single()

            return {
              sale_id: sale.id,
              product_id: item.product_id,
              quantity: item.quantity,
              price: item.price,
              cost: product?.cost || 0,
              snapshot_name: product?.name || null,
              ichiban_kuji_prize_id: item.ichiban_kuji_prize_id || null,
              ichiban_kuji_id: item.ichiban_kuji_id || null,
            }
          })
        )

        const { error: itemsError } = await (supabaseServer
          .from('sale_items') as any)
          .insert(saleItemsWithDetails)

        if (itemsError) {
          // Rollback: delete the sale
          await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
          throw new Error(`建立銷售明細失敗: ${itemsError.message}`)
        }

        // Calculate total with discount
        const subtotal = saleItems.reduce((sum, item) => sum + (item.quantity * item.price), 0)

        let discountAmount = 0
        if (order.discountType === 'percent') {
          discountAmount = (subtotal * order.discountValue) / 100
        } else if (order.discountType === 'amount') {
          discountAmount = order.discountValue
        }

        const total = Math.max(0, subtotal - discountAmount)

        // Deduct ichiban kuji remaining
        for (const item of saleItems) {
          if (item.ichiban_kuji_prize_id) {
            const { data: prize } = await (supabaseServer
              .from('ichiban_kuji_prizes') as any)
              .select('remaining')
              .eq('id', item.ichiban_kuji_prize_id)
              .single()

            if (!prize || prize.remaining < item.quantity) {
              // Rollback
              await (supabaseServer.from('sale_items') as any).delete().eq('sale_id', sale.id)
              await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
              throw new Error(`一番賞庫存不足`)
            }

            const { error: updatePrizeError } = await (supabaseServer
              .from('ichiban_kuji_prizes') as any)
              .update({ remaining: prize.remaining - item.quantity })
              .eq('id', item.ichiban_kuji_prize_id)

            if (updatePrizeError) {
              // Rollback
              await (supabaseServer.from('sale_items') as any).delete().eq('sale_id', sale.id)
              await (supabaseServer.from('sales') as any).delete().eq('id', sale.id)
              throw new Error(`扣除一番賞庫存失敗: ${updatePrizeError.message}`)
            }
          }
        }

        // Update sale to confirmed
        const { error: confirmError } = await (supabaseServer
          .from('sales') as any)
          .update({
            total,
            status: 'confirmed',
          })
          .eq('id', sale.id)

        if (confirmError) {
          // Rollback ichiban kuji inventory
          for (const item of saleItems) {
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
          throw new Error(`確認銷售單失敗: ${confirmError.message}`)
        }

        results.success++
      } catch (error: any) {
        results.failed++
        results.errors.push({
          row: order.rowNumber,
          error: error.message || '未知錯誤'
        })
      }
    }

    return NextResponse.json({
      ok: true,
      result: results
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message || '系統錯誤' },
      { status: 500 }
    )
  }
}
