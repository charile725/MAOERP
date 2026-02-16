import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { getTaiwanTime } from '@/lib/timezone'

type RouteContext = {
    params: Promise<{ id: string }>
}

// POST /api/sale-items/:id/to-store-credit - 將單一銷售品項轉為購物金
// 條件：只有售價=0的品項才能轉購物金
// 流程：輸入數量 -> 輸入金額 -> 增加客戶購物金 -> 回補庫存（以輸入金額作為成本）
export async function POST(
    request: NextRequest,
    context: RouteContext
) {
    try {
        const { id: saleItemId } = await context.params
        const body = await request.json()
        const { amount, quantity: requestedQuantity, note } = body

        // 驗證金額
        if (!amount || amount <= 0) {
            return NextResponse.json(
                { ok: false, error: '請輸入有效的金額' },
                { status: 400 }
            )
        }

        // 驗證數量（如果有提供）
        if (requestedQuantity !== undefined && requestedQuantity !== null) {
            if (requestedQuantity <= 0 || !Number.isInteger(requestedQuantity)) {
                return NextResponse.json(
                    { ok: false, error: '請輸入有效的數量（正整數）' },
                    { status: 400 }
                )
            }
        }

        // 1. 查詢銷售品項
        const { data: saleItem, error: itemError } = await (supabaseServer
            .from('sale_items') as any)
            .select(`
        *,
        sales (
          id,
          sale_no,
          customer_code,
          status,
          customers (
            customer_name,
            store_credit
          )
        ),
        products (
          id,
          name,
          stock,
          avg_cost
        )
      `)
            .eq('id', saleItemId)
            .single()

        if (itemError || !saleItem) {
            return NextResponse.json(
                { ok: false, error: '找不到銷售品項' },
                { status: 404 }
            )
        }

        // 2. 驗證售價必須為 0
        if (saleItem.price !== 0) {
            return NextResponse.json(
                { ok: false, error: '只有售價為 $0 的品項才能轉購物金' },
                { status: 400 }
            )
        }

        // 2.1 檢查此品項是否已出貨 → 已出貨不能轉購物金
        const { data: deliveredItems } = await (supabaseServer
            .from('delivery_items') as any)
            .select(`
                quantity,
                deliveries!inner (status)
            `)
            .eq('sale_item_id', saleItemId)
            .eq('deliveries.status', 'confirmed')
            .limit(1)

        if (deliveredItems && deliveredItems.length > 0) {
            return NextResponse.json(
                { ok: false, error: '此品項已出貨，已出貨商品不能轉購物金' },
                { status: 400 }
            )
        }

        // 2.5 驗證並設定轉換數量（考慮已轉換的數量）
        const alreadyConverted = saleItem.store_credit_qty || 0
        const remainingConvertible = saleItem.quantity - alreadyConverted
        const convertQuantity = requestedQuantity ?? remainingConvertible

        if (convertQuantity > remainingConvertible) {
            return NextResponse.json(
                { ok: false, error: `轉換數量超過可轉換數量（剩餘可轉換：${remainingConvertible}）` },
                { status: 400 }
            )
        }

        const sale = saleItem.sales
        if (!sale) {
            return NextResponse.json(
                { ok: false, error: '找不到對應的銷售單' },
                { status: 404 }
            )
        }

        // 3. 驗證客戶
        if (!sale.customer_code) {
            return NextResponse.json(
                { ok: false, error: '此銷售單沒有關聯客戶，無法轉為購物金' },
                { status: 400 }
            )
        }

        const customer = sale.customers
        if (!customer) {
            return NextResponse.json(
                { ok: false, error: '找不到客戶資料' },
                { status: 404 }
            )
        }

        const conversionAmount = parseFloat(amount)

        // 4. 更新客戶購物金餘額（先讀取最新值再更新，避免 race condition）
        const { data: latestCustomer, error: fetchCustomerError } = await (supabaseServer
            .from('customers') as any)
            .select('store_credit')
            .eq('customer_code', sale.customer_code)
            .single()

        if (fetchCustomerError || !latestCustomer) {
            return NextResponse.json(
                { ok: false, error: '讀取客戶資料失敗' },
                { status: 500 }
            )
        }

        const storeCreditBefore = latestCustomer.store_credit || 0
        const storeCreditAfter = storeCreditBefore + conversionAmount

        const { error: updateCustomerError } = await (supabaseServer
            .from('customers') as any)
            .update({ store_credit: storeCreditAfter })
            .eq('customer_code', sale.customer_code)

        if (updateCustomerError) {
            return NextResponse.json(
                { ok: false, error: '更新客戶購物金失敗' },
                { status: 500 }
            )
        }

        // 5. 記錄購物金變動日誌
        await (supabaseServer
            .from('customer_balance_logs') as any)
            .insert({
                customer_code: sale.customer_code,
                amount: conversionAmount,
                balance_before: storeCreditBefore,
                balance_after: storeCreditAfter,
                type: 'refund',
                ref_type: 'sale_item',
                ref_id: saleItem.id,
                ref_no: sale.sale_no,
                note: note || `銷售品項 ${saleItem.products?.name} 轉購物金 (${convertQuantity}/${saleItem.quantity}件)`,
                created_at: getTaiwanTime(),
            })

        // 6. 回補庫存（只有已出貨的部分才回補）
        // 先查詢該品項的已出貨數量
        let deliveredQuantity = 0
        const { data: deliveryItems } = await (supabaseServer
            .from('delivery_items') as any)
            .select(`
                quantity,
                deliveries!inner (
                    status
                )
            `)
            .eq('sale_item_id', saleItemId)
            .eq('deliveries.status', 'confirmed')

        if (deliveryItems) {
            deliveredQuantity = deliveryItems.reduce((sum: number, di: any) => sum + di.quantity, 0)
        }

        // 計算已出貨但尚未轉購物金的數量（可以回補的最大數量）
        const alreadyConvertedToStoreCredit = saleItem.store_credit_qty || 0
        const maxRestoreQty = Math.max(0, deliveredQuantity - alreadyConvertedToStoreCredit)
        // 實際回補數量 = min(這次轉換數量, 可回補數量)
        const restoreQty = Math.min(convertQuantity, maxRestoreQty)

        let inventoryRestored = 0
        let newAvgCost = 0
        if (saleItem.product_id && restoreQty > 0) {
            const product = saleItem.products
            const currentStock = product?.stock || 0
            const currentAvgCost = product?.avg_cost || 0
            const unitCost = conversionAmount / convertQuantity // 用輸入金額當作成本

            // 計算新的平均成本
            // 新平均成本 = (現有庫存 * 現有平均成本 + 回補數量 * 單位成本) / (現有庫存 + 回補數量)
            const totalCostBefore = currentStock * currentAvgCost
            const addedCost = restoreQty * unitCost
            const newTotalStock = currentStock + restoreQty
            newAvgCost = newTotalStock > 0 ? (totalCostBefore + addedCost) / newTotalStock : unitCost

            // 更新商品平均成本
            await (supabaseServer
                .from('products') as any)
                .update({ avg_cost: newAvgCost })
                .eq('id', saleItem.product_id)

            // 寫入庫存日誌（trigger 會自動更新 stock）
            const { error: invLogError } = await (supabaseServer
                .from('inventory_logs') as any)
                .insert({
                    product_id: saleItem.product_id,
                    ref_type: 'return',
                    ref_id: saleItem.id,
                    qty_change: restoreQty,
                    unit_cost: unitCost,
                    memo: `轉購物金回補 - ${sale.sale_no} (已出貨${restoreQty}件回補, 成本: $${unitCost.toFixed(2)}/件)`,
                })

            if (!invLogError) {
                inventoryRestored = restoreQty
            }
        }

        // 7. 處理相關應收帳款（如有已收款需退款）
        const { data: arForItem } = await (supabaseServer
            .from('partner_accounts') as any)
            .select('id, amount, received_paid')
            .eq('sale_item_id', saleItem.id)

        if (arForItem && arForItem.length > 0) {
            const arIds = arForItem.map((ar: any) => ar.id)
            const totalPaidOnAR = arForItem.reduce((sum: number, ar: any) => sum + (ar.received_paid || 0), 0)

            // 如果有已收款金額，需要退還
            if (totalPaidOnAR > 0) {
                const { data: arAllocations } = await (supabaseServer
                    .from('settlement_allocations') as any)
                    .select('id, settlement_id, amount')
                    .in('partner_account_id', arIds)

                if (arAllocations && arAllocations.length > 0) {
                    const refundBySettlement = new Map<string, { amount: number, allocIds: string[] }>()
                    for (const alloc of arAllocations) {
                        const existing = refundBySettlement.get(alloc.settlement_id) || { amount: 0, allocIds: [] }
                        existing.amount += alloc.amount
                        existing.allocIds.push(alloc.id)
                        refundBySettlement.set(alloc.settlement_id, existing)
                    }

                    for (const [settlementId, { amount: refundAmount, allocIds }] of refundBySettlement.entries()) {
                        const { data: stl } = await (supabaseServer
                            .from('settlements') as any)
                            .select('amount, account_id, method, partner_code')
                            .eq('id', settlementId)
                            .single()

                        if (stl) {
                            if (stl.method === 'store_credit' && stl.partner_code) {
                                const { data: cust } = await (supabaseServer
                                    .from('customers') as any)
                                    .select('store_credit')
                                    .eq('customer_code', stl.partner_code)
                                    .single()
                                if (cust) {
                                    const scBefore = cust.store_credit || 0
                                    const scAfter = scBefore + refundAmount
                                    await (supabaseServer
                                        .from('customers') as any)
                                        .update({ store_credit: scAfter })
                                        .eq('customer_code', stl.partner_code)

                                    // 記錄購物金變動日誌
                                    await (supabaseServer
                                        .from('customer_balance_logs') as any)
                                        .insert({
                                            customer_code: stl.partner_code,
                                            amount: refundAmount,
                                            balance_before: scBefore,
                                            balance_after: scAfter,
                                            type: 'refund',
                                            ref_type: 'sale_item_refund',
                                            ref_id: saleItem.id,
                                            ref_no: sale.sale_no,
                                            note: `轉購物金退還原付款 - ${sale.sale_no}`,
                                            created_at: getTaiwanTime(),
                                        })
                                }
                            } else if (stl.account_id) {
                                const { data: acct } = await (supabaseServer
                                    .from('accounts') as any)
                                    .select('balance')
                                    .eq('id', stl.account_id)
                                    .single()
                                if (acct) {
                                    const balanceBefore = Number(acct.balance)
                                    const balanceAfter = balanceBefore - refundAmount
                                    await (supabaseServer
                                        .from('accounts') as any)
                                        .update({ balance: balanceAfter, updated_at: getTaiwanTime() })
                                        .eq('id', stl.account_id)

                                    // 記錄帳戶交易
                                    await (supabaseServer
                                        .from('account_transactions') as any)
                                        .insert({
                                            account_id: stl.account_id,
                                            transaction_type: 'sale_to_store_credit',
                                            amount: -refundAmount,
                                            balance_before: balanceBefore,
                                            balance_after: balanceAfter,
                                            ref_type: 'sale_to_store_credit',
                                            ref_id: saleItem.id,
                                            ref_no: sale.sale_no,
                                            note: `單品轉購物金退還原付款 - ${sale.sale_no}`,
                                            created_at: getTaiwanTime(),
                                        })
                                }
                            }
                        }

                        // 刪除本項目的 allocations
                        for (const allocId of allocIds) {
                            await (supabaseServer
                                .from('settlement_allocations') as any)
                                .delete()
                                .eq('id', allocId)
                        }

                        // 檢查 settlement 是否還有其他 allocations
                        const { data: remaining } = await (supabaseServer
                            .from('settlement_allocations') as any)
                            .select('id, amount')
                            .eq('settlement_id', settlementId)

                        if (!remaining || remaining.length === 0) {
                            await (supabaseServer
                                .from('account_transactions') as any)
                                .delete()
                                .eq('ref_type', 'settlement')
                                .eq('ref_id', settlementId)
                            await (supabaseServer
                                .from('settlements') as any)
                                .delete()
                                .eq('id', settlementId)
                        } else {
                            const newAmount = remaining.reduce((s: number, a: any) => s + a.amount, 0)
                            await (supabaseServer
                                .from('settlements') as any)
                                .update({ amount: newAmount })
                                .eq('id', settlementId)
                        }
                    }
                }
            }

            // 刪除 AR 記錄
            await (supabaseServer
                .from('partner_accounts') as any)
                .delete()
                .in('id', arIds)
        }

        // 7.5 釋放一番賞複選獎選項（如果有的話）
        await (supabaseServer
            .from('ichiban_kuji_prize_options') as any)
            .update({ is_consumed: false, consumed_sale_item_id: null })
            .eq('consumed_sale_item_id', saleItemId)

        // 8. 記錄銷貨更正
        await (supabaseServer
            .from('sale_corrections') as any)
            .insert({
                sale_id: sale.id,
                correction_type: 'to_store_credit',
                original_total: 0,
                corrected_total: 0,
                adjustment_amount: 0,
                store_credit_granted: conversionAmount,
                items_adjusted: [{ sale_item_id: saleItem.id, quantity: convertQuantity, original_quantity: saleItem.quantity, amount: conversionAmount }],
                note: note || `單品轉購物金 - ${saleItem.products?.name} (${convertQuantity}/${saleItem.quantity}件)`,
                created_at: getTaiwanTime(),
            })

        // 9. 更新品項的購物金轉換狀態
        await (supabaseServer
            .from('sale_items') as any)
            .update({
                store_credit_qty: (saleItem.store_credit_qty || 0) + convertQuantity,
                store_credit_amount: (saleItem.store_credit_amount || 0) + conversionAmount,
            })
            .eq('id', saleItemId)

        // 10. 更新 sale 的 fulfillment_status（考慮出貨和購物金轉換）
        const { data: allSaleItems } = await (supabaseServer
            .from('sale_items') as any)
            .select('id, quantity, store_credit_qty')
            .eq('sale_id', sale.id)

        const allItemIds = allSaleItems?.map((item: any) => item.id) || []

        const { data: confirmedDeliveryItems } = await (supabaseServer
            .from('delivery_items') as any)
            .select(`
                sale_item_id,
                quantity,
                deliveries!inner (status)
            `)
            .in('sale_item_id', allItemIds)
            .eq('deliveries.status', 'confirmed')

        const deliveredQuantityMap = new Map<string, number>()
        confirmedDeliveryItems?.forEach((di: any) => {
            const currentQty = deliveredQuantityMap.get(di.sale_item_id) || 0
            deliveredQuantityMap.set(di.sale_item_id, currentQty + di.quantity)
        })

        let fullyResolvedCount = 0
        let partiallyResolvedCount = 0

        for (const item of (allSaleItems || [])) {
            const deliveredQty = deliveredQuantityMap.get(item.id) || 0
            // 用更新後的 store_credit_qty
            const scQty = item.id === saleItemId
                ? (saleItem.store_credit_qty || 0) + convertQuantity
                : (item.store_credit_qty || 0)
            const resolvedQty = deliveredQty + scQty

            if (resolvedQty >= item.quantity) {
                fullyResolvedCount++
            } else if (resolvedQty > 0) {
                partiallyResolvedCount++
            }
        }

        let newFulfillmentStatus = 'none'
        if (fullyResolvedCount === allItemIds.length) {
            newFulfillmentStatus = 'completed'
        } else if (fullyResolvedCount > 0 || partiallyResolvedCount > 0) {
            newFulfillmentStatus = 'partial'
        }

        await (supabaseServer
            .from('sales') as any)
            .update({ fulfillment_status: newFulfillmentStatus })
            .eq('id', sale.id)

        return NextResponse.json({
            ok: true,
            data: {
                sale_item_id: saleItem.id,
                sale_no: sale.sale_no,
                product_name: saleItem.products?.name,
                customer_name: customer.customer_name,
                conversion_amount: conversionAmount,
                converted_quantity: convertQuantity,
                original_quantity: saleItem.quantity,
                store_credit_before: storeCreditBefore,
                store_credit_after: storeCreditAfter,
                inventory_restored: inventoryRestored,
                new_avg_cost: newAvgCost,
            }
        })
    } catch (error) {
        console.error('Sale item to store credit error:', error)
        return NextResponse.json(
            { ok: false, error: '系統錯誤' },
            { status: 500 }
        )
    }
}
