import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { saleCorrectionSchema } from '@/lib/schemas'
import { fromZodError } from 'zod-validation-error'
import { getTaiwanTime } from '@/lib/timezone'

type RouteContext = {
    params: Promise<{ id: string }>
}

// POST /api/sales/:id/correction - 執行銷貨更正
export async function POST(
    request: NextRequest,
    context: RouteContext
) {
    try {
        const { id } = await context.params
        const body = await request.json()

        // 驗證輸入
        const validation = saleCorrectionSchema.safeParse(body)
        if (!validation.success) {
            const error = fromZodError(validation.error)
            return NextResponse.json(
                { ok: false, error: error.message },
                { status: 400 }
            )
        }

        const { items, note } = validation.data

        // 1. 獲取原銷售單資訊
        const { data: sale, error: saleError } = await (supabaseServer
            .from('sales') as any)
            .select(`
        *,
        sale_items (
          id,
          product_id,
          quantity,
          price,
          cost,
          subtotal,
          snapshot_name
        )
      `)
            .eq('id', id)
            .single()

        if (saleError || !sale) {
            console.error('[Sale Correction] Failed to find sale:', { id, saleError })
            return NextResponse.json(
                { ok: false, error: '找不到該銷售單' },
                { status: 404 }
            )
        }

        console.log('[Sale Correction] Sale found:', { id, status: sale.status, total: sale.total })

        if (sale.status !== 'confirmed') {
            console.log('[Sale Correction] Sale status is not confirmed:', sale.status)
            return NextResponse.json(
                { ok: false, error: `只能更正已確認的銷售單，目前狀態：${sale.status}` },
                { status: 400 }
            )
        }

        const originalTotal = sale.total
        const originalItems = sale.sale_items || []

        // 2. 處理每個更正項目
        const adjustedItems: any[] = []
        let inventoryChanges: { product_id: string; qty_change: number; product_name: string }[] = []
        let newTotal = 0

        for (const adjustment of items) {
            const originalItem = originalItems.find((item: any) => item.id === adjustment.sale_item_id)
            if (!originalItem) {
                return NextResponse.json(
                    { ok: false, error: `找不到銷售明細: ${adjustment.sale_item_id}` },
                    { status: 400 }
                )
            }

            const originalQty = originalItem.quantity
            const newQty = adjustment.new_quantity
            const newPrice = adjustment.new_price ?? originalItem.price
            const qtyDiff = originalQty - newQty // 正數 = 減少（需回補庫存）

            adjustedItems.push({
                sale_item_id: adjustment.sale_item_id,
                product_id: originalItem.product_id,
                product_name: originalItem.snapshot_name,
                original_quantity: originalQty,
                new_quantity: newQty,
                original_price: originalItem.price,
                new_price: newPrice,
                qty_change: qtyDiff,
            })

            if (qtyDiff !== 0) {
                inventoryChanges.push({
                    product_id: originalItem.product_id,
                    qty_change: qtyDiff, // 正數 = 回補庫存
                    product_name: originalItem.snapshot_name,
                })
            }

            // 計算新小計
            if (newQty > 0) {
                newTotal += newQty * newPrice
            }
        }

        // 加上未調整的項目
        for (const item of originalItems) {
            const wasAdjusted = items.some(adj => adj.sale_item_id === item.id)
            if (!wasAdjusted) {
                newTotal += item.subtotal
            }
        }

        const adjustmentAmount = originalTotal - newTotal // 正數 = 退款

        // 3. 獲取相關的出貨單（用於確認是否已出貨）
        const { data: deliveries } = await (supabaseServer
            .from('deliveries') as any)
            .select('id, status')
            .eq('sale_id', id)
            .eq('status', 'confirmed')

        const hasConfirmedDelivery = deliveries && deliveries.length > 0

        // 4. 回補庫存（只有已出貨的才需要回補，且只處理數量減少的情況）
        // 注意：數量增加時不扣庫存，因為新增的數量應該等到實際出貨時才扣
        console.log('[Sale Correction] hasConfirmedDelivery:', hasConfirmedDelivery)
        console.log('[Sale Correction] inventoryChanges:', inventoryChanges)

        if (hasConfirmedDelivery && inventoryChanges.length > 0) {
            for (const change of inventoryChanges) {
                console.log('[Sale Correction] Processing inventory change:', change)
                if (change.qty_change > 0) {
                    // 數量減少 → 回補庫存
                    const { error: logError } = await (supabaseServer
                        .from('inventory_logs') as any)
                        .insert({
                            product_id: change.product_id,
                            ref_type: 'adjustment',
                            ref_id: id,
                            qty_change: change.qty_change,
                            memo: `銷貨更正回補 - ${sale.sale_no}（${change.product_name} x${change.qty_change}）`,
                        })

                    if (logError) {
                        console.error('[Sale Correction] Failed to insert inventory_log:', logError)
                    } else {
                        console.log('[Sale Correction] Successfully inserted inventory_log for', change.product_name)
                    }
                }
                // 數量增加 (qty_change < 0) 時不做任何庫存操作
                // 新增的數量會顯示為「未出貨」，等實際出貨時才會扣庫存
            }
        } else {
            console.log('[Sale Correction] Skipping inventory restoration - hasConfirmedDelivery:', hasConfirmedDelivery, 'inventoryChanges.length:', inventoryChanges.length)
        }

        // 5. 更新銷售明細
        for (const adjustment of items) {
            if (adjustment.new_quantity === 0) {
                // 刪除該品項
                await (supabaseServer
                    .from('sale_items') as any)
                    .delete()
                    .eq('id', adjustment.sale_item_id)
            } else {
                // 更新數量和價格
                const newPrice = adjustment.new_price
                const updateData: any = {
                    quantity: adjustment.new_quantity,
                }
                if (newPrice !== undefined) {
                    updateData.price = newPrice
                }
                await (supabaseServer
                    .from('sale_items') as any)
                    .update(updateData)
                    .eq('id', adjustment.sale_item_id)
            }
        }

        // 5.5. 調整出貨記錄（當數量減少時）
        if (hasConfirmedDelivery) {
            for (const adjustment of items) {
                const originalItem = originalItems.find((item: any) => item.id === adjustment.sale_item_id)
                if (!originalItem) continue

                const qtyDiff = originalItem.quantity - adjustment.new_quantity
                if (qtyDiff > 0) {
                    // 數量減少，需要調整 delivery_items
                    // 獲取該 sale_item 的所有 delivery_items（已確認的出貨單）
                    const { data: deliveryItems } = await (supabaseServer
                        .from('delivery_items') as any)
                        .select(`
                            id,
                            quantity,
                            delivery_id,
                            deliveries!inner (status)
                        `)
                        .eq('sale_item_id', adjustment.sale_item_id)
                        .eq('deliveries.status', 'confirmed')
                        .order('created_at', { ascending: false })

                    if (deliveryItems && deliveryItems.length > 0) {
                        // 計算總已出貨數量
                        const totalDelivered = deliveryItems.reduce((sum: number, di: any) => sum + di.quantity, 0)
                        const newMaxDelivered = adjustment.new_quantity

                        if (totalDelivered > newMaxDelivered) {
                            // 需要減少出貨數量
                            let qtyToReduce = totalDelivered - newMaxDelivered

                            // 從最後一筆開始減少
                            for (const di of deliveryItems) {
                                if (qtyToReduce <= 0) break

                                if (di.quantity <= qtyToReduce) {
                                    // 整筆刪除
                                    await (supabaseServer
                                        .from('delivery_items') as any)
                                        .delete()
                                        .eq('id', di.id)
                                    qtyToReduce -= di.quantity
                                } else {
                                    // 部分減少
                                    await (supabaseServer
                                        .from('delivery_items') as any)
                                        .update({ quantity: di.quantity - qtyToReduce })
                                        .eq('id', di.id)
                                    qtyToReduce = 0
                                }
                            }
                        }
                    }
                }
            }
        }

        // 6. 更新銷售單總額
        await (supabaseServer
            .from('sales') as any)
            .update({
                total: newTotal,
                updated_at: getTaiwanTime(),
            })
            .eq('id', id)

        // 7. 調整應收帳款（如果未付款）
        if (!sale.is_paid && sale.customer_code && adjustmentAmount !== 0) {
            // 獲取相關 AR 記錄
            const { data: arRecords } = await (supabaseServer
                .from('partner_accounts') as any)
                .select('id, amount, received_paid, sale_item_id')
                .eq('ref_type', 'sale')
                .eq('ref_id', id)

            if (arRecords && arRecords.length > 0) {
                // 按比例調整每筆 AR
                const totalArAmount = arRecords.reduce((sum: number, ar: any) => sum + ar.amount, 0)

                for (const adjustment of items) {
                    const arRecord = arRecords.find((ar: any) => ar.sale_item_id === adjustment.sale_item_id)
                    if (arRecord) {
                        if (adjustment.new_quantity === 0) {
                            // 刪除該 AR 記錄
                            await (supabaseServer
                                .from('partner_accounts') as any)
                                .delete()
                                .eq('id', arRecord.id)
                        } else {
                            // 重新計算 AR 金額
                            const originalItem = originalItems.find((item: any) => item.id === adjustment.sale_item_id)
                            const newPrice = adjustment.new_price ?? originalItem.price
                            const newAmount = adjustment.new_quantity * newPrice

                            await (supabaseServer
                                .from('partner_accounts') as any)
                                .update({
                                    amount: newAmount,
                                    note: `銷貨更正調整 - 原 ${sale.sale_no}`,
                                })
                                .eq('id', arRecord.id)
                        }
                    }
                }
            }
        }

        // 8. 調整帳戶餘額（如果已付款且有退款）
        if (sale.is_paid && adjustmentAmount > 0 && sale.account_id) {
            // 獲取帳戶
            const { data: account } = await (supabaseServer
                .from('accounts') as any)
                .select('balance')
                .eq('id', sale.account_id)
                .single()

            if (account) {
                const newBalance = account.balance - adjustmentAmount

                // 更新帳戶餘額
                await (supabaseServer
                    .from('accounts') as any)
                    .update({
                        balance: newBalance,
                        updated_at: getTaiwanTime(),
                    })
                    .eq('id', sale.account_id)

                // 記錄帳戶交易
                await (supabaseServer
                    .from('account_transactions') as any)
                    .insert({
                        account_id: sale.account_id,
                        transaction_type: 'sale_correction',
                        amount: -adjustmentAmount,
                        balance_before: account.balance,
                        balance_after: newBalance,
                        ref_type: 'sale_correction',
                        ref_id: id,
                        note: `銷貨更正退款 - ${sale.sale_no}`,
                    })
            }
        }

        // 8.5. 如果已付款但金額增加，需要產生應收帳款
        if (sale.is_paid && adjustmentAmount < 0 && sale.customer_code) {
            const additionalAmount = -adjustmentAmount // 將負數轉為正數

            // 為增加的金額建立 AR 記錄
            await (supabaseServer
                .from('partner_accounts') as any)
                .insert({
                    partner_type: 'customer',
                    partner_code: sale.customer_code,
                    direction: 'AR',
                    amount: additionalAmount,
                    ref_type: 'sale_correction',
                    ref_id: id,
                    due_date: new Date(new Date().getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 天
                    status: 'pending',
                    note: `銷貨更正補收 - ${sale.sale_no}`,
                })

            console.log(`[Sale Correction] Created AR for additional amount: ${additionalAmount}`)
        }

        // 9. 建立更正記錄
        await (supabaseServer
            .from('sale_corrections') as any)
            .insert({
                sale_id: id,
                correction_type: items.some(i => i.new_quantity === 0) ? 'item_adjust' : 'item_adjust',
                original_total: originalTotal,
                corrected_total: newTotal,
                adjustment_amount: adjustmentAmount,
                items_adjusted: adjustedItems,
                note: note || `銷貨更正`,
                created_at: getTaiwanTime(),
            })

        return NextResponse.json({
            ok: true,
            data: {
                sale_id: id,
                sale_no: sale.sale_no,
                original_total: originalTotal,
                corrected_total: newTotal,
                adjustment_amount: adjustmentAmount,
                items_adjusted: adjustedItems.length,
                inventory_restored: inventoryChanges.filter(c => c.qty_change > 0).reduce((sum, c) => sum + c.qty_change, 0),
            }
        })
    } catch (error) {
        console.error('Sale correction error:', error)
        return NextResponse.json(
            { ok: false, error: '系統錯誤' },
            { status: 500 }
        )
    }
}
