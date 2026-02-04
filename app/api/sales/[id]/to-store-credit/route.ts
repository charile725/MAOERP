import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { saleToStoreCreditSchema } from '@/lib/schemas'
import { fromZodError } from 'zod-validation-error'
import { getTaiwanTime } from '@/lib/timezone'

type RouteContext = {
    params: Promise<{ id: string }>
}

// POST /api/sales/:id/to-store-credit - 將銷售轉為購物金
export async function POST(
    request: NextRequest,
    context: RouteContext
) {
    try {
        const { id } = await context.params
        const body = await request.json()

        // 驗證輸入
        const validation = saleToStoreCreditSchema.safeParse(body)
        if (!validation.success) {
            const error = fromZodError(validation.error)
            return NextResponse.json(
                { ok: false, error: error.message },
                { status: 400 }
            )
        }

        const { amount: requestedAmount, refund_inventory, note } = validation.data

        // 1. 獲取銷售單資訊
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
            return NextResponse.json(
                { ok: false, error: '找不到該銷售單' },
                { status: 404 }
            )
        }

        if (sale.status !== 'confirmed') {
            return NextResponse.json(
                { ok: false, error: '只能轉換已確認的銷售單' },
                { status: 400 }
            )
        }

        if (!sale.customer_code) {
            return NextResponse.json(
                { ok: false, error: '該銷售單沒有關聯客戶，無法轉為購物金' },
                { status: 400 }
            )
        }

        // 檢查所有品項售價是否為 0 → 只有售價=0的品項才能轉購物金
        const hasNonZeroPriceItems = sale.sale_items?.some((item: any) => item.price !== 0)
        if (hasNonZeroPriceItems) {
            return NextResponse.json(
                { ok: false, error: '只有所有品項售價皆為 $0 的銷售單才能轉購物金' },
                { status: 400 }
            )
        }

        // 檢查是否有已出貨的品項 → 已出貨不能轉購物金
        const { data: confirmedDeliveries } = await (supabaseServer
            .from('deliveries') as any)
            .select('id')
            .eq('sale_id', id)
            .eq('status', 'confirmed')
            .limit(1)

        if (confirmedDeliveries && confirmedDeliveries.length > 0) {
            return NextResponse.json(
                { ok: false, error: '此銷售單已有出貨記錄，已出貨商品不能轉購物金' },
                { status: 400 }
            )
        }

        // 計算轉換金額
        const conversionAmount = requestedAmount ?? sale.total
        if (conversionAmount > sale.total) {
            return NextResponse.json(
                { ok: false, error: `轉換金額不能超過銷售總額 ${sale.total}` },
                { status: 400 }
            )
        }

        const isFullConversion = conversionAmount >= sale.total

        // 2. 獲取客戶資訊
        const { data: customer, error: customerError } = await (supabaseServer
            .from('customers') as any)
            .select('store_credit, customer_name')
            .eq('customer_code', sale.customer_code)
            .single()

        if (customerError || !customer) {
            return NextResponse.json(
                { ok: false, error: '找不到該客戶' },
                { status: 404 }
            )
        }

        const originalStoreCredit = customer.store_credit
        const newStoreCredit = originalStoreCredit + conversionAmount

        // 3. 回補庫存（如果需要且已出貨）
        let inventoryRestored = 0
        if (refund_inventory && isFullConversion) {
            // 獲取相關的已確認出貨單
            const { data: deliveries } = await (supabaseServer
                .from('deliveries') as any)
                .select('id, status')
                .eq('sale_id', id)
                .eq('status', 'confirmed')

            if (deliveries && deliveries.length > 0) {
                for (const item of sale.sale_items) {
                    // 回補庫存
                    const { error: logError } = await (supabaseServer
                        .from('inventory_logs') as any)
                        .insert({
                            product_id: item.product_id,
                            ref_type: 'adjustment',
                            ref_id: id,
                            qty_change: item.quantity,
                            memo: `銷貨轉購物金回補 - ${sale.sale_no}（${item.snapshot_name} x${item.quantity}）`,
                        })

                    if (logError) {
                        console.error('[To Store Credit] Failed to insert inventory_log:', logError)
                    }
                    inventoryRestored += item.quantity
                }
            }
        }

        // 4. 更新客戶購物金餘額
        const { error: updateCustomerError } = await (supabaseServer
            .from('customers') as any)
            .update({ store_credit: newStoreCredit })
            .eq('customer_code', sale.customer_code)

        if (updateCustomerError) {
            return NextResponse.json(
                { ok: false, error: '更新客戶購物金失敗' },
                { status: 500 }
            )
        }

        // 5. 記錄購物金變動
        await (supabaseServer
            .from('customer_balance_logs') as any)
            .insert({
                customer_code: sale.customer_code,
                amount: conversionAmount,
                balance_before: originalStoreCredit,
                balance_after: newStoreCredit,
                type: 'refund',
                ref_type: 'sale_to_store_credit',
                ref_id: id,
                ref_no: sale.sale_no,
                note: note || `銷售單 ${sale.sale_no} 轉為購物金`,
                created_at: getTaiwanTime(),
            })

        // 6. 清除或調整應收帳款，並處理已收款部分的帳戶退款
        // 取得 AR 記錄及其已收款金額
        const { data: arRecords } = await (supabaseServer
            .from('partner_accounts') as any)
            .select('id, amount, received_paid')
            .eq('ref_type', 'sale')
            .eq('ref_id', id)

        // 計算已收款的總金額（透過收款單收取的部分）
        const totalReceivedFromAr = arRecords?.reduce((sum: number, ar: any) => sum + (ar.received_paid || 0), 0) || 0

        // 如果有已收款金額，需要退款到帳戶
        if (totalReceivedFromAr > 0) {
            // 查詢與此銷售單相關的收款記錄，退還已收金額
            const arIds = arRecords?.map((ar: any) => ar.id) || []

            if (arIds.length > 0) {
                const { data: allocations } = await (supabaseServer
                    .from('settlement_allocations') as any)
                    .select('settlement_id, amount')
                    .in('partner_account_id', arIds)

                if (allocations && allocations.length > 0) {
                    const settlementIds = [...new Set(allocations.map((a: any) => a.settlement_id))]

                    for (const settlementId of settlementIds) {
                        const { data: settlement } = await (supabaseServer
                            .from('settlements') as any)
                            .select('amount, account_id, method, partner_code')
                            .eq('id', settlementId)
                            .single()

                        if (settlement) {
                            if (settlement.method === 'store_credit' && settlement.partner_code) {
                                // 購物金收款：回補購物金（這筆錢本來就是購物金，現在又轉購物金，需要加回來）
                                const { data: cust } = await (supabaseServer
                                    .from('customers') as any)
                                    .select('store_credit')
                                    .eq('customer_code', settlement.partner_code)
                                    .single()

                                if (cust) {
                                    await (supabaseServer
                                        .from('customers') as any)
                                        .update({ store_credit: cust.store_credit + settlement.amount })
                                        .eq('customer_code', settlement.partner_code)

                                    // 記錄購物金回補日誌
                                    await (supabaseServer
                                        .from('customer_balance_logs') as any)
                                        .insert({
                                            customer_code: settlement.partner_code,
                                            amount: settlement.amount,
                                            balance_before: cust.store_credit,
                                            balance_after: cust.store_credit + settlement.amount,
                                            type: 'refund',
                                            ref_type: 'sale_to_store_credit_refund',
                                            ref_id: id,
                                            ref_no: sale.sale_no,
                                            note: `轉購物金時退還先前購物金收款`,
                                            created_at: getTaiwanTime(),
                                        })
                                }

                                // 刪除原扣除記錄
                                await (supabaseServer
                                    .from('customer_balance_logs') as any)
                                    .delete()
                                    .eq('ref_type', 'ar_receipt')
                                    .eq('ref_id', settlementId)
                            } else if (settlement.account_id) {
                                // 現金/銀行收款：退款到帳戶
                                const { data: account } = await (supabaseServer
                                    .from('accounts') as any)
                                    .select('balance')
                                    .eq('id', settlement.account_id)
                                    .single()

                                if (account) {
                                    const newBalance = account.balance - settlement.amount

                                    await (supabaseServer
                                        .from('accounts') as any)
                                        .update({
                                            balance: newBalance,
                                            updated_at: getTaiwanTime(),
                                        })
                                        .eq('id', settlement.account_id)

                                    // 記錄帳戶交易
                                    await (supabaseServer
                                        .from('account_transactions') as any)
                                        .insert({
                                            account_id: settlement.account_id,
                                            transaction_type: 'sale_to_store_credit',
                                            amount: -settlement.amount,
                                            balance_before: account.balance,
                                            balance_after: newBalance,
                                            ref_type: 'sale_to_store_credit',
                                            ref_id: id,
                                            note: `轉購物金退還先前收款 - ${sale.sale_no}`,
                                            created_at: getTaiwanTime(),
                                        })
                                }

                                // 刪除原收款交易記錄
                                await (supabaseServer
                                    .from('account_transactions') as any)
                                    .delete()
                                    .eq('ref_type', 'settlement')
                                    .eq('ref_id', settlementId)
                            }
                        }

                        // 刪除 settlement_allocations 和 settlement
                        await (supabaseServer
                            .from('settlement_allocations') as any)
                            .delete()
                            .eq('settlement_id', settlementId)

                        await (supabaseServer
                            .from('settlements') as any)
                            .delete()
                            .eq('id', settlementId)
                    }
                }
            }
        }

        // 刪除或調整 AR 記錄
        if (isFullConversion) {
            // 全額轉換：刪除所有 AR 記錄
            await (supabaseServer
                .from('partner_accounts') as any)
                .delete()
                .eq('ref_type', 'sale')
                .eq('ref_id', id)
        } else if (arRecords && arRecords.length > 0) {
            // 部分轉換：按比例減少 AR（只處理未收款部分）
            const totalArAmount = arRecords.reduce((sum: number, ar: any) => sum + ar.amount, 0)
            const reductionRatio = conversionAmount / sale.total

            for (const ar of arRecords) {
                const reduction = ar.amount * reductionRatio
                const newAmount = ar.amount - reduction

                if (newAmount <= 0) {
                    await (supabaseServer
                        .from('partner_accounts') as any)
                        .delete()
                        .eq('id', ar.id)
                } else {
                    await (supabaseServer
                        .from('partner_accounts') as any)
                        .update({
                            amount: newAmount,
                            note: `銷貨轉購物金調整 - 減少 ${reduction}`,
                        })
                        .eq('id', ar.id)
                }
            }
        }

        // 7. 處理已付款的情況（需要退款）
        if (sale.is_paid && sale.account_id) {
            const { data: account } = await (supabaseServer
                .from('accounts') as any)
                .select('balance')
                .eq('id', sale.account_id)
                .single()

            if (account) {
                const newBalance = account.balance - conversionAmount

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
                        transaction_type: 'sale_to_store_credit',
                        amount: -conversionAmount,
                        balance_before: account.balance,
                        balance_after: newBalance,
                        ref_type: 'sale_to_store_credit',
                        ref_id: id,
                        note: `銷貨轉購物金 - ${sale.sale_no}`,
                    })
            }
        }

        // 8. 更新銷售單狀態
        if (isFullConversion) {
            const { error: updateError } = await (supabaseServer
                .from('sales') as any)
                .update({
                    status: 'store_credit', // 標記為已轉購物金
                    is_paid: true, // 視為已收款（以購物金方式結清）
                    total: 0,
                    updated_at: getTaiwanTime(),
                })
                .eq('id', id)

            if (updateError) {
                console.error('[To Store Credit] Failed to update sale status:', updateError)
            } else {
                console.log('[To Store Credit] Sale status updated to store_credit')
            }
        } else {
            // 部分轉換：更新銷售總額，保持部分未收款狀態
            await (supabaseServer
                .from('sales') as any)
                .update({
                    total: sale.total - conversionAmount,
                    updated_at: getTaiwanTime(),
                })
                .eq('id', id)
        }

        // 9. 建立更正記錄
        await (supabaseServer
            .from('sale_corrections') as any)
            .insert({
                sale_id: id,
                correction_type: 'to_store_credit',
                original_total: sale.total,
                corrected_total: isFullConversion ? 0 : sale.total - conversionAmount,
                adjustment_amount: conversionAmount,
                store_credit_granted: conversionAmount,
                note: note || `銷貨轉購物金 - ${sale.sale_no}`,
                created_at: getTaiwanTime(),
            })

        return NextResponse.json({
            ok: true,
            data: {
                sale_id: id,
                sale_no: sale.sale_no,
                customer_code: sale.customer_code,
                customer_name: customer.customer_name,
                conversion_amount: conversionAmount,
                is_full_conversion: isFullConversion,
                store_credit_before: originalStoreCredit,
                store_credit_after: newStoreCredit,
                inventory_restored: inventoryRestored,
                new_sale_total: isFullConversion ? 0 : sale.total - conversionAmount,
            }
        })
    } catch (error) {
        console.error('Sale to store credit error:', error)
        return NextResponse.json(
            { ok: false, error: 'Internal server error' },
            { status: 500 }
        )
    }
}
