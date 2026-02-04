import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// POST /api/sale-items/batch-deliver - 批量出货多个商品明细
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { items } = body

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { ok: false, error: '請提供要出貨的商品明細陣列' },
        { status: 400 }
      )
    }

    // 驗證每個項目都有 sale_item_id 和 quantity
    for (const item of items) {
      if (!item.sale_item_id || typeof item.quantity !== 'number' || item.quantity <= 0) {
        return NextResponse.json(
          { ok: false, error: '每個商品必須包含 sale_item_id 和有效的 quantity' },
          { status: 400 }
        )
      }
    }

    const saleItemIds = items.map((item: any) => item.sale_item_id)
    const quantityMap = new Map(items.map((item: any) => [item.sale_item_id, item.quantity]))

    // 1. 获取所有 sale_items 信息
    const { data: saleItems, error: fetchError } = await (supabaseServer
      .from('sale_items') as any)
      .select(`
        *,
        sales!inner (
          id,
          sale_no,
          customer_code,
          sale_date
        ),
        products (
          item_code,
          name,
          stock
        )
      `)
      .in('id', saleItemIds)

    if (fetchError || !saleItems || saleItems.length === 0) {
      return NextResponse.json(
        { ok: false, error: '找不到指定的商品明細' },
        { status: 404 }
      )
    }

    // 2. 檢查每個商品的已出貨數量
    const { data: existingDeliveryItems } = await (supabaseServer
      .from('delivery_items') as any)
      .select(`
        sale_item_id,
        quantity,
        deliveries!inner (
          id,
          status
        )
      `)
      .in('sale_item_id', saleItemIds)
      .eq('deliveries.status', 'confirmed')

    // 計算每個 sale_item 已經出貨的數量
    const deliveredQuantityMap = new Map<string, number>()
    existingDeliveryItems?.forEach((di: any) => {
      const currentQty = deliveredQuantityMap.get(di.sale_item_id) || 0
      deliveredQuantityMap.set(di.sale_item_id, currentQty + di.quantity)
    })

    // 3. 驗證數量和庫存
    const errors: string[] = []
    const itemsToDeliver: any[] = []

    for (const item of saleItems) {
      const requestedQty = quantityMap.get(item.id) || 0
      const deliveredQty = deliveredQuantityMap.get(item.id) || 0
      const storeCreditQty = item.store_credit_qty || 0
      const remainingQty = item.quantity - deliveredQty - storeCreditQty

      // 檢查是否已經全部處理（出貨或轉購物金）
      if (remainingQty <= 0) {
        errors.push(`${item.products.name} 已全部處理`)
        continue
      }

      // 檢查請求數量是否超過剩餘數量
      if (requestedQty > remainingQty) {
        errors.push(
          `${item.products.name} 請求數量 (${requestedQty}) 超過剩餘數量 (${remainingQty})`
        )
        continue
      }

      // 不再檢查庫存，支援負庫存出貨
      // if (item.products.stock < requestedQty) {
      //   errors.push(
      //     `${item.products.name} 庫存不足 (庫存: ${item.products.stock}, 需要: ${requestedQty})`
      //   )
      //   continue
      // }

      itemsToDeliver.push({
        ...item,
        requestedQty
      })
    }

    if (itemsToDeliver.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: '沒有可以出貨的商品：\n' + errors.join('\n')
        },
        { status: 400 }
      )
    }

    // 4. 按 sale_id 分组（可能有多个销售单）
    const itemsBySale = new Map<string, any[]>()
    for (const item of itemsToDeliver) {
      const saleId = item.sales.id
      if (!itemsBySale.has(saleId)) {
        itemsBySale.set(saleId, [])
      }
      itemsBySale.get(saleId)!.push(item)
    }

    // 5. 为每个销售单创建出货单
    const createdDeliveries: any[] = []
    const deliveryErrors: string[] = []

    for (const [saleId, items] of itemsBySale.entries()) {
      try {
        // 生成出货单号
        const { data: lastDeliveryArray } = await supabaseServer
          .from('deliveries')
          .select('delivery_no')
          .order('created_at', { ascending: false })
          .limit(1)

        let nextNumber = 1
        if (lastDeliveryArray && lastDeliveryArray.length > 0) {
          const lastDelivery = lastDeliveryArray[0] as { delivery_no: string }
          const match = lastDelivery.delivery_no.match(/\d+/)
          if (match) {
            nextNumber = parseInt(match[0], 10) + 1
          }
        }

        const deliveryNo = `D${String(nextNumber).padStart(4, '0')}`

        // 创建出货单
        const totalQuantity = items.reduce((sum: number, item: any) => sum + item.requestedQty, 0)
        const { data: delivery, error: deliveryError } = await (supabaseServer
          .from('deliveries') as any)
          .insert({
            delivery_no: deliveryNo,
            sale_id: saleId,
            delivery_date: new Date().toISOString().split('T')[0],
            status: 'confirmed',
            note: `批量出貨 - ${items.length} 項商品，共 ${totalQuantity} 件`
          })
          .select()
          .single()

        if (deliveryError) {
          deliveryErrors.push(`銷售單 ${items[0].sales.sale_no} 建立出貨單失敗: ${deliveryError.message}`)
          continue
        }

        // 建立出貨明細
        const deliveryItems = items.map((item: any) => ({
          delivery_id: delivery.id,
          sale_item_id: item.id,
          product_id: item.product_id,
          quantity: item.requestedQty
        }))

        console.log('[Batch Deliver] Creating delivery_items:', deliveryItems)

        const { error: itemsError } = await (supabaseServer
          .from('delivery_items') as any)
          .insert(deliveryItems)

        if (!itemsError) {
          console.log('[Batch Deliver] Successfully created delivery_items')
        }

        if (itemsError) {
          await (supabaseServer.from('deliveries') as any).delete().eq('id', delivery.id)
          deliveryErrors.push(`銷售單 ${items[0].sales.sale_no} 建立出貨明細失敗: ${itemsError.message}`)
          continue
        }

        // 寫入庫存日誌（trigger 會自動扣除庫存）
        for (const item of items) {
          await (supabaseServer
            .from('inventory_logs') as any)
            .insert({
              product_id: item.product_id,
              ref_type: 'delivery',
              ref_id: delivery.id,
              qty_change: -item.requestedQty,
              memo: `批量出貨 - ${deliveryNo} (${item.snapshot_name} x${item.requestedQty})`
            })
        }

        // 更新 sale 的 fulfillment_status（考慮出貨和購物金轉換）
        const { data: allSaleItems } = await (supabaseServer
          .from('sale_items') as any)
          .select('id, quantity, store_credit_qty')
          .eq('sale_id', saleId)

        const allItemIds = allSaleItems?.map((item: any) => item.id) || []

        const { data: confirmedDeliveryItems } = await (supabaseServer
          .from('delivery_items') as any)
          .select(`
            sale_item_id,
            quantity,
            deliveries!inner (
              status
            )
          `)
          .in('sale_item_id', allItemIds)
          .eq('deliveries.status', 'confirmed')

        // 计算每个 sale_item 的已出货总量
        const confirmedDeliveredMap = new Map<string, number>()
        confirmedDeliveryItems?.forEach((di: any) => {
          const currentQty = confirmedDeliveredMap.get(di.sale_item_id) || 0
          confirmedDeliveredMap.set(di.sale_item_id, currentQty + di.quantity)
        })

        // 计算履行状态（考慮出貨和購物金轉換）
        let fullyDeliveredCount = 0
        let partiallyDeliveredCount = 0

        for (const si of (allSaleItems || [])) {
          const deliveredQty = confirmedDeliveredMap.get(si.id) || 0
          const scQty = si.store_credit_qty || 0
          const resolvedQty = deliveredQty + scQty

          if (resolvedQty >= si.quantity) {
            fullyDeliveredCount++
          } else if (resolvedQty > 0) {
            partiallyDeliveredCount++
          }
        }

        let newFulfillmentStatus = 'none'
        if (fullyDeliveredCount === allItemIds.length) {
          newFulfillmentStatus = 'completed'
        } else if (fullyDeliveredCount > 0 || partiallyDeliveredCount > 0) {
          newFulfillmentStatus = 'partial'
        }

        await (supabaseServer
          .from('sales') as any)
          .update({ fulfillment_status: newFulfillmentStatus })
          .eq('id', saleId)

        createdDeliveries.push({
          delivery_no: deliveryNo,
          sale_no: items[0].sales.sale_no,
          item_count: items.length
        })
      } catch (err) {
        console.error('Error creating delivery for sale:', saleId, err)
        deliveryErrors.push(`銷售單處理失敗`)
      }
    }

    if (createdDeliveries.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: '批量出貨失敗：\n' + deliveryErrors.join('\n')
        },
        { status: 500 }
      )
    }

    const message = `成功出貨 ${createdDeliveries.length} 個銷售單，共 ${itemsToDeliver.length} 個商品${
      deliveryErrors.length > 0 ? `\n\n部分失敗：\n${deliveryErrors.join('\n')}` : ''
    }`

    return NextResponse.json({
      ok: true,
      data: {
        deliveries: createdDeliveries,
        total_items: itemsToDeliver.length,
        skipped_items: saleItems.length - itemsToDeliver.length
      },
      message
    })
  } catch (err) {
    console.error('Batch deliver error:', err)
    return NextResponse.json(
      { ok: false, error: '批量出貨失敗' },
      { status: 500 }
    )
  }
}
