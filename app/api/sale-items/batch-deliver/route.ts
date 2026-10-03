import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { generateCode } from '@/lib/utils'
import { getMaxDeliveryNumber } from '@/lib/delivery-no'

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
        // 创建出货单（含 retry 機制，失敗後重新查詢最大編號）
        const totalQuantity = items.reduce((sum: number, item: any) => sum + item.requestedQty, 0)
        let delivery: any = null
        let deliveryError: any = null
        const maxRetries = 10

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          // 每次嘗試都重新查詢最大編號
          const currentMax = await getMaxDeliveryNumber()
          const randomOffset = Math.floor(Math.random() * 3)
          const nextNumber = currentMax + 1 + randomOffset
          const deliveryNo = generateCode('D', nextNumber - 1)

          console.log(`[Batch Deliver] Attempting delivery_no: ${deliveryNo} (attempt ${attempt + 1}/${maxRetries}, max=${currentMax})`)

          const { data, error } = await (supabaseServer
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

          if (!error) {
            delivery = data
            break
          }

          deliveryError = error
          console.warn(`[Batch Deliver] Insert failed:`, error.code, error.message)

          const isUniqueError = error.code === '23505' ||
            error.message?.includes('duplicate') ||
            error.message?.includes('unique')

          if (!isUniqueError) {
            break
          }

          const delay = 50 + Math.floor(Math.random() * 100)
          await new Promise(resolve => setTimeout(resolve, delay))
        }

        if (!delivery) {
          deliveryErrors.push(`銷售單 ${items[0].sales.sale_no} 建立出貨單失敗: ${deliveryError?.message || '無法生成唯一單號'}`)
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
        //
        // ⚠️ 這段原本是「批次 insert 一次寫完，失敗只記錄警告」，結果出貨單留在
        //    已確認狀態、庫存卻完全沒扣 —— 畫面上還是顯示出貨成功。
        //    2026-10-03 稽核發現這條路徑歷史上 4 次出貨全部沒寫進日誌
        //    （整個 inventory_logs 裡一筆「批量出貨」的紀錄都沒有，
        //     而結帳那條路徑同期寫了 6000 多筆），共 73 件庫存沒扣。
        //
        // 所以改成：
        //   1. 逐筆寫入 —— 一筆失敗不會把整批拖下水，而且錯誤訊息講得出是哪個商品
        //   2. 寫完讀回來核對筆數
        //   3. 對不上就把這張出貨單整個刪掉並回報失敗
        //      寧可讓店員看到「出貨失敗請重試」，也不要留下庫存沒扣的已確認出貨單
        // 官方套一番賞賞品沒有對應商品（product_id 為 null），本來就不進庫存。
        const logTargets = items.filter((item: any) => !!item.product_id)
        const logFailures: string[] = []

        for (const item of logTargets) {
          const { error: invLogError } = await (supabaseServer
            .from('inventory_logs') as any)
            .insert({
              product_id: item.product_id,
              ref_type: 'delivery',
              ref_id: delivery.id,
              qty_change: -item.requestedQty,
              // memo 跟結帳那條路徑一致，少一個會出問題的變數
              memo: `出貨扣庫存 - ${delivery.delivery_no}`,
            })

          if (invLogError) {
            console.error(`[Batch Deliver] 寫入庫存日誌失敗 delivery=${delivery.delivery_no} product=${item.product_id}:`, invLogError)
            logFailures.push(`${item.snapshot_name || item.product_id}：${invLogError.message}`)
          }
        }

        // 核對：實際寫進去的筆數要跟應寫的一致
        const { data: writtenLogs, error: verifyError } = await (supabaseServer
          .from('inventory_logs') as any)
          .select('id')
          .eq('ref_type', 'delivery')
          .eq('ref_id', delivery.id)

        const writtenCount = writtenLogs?.length ?? -1
        if (logFailures.length > 0 || verifyError || writtenCount !== logTargets.length) {
          console.error(
            `[Batch Deliver] 庫存扣除不完整，回滾出貨單 ${delivery.delivery_no}：` +
            `應寫 ${logTargets.length} 筆、實際 ${writtenCount} 筆`,
            logFailures
          )

          // 回滾：先刪日誌，再刪明細與出貨單，讓店員可以重新出貨
          await (supabaseServer.from('inventory_logs') as any)
            .delete().eq('ref_type', 'delivery').eq('ref_id', delivery.id)
          await (supabaseServer.from('delivery_items') as any).delete().eq('delivery_id', delivery.id)
          await (supabaseServer.from('deliveries') as any).delete().eq('id', delivery.id)

          deliveryErrors.push(
            `銷售單 ${items[0].sales.sale_no} 出貨失敗（庫存未扣除，出貨單已取消，請重試）` +
            (logFailures.length > 0 ? `：${logFailures.join('；')}` : '')
          )
          continue
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
          delivery_no: delivery.delivery_no,
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

    const message = `成功出貨 ${createdDeliveries.length} 個銷售單，共 ${itemsToDeliver.length} 個商品${deliveryErrors.length > 0 ? `\n\n部分失敗：\n${deliveryErrors.join('\n')}` : ''
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
