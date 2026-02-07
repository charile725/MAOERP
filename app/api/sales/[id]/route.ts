import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { saleUpdateSchema } from '@/lib/schemas'
import { fromZodError } from 'zod-validation-error'
import { getTaiwanTime } from '@/lib/timezone'

type RouteContext = {
  params: Promise<{ id: string }>
}

// GET /api/sales/:id - Get sale details with items
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params

    // Get sale
    const { data: sale, error: saleError } = await (supabaseServer
      .from('sales') as any)
      .select('*')
      .eq('id', id)
      .single()

    if (saleError) {
      return NextResponse.json(
        { ok: false, error: '找不到銷售單' },
        { status: 404 }
      )
    }

    // Get sale items with product details
    const { data: items, error: itemsError } = await (supabaseServer
      .from('sale_items') as any)
      .select(`
        *,
        products:product_id (
          id,
          item_code,
          name,
          unit
        )
      `)
      .eq('sale_id', id)

    if (itemsError) {
      return NextResponse.json(
        { ok: false, error: itemsError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      data: {
        ...sale,
        items,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}

// PATCH /api/sales/:id - Update sale payment method
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params
    const body = await request.json()

    // Validate input
    const validation = saleUpdateSchema.safeParse(body)
    if (!validation.success) {
      const error = fromZodError(validation.error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      )
    }

    const { payment_method } = validation.data

    // 1. 讀取舊的 sale 記錄
    const { data: oldSale, error: fetchError } = await (supabaseServer
      .from('sales') as any)
      .select('account_id, total, payment_method, is_paid')
      .eq('id', id)
      .single()

    if (fetchError) {
      return NextResponse.json(
        { ok: false, error: '找不到銷售單' },
        { status: 404 }
      )
    }

    const oldAccountId = oldSale.account_id
    const saleTotal = oldSale.total

    // 2. 取得新的 account_id
    const { data: account } = await (supabaseServer
      .from('accounts') as any)
      .select('id')
      .eq('payment_method_code', payment_method)
      .eq('is_active', true)
      .single()

    const newAccountId = account?.id || null

    // 3. 如果帳戶有變更，處理餘額轉移
    // 🔧 只有在「確實有 sale 類型帳戶交易」時才做餘額轉移
    // - 未付款的銷售單不會有帳戶交易，不需要轉移
    // - 付款方式為 pending 的銷售單不會有帳戶交易（account-service 會跳過）
    // - 透過 AR 收款的銷售單，帳戶交易 ref_type='settlement'，不屬於 sale 類型
    if (oldAccountId && oldAccountId !== newAccountId) {
      // 先檢查是否有實際的 sale 類型帳戶交易存在
      const { data: existingSaleTransactions } = await (supabaseServer
        .from('account_transactions') as any)
        .select('id, account_id, amount')
        .eq('ref_type', 'sale')
        .eq('ref_id', id.toString())

      const hasSaleTransactions = existingSaleTransactions && existingSaleTransactions.length > 0

      if (hasSaleTransactions) {
        // 3.1 還原舊帳戶餘額（只在確實有 sale 交易記錄時）
        // 計算實際需要還原的金額（從交易記錄中取得，而非用 saleTotal）
        const totalToRestore = existingSaleTransactions.reduce((sum: number, tx: any) => sum + tx.amount, 0)

        for (const tx of existingSaleTransactions) {
          const { data: txAccount } = await (supabaseServer
            .from('accounts') as any)
            .select('balance')
            .eq('id', tx.account_id)
            .single()

          if (txAccount) {
            const restoredBalance = txAccount.balance - tx.amount
            await (supabaseServer
              .from('accounts') as any)
              .update({
                balance: restoredBalance,
                updated_at: getTaiwanTime()
              })
              .eq('id', tx.account_id)

            console.log(`[Sale PATCH ${id}] Restored account ${tx.account_id}: -${tx.amount}`)
          }
        }

        // 刪除舊的 account_transactions
        await (supabaseServer
          .from('account_transactions') as any)
          .delete()
          .eq('ref_type', 'sale')
          .eq('ref_id', id.toString())

        // 3.2 記錄新帳戶交易（不轉入 pending 帳戶）
        if (newAccountId && payment_method !== 'pending') {
          const { data: newAccount } = await (supabaseServer
            .from('accounts') as any)
            .select('balance')
            .eq('id', newAccountId)
            .single()

          if (newAccount) {
            const newBalance = newAccount.balance + totalToRestore

            // 更新新帳戶餘額
            await (supabaseServer
              .from('accounts') as any)
              .update({
                balance: newBalance,
                updated_at: getTaiwanTime()
              })
              .eq('id', newAccountId)

            // 建立新的 account_transactions
            await (supabaseServer
              .from('account_transactions') as any)
              .insert({
                account_id: newAccountId,
                transaction_type: 'sale',
                amount: totalToRestore,
                balance_before: newAccount.balance,
                balance_after: newBalance,
                ref_type: 'sale',
                ref_id: id.toString(),
                note: `銷售單 ${id} - 變更支付方式為 ${payment_method}`
              })

            console.log(`[Sale PATCH ${id}] Recorded new account ${newAccountId}: +${totalToRestore}`)
          }
        } else if (payment_method === 'pending') {
          console.log(`[Sale PATCH ${id}] 新付款方式為 pending，跳過帳戶入帳`)
        }
      } else {
        console.log(`[Sale PATCH ${id}] 無 sale 類型帳戶交易，跳過餘額轉移（可能是未付款或 AR 收款的銷售單）`)
      }
    }

    // 4. 取得台灣時間 (UTC+8)
    const now = new Date()
    const taiwanTime = new Date(now.getTime() + 8 * 60 * 60 * 1000)

    // 5. Update sale payment method and account_id
    const { data: sale, error } = await (supabaseServer
      .from('sales') as any)
      .update({
        payment_method,
        account_id: newAccountId,
        updated_at: taiwanTime.toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, data: sale })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}

// DELETE /api/sales/:id - Delete sale and restore inventory
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params

    // 1. Check if sale exists and get its info
    const { data: sale, error: fetchError } = await (supabaseServer
      .from('sales') as any)
      .select('status, customer_code, sale_no, is_paid, account_id, total')
      .eq('id', id)
      .single()

    if (fetchError || !sale) {
      return NextResponse.json(
        { ok: false, error: '找不到銷售單' },
        { status: 404 }
      )
    }

    // 1.5. Restore customer store_credit if used (check balance logs)
    if (sale.customer_code) {
      // 查找该销售单使用的购物金记录
      const { data: balanceLogs } = await (supabaseServer
        .from('customer_balance_logs') as any)
        .select('amount, balance_before, balance_after')
        .eq('ref_type', 'sale')
        .eq('ref_id', id.toString())
        .eq('customer_code', sale.customer_code)

      // 如果有使用购物金（amount 为负数），需要退回
      if (balanceLogs && balanceLogs.length > 0) {
        const balanceLog = balanceLogs[0]
        if (balanceLog.amount < 0) {
          const refundAmount = Math.abs(balanceLog.amount)

          // 获取客户当前购物金余额
          const { data: customer } = await (supabaseServer
            .from('customers') as any)
            .select('store_credit')
            .eq('customer_code', sale.customer_code)
            .single()

          if (customer) {
            const newBalance = customer.store_credit + refundAmount

            // 更新客户购物金余额
            await (supabaseServer
              .from('customers') as any)
              .update({ store_credit: newBalance })
              .eq('customer_code', sale.customer_code)

            // 刪除原使用日誌（避免孤兒記錄）
            await (supabaseServer
              .from('customer_balance_logs') as any)
              .delete()
              .eq('ref_type', 'sale')
              .eq('ref_id', id.toString())
              .eq('customer_code', sale.customer_code)

            console.log(`[Delete Sale ${id}] Restored customer ${sale.customer_code} store_credit: +${refundAmount}, deleted balance log`)
          }
        }
      }
    }

    // 1.6. 帳戶餘額還原已移至第 3 節統一處理（根據 account_transactions 記錄）
    // 避免重複扣減

    // 1.7. 如果是轉購物金的銷售，需要扣回購物金
    if (sale.status === 'store_credit' && sale.customer_code) {
      // 查找轉購物金的記錄
      const { data: storeCreditLogs } = await (supabaseServer
        .from('customer_balance_logs') as any)
        .select('id, amount')
        .eq('ref_type', 'sale_to_store_credit')
        .eq('ref_id', id.toString())
        .eq('customer_code', sale.customer_code)

      if (storeCreditLogs && storeCreditLogs.length > 0) {
        // 計算總共轉換的購物金
        const totalStoreCredit = storeCreditLogs.reduce((sum: number, log: any) => sum + log.amount, 0)

        // 獲取客戶當前購物金餘額
        const { data: customer } = await (supabaseServer
          .from('customers') as any)
          .select('store_credit')
          .eq('customer_code', sale.customer_code)
          .single()

        if (customer && totalStoreCredit > 0) {
          const newBalance = customer.store_credit - totalStoreCredit

          // 更新客戶購物金餘額（扣回）
          await (supabaseServer
            .from('customers') as any)
            .update({ store_credit: newBalance })
            .eq('customer_code', sale.customer_code)

          // 建立扣回記錄
          await (supabaseServer
            .from('customer_balance_logs') as any)
            .insert({
              customer_code: sale.customer_code,
              amount: -totalStoreCredit,
              balance_before: customer.store_credit,
              balance_after: newBalance,
              type: 'deduct',
              ref_type: 'sale_delete',
              ref_id: id.toString(),
              note: `刪除銷售單 ${sale.sale_no}，扣回轉換的購物金`,
            })

          // 刪除原轉換記錄
          await (supabaseServer
            .from('customer_balance_logs') as any)
            .delete()
            .eq('ref_type', 'sale_to_store_credit')
            .eq('ref_id', id.toString())
            .eq('customer_code', sale.customer_code)

          console.log(`[Delete Sale ${id}] Deducted store_credit ${totalStoreCredit} from customer ${sale.customer_code}`)
        }
      }
    }

    // 1.8. 扣回單品項轉購物金（ref_type='sale_item'）
    if (sale.customer_code) {
      // 取得此銷售單的所有品項 ID
      const { data: saleItemsForSC } = await (supabaseServer
        .from('sale_items') as any)
        .select('id')
        .eq('sale_id', id)

      if (saleItemsForSC && saleItemsForSC.length > 0) {
        const saleItemIds = saleItemsForSC.map((si: any) => si.id.toString())

        const { data: itemStoreCreditLogs } = await (supabaseServer
          .from('customer_balance_logs') as any)
          .select('id, amount, ref_id')
          .eq('ref_type', 'sale_item')
          .in('ref_id', saleItemIds)
          .eq('customer_code', sale.customer_code)

        if (itemStoreCreditLogs && itemStoreCreditLogs.length > 0) {
          const totalItemStoreCredit = itemStoreCreditLogs.reduce(
            (sum: number, log: any) => sum + (log.amount || 0), 0
          )

          if (totalItemStoreCredit > 0) {
            const { data: customer } = await (supabaseServer
              .from('customers') as any)
              .select('store_credit')
              .eq('customer_code', sale.customer_code)
              .single()

            if (customer) {
              const newBalance = customer.store_credit - totalItemStoreCredit

              await (supabaseServer
                .from('customers') as any)
                .update({ store_credit: newBalance })
                .eq('customer_code', sale.customer_code)

              await (supabaseServer
                .from('customer_balance_logs') as any)
                .insert({
                  customer_code: sale.customer_code,
                  amount: -totalItemStoreCredit,
                  balance_before: customer.store_credit,
                  balance_after: newBalance,
                  type: 'deduct',
                  ref_type: 'sale_delete',
                  ref_id: id.toString(),
                  note: `刪除銷售單 ${sale.sale_no}，扣回單品項轉換的購物金`,
                })

              // 刪除原單品項轉換記錄
              const logIds = itemStoreCreditLogs.map((l: any) => l.id)
              await (supabaseServer
                .from('customer_balance_logs') as any)
                .delete()
                .in('id', logIds)

              console.log(`[Delete Sale ${id}] Deducted item-level store_credit ${totalItemStoreCredit} from customer ${sale.customer_code}`)
            }
          }
        }
      }
    }

    // 2. 刪除銷貨更正產生的庫存日誌（避免重複回補）
    // 更正時已經回補過的庫存不應該再回補
    const { data: correctionLogs } = await (supabaseServer
      .from('inventory_logs') as any)
      .select('id, product_id, qty_change')
      .eq('ref_type', 'adjustment')
      .eq('ref_id', id.toString())

    if (correctionLogs && correctionLogs.length > 0) {
      console.log(`[Delete Sale ${id}] Found ${correctionLogs.length} correction inventory logs, deleting...`)
      // 刪除這些更正產生的庫存日誌
      // 注意：這些日誌的 qty_change 已經正向回補過，
      // 所以我們需要插入反向日誌來抵消，然後刪除原始日誌
      for (const log of correctionLogs) {
        // 插入反向日誌抵消之前的回補
        await (supabaseServer
          .from('inventory_logs') as any)
          .insert({
            product_id: log.product_id,
            ref_type: 'sale_delete',
            ref_id: id.toString(),
            qty_change: -log.qty_change, // 如果更正回補了 +5，這裡就 -5
            memo: `刪除銷售單 ${sale.sale_no}，抵消更正回補`,
          })
      }

      // 刪除更正產生的庫存日誌
      await (supabaseServer
        .from('inventory_logs') as any)
        .delete()
        .eq('ref_type', 'adjustment')
        .eq('ref_id', id.toString())
    }

    // 3. Get all deliveries for this sale
    const { data: deliveries } = await (supabaseServer
      .from('deliveries') as any)
      .select('id, status, delivery_no')
      .eq('sale_id', id)

    // 4. For each delivery, restore inventory by inserting reverse logs
    // 注意：如果銷售單是轉購物金狀態，庫存已在轉換時回補過，不需要再次回補
    const skipInventoryRestore = sale.status === 'store_credit'

    for (const delivery of deliveries || []) {
      // 只有 confirmed 的 delivery 才有扣庫存，才需要回補
      if (delivery.status === 'confirmed' && !skipInventoryRestore) {
        // 獲取該出貨單的所有庫存扣除記錄
        const { data: inventoryLogs } = await (supabaseServer
          .from('inventory_logs') as any)
          .select('product_id, qty_change')
          .eq('ref_type', 'delivery')
          .eq('ref_id', delivery.id.toString())

        // 反向插入庫存日誌來回補庫存（trigger 會自動處理）
        for (const log of inventoryLogs || []) {
          await (supabaseServer
            .from('inventory_logs') as any)
            .insert({
              product_id: log.product_id,
              ref_type: 'sale_delete',
              ref_id: id.toString(),
              qty_change: -log.qty_change, // 反向數量（原本是負數，現在變正數）
              memo: `刪除銷售單 ${sale.sale_no}，回補庫存（原出貨單：${delivery.delivery_no}）`,
            })
        }

        // 刪除原有的庫存日誌
        await (supabaseServer
          .from('inventory_logs') as any)
          .delete()
          .eq('ref_type', 'delivery')
          .eq('ref_id', delivery.id.toString())
      }

      // 刪除出貨明細
      await (supabaseServer
        .from('delivery_items') as any)
        .delete()
        .eq('delivery_id', delivery.id)

      // 刪除出貨單
      await (supabaseServer
        .from('deliveries') as any)
        .delete()
        .eq('id', delivery.id)
    }

    // 4. If confirmed, need to restore ONLY ichiban kuji remaining
    if (sale.status === 'confirmed') {
      // Get all sale items (including ichiban kuji info)
      const { data: items, error: itemsError } = await (supabaseServer
        .from('sale_items') as any)
        .select('product_id, quantity, ichiban_kuji_prize_id, ichiban_kuji_id')
        .eq('sale_id', id)

      if (itemsError) {
        return NextResponse.json(
          { ok: false, error: itemsError.message },
          { status: 500 }
        )
      }

      // Restore ONLY ichiban kuji remaining
      for (const item of items || []) {
        // 如果是從一番賞售出的，恢復一番賞庫存
        if (item.ichiban_kuji_prize_id) {
          const { data: prize, error: fetchPrizeError } = await (supabaseServer
            .from('ichiban_kuji_prizes') as any)
            .select('remaining')
            .eq('id', item.ichiban_kuji_prize_id)
            .single()

          if (fetchPrizeError) {
            return NextResponse.json(
              { ok: false, error: `Failed to fetch prize: ${fetchPrizeError.message}` },
              { status: 500 }
            )
          }

          // 恢復一番賞庫的 remaining
          const { error: updatePrizeError } = await (supabaseServer
            .from('ichiban_kuji_prizes') as any)
            .update({ remaining: prize.remaining + item.quantity })
            .eq('id', item.ichiban_kuji_prize_id)

          if (updatePrizeError) {
            return NextResponse.json(
              { ok: false, error: `Failed to restore prize inventory: ${updatePrizeError.message}` },
              { status: 500 }
            )
          }
        }
      }
    }

    // 3. 處理帳戶餘額還原
    // 3.1 還原銷售時的收入（如果當時已付款）
    const { data: accountTransactions } = await (supabaseServer
      .from('account_transactions') as any)
      .select('account_id, amount')
      .eq('ref_type', 'sale')
      .eq('ref_id', id.toString())

    console.log(`[Delete Sale ${id}] 3.1 找到 ref_type=sale 的交易記錄:`, accountTransactions?.length || 0)

    if (accountTransactions && accountTransactions.length > 0) {
      for (const accountTransaction of accountTransactions) {
        const { data: account } = await (supabaseServer
          .from('accounts') as any)
          .select('balance')
          .eq('id', accountTransaction.account_id)
          .single()

        if (account) {
          // 減去這筆銷售的金額（刪除場景：直接還原，因為是收入所以要減去）
          const newBalance = account.balance - accountTransaction.amount

          await (supabaseServer
            .from('accounts') as any)
            .update({
              balance: newBalance,
              updated_at: getTaiwanTime()
            })
            .eq('id', accountTransaction.account_id)

          console.log(`[Delete Sale ${id}] Restored sale account ${accountTransaction.account_id}: -${accountTransaction.amount}`)
        }
      }

      // 刪除銷售的交易記錄
      await (supabaseServer
        .from('account_transactions') as any)
        .delete()
        .eq('ref_type', 'sale')
        .eq('ref_id', id.toString())
    }

    // 3.2 處理後續收款（receipts）的還原
    // 查詢與此銷售單相關的 AR 記錄
    const { data: arRecords } = await (supabaseServer
      .from('partner_accounts') as any)
      .select('id')
      .eq('ref_type', 'sale')
      .eq('ref_id', id.toString())

    console.log(`[Delete Sale ${id}] 3.2 找到 AR 記錄:`, arRecords?.length || 0)

    if (arRecords && arRecords.length > 0) {
      const arIds = arRecords.map((ar: any) => ar.id)

      // 查詢「僅屬於本銷貨單 AR」的 settlement_allocations
      const { data: allocations } = await (supabaseServer
        .from('settlement_allocations') as any)
        .select('id, settlement_id, amount')
        .in('partner_account_id', arIds)

      if (allocations && allocations.length > 0) {
        // 按 settlement_id 分組，計算本單的分配金額
        const refundBySettlement = new Map<string, number>()
        const allocationIdsBySettlement = new Map<string, string[]>()
        for (const alloc of allocations) {
          refundBySettlement.set(alloc.settlement_id, (refundBySettlement.get(alloc.settlement_id) || 0) + alloc.amount)
          const ids = allocationIdsBySettlement.get(alloc.settlement_id) || []
          ids.push(alloc.id)
          allocationIdsBySettlement.set(alloc.settlement_id, ids)
        }

        for (const [settlementId, refundAmount] of refundBySettlement.entries()) {
          const { data: settlement } = await (supabaseServer
            .from('settlements') as any)
            .select('amount, account_id, method, partner_code')
            .eq('id', settlementId)
            .single()

          if (settlement) {
            // 退款金額 = 本單分配金額（非整筆 settlement.amount）
            if (settlement.method === 'store_credit' && settlement.partner_code) {
              const { data: customer } = await (supabaseServer
                .from('customers') as any)
                .select('store_credit')
                .eq('customer_code', settlement.partner_code)
                .single()

              if (customer) {
                const newBalance = customer.store_credit + refundAmount

                await (supabaseServer
                  .from('customers') as any)
                  .update({ store_credit: newBalance })
                  .eq('customer_code', settlement.partner_code)

                // 刪除購物金扣除日誌
                await (supabaseServer
                  .from('customer_balance_logs') as any)
                  .delete()
                  .eq('ref_type', 'ar_receipt')
                  .eq('ref_id', settlementId)

                console.log(`[Delete Sale ${id}] Restored store_credit ${refundAmount} to customer ${settlement.partner_code}`)
              }
            } else if (settlement.account_id) {
              console.log(`[Delete Sale ${id}] 3.2 處理 settlement ${settlementId}，本單退款: ${refundAmount}，帳戶: ${settlement.account_id}`)

              const { data: account } = await (supabaseServer
                .from('accounts') as any)
                .select('balance')
                .eq('id', settlement.account_id)
                .single()

              if (account) {
                const newBalance = Number(account.balance) - refundAmount

                await (supabaseServer
                  .from('accounts') as any)
                  .update({
                    balance: newBalance,
                    updated_at: getTaiwanTime()
                  })
                  .eq('id', settlement.account_id)

                console.log(`[Delete Sale ${id}] Restored receipt account ${settlement.account_id}: -${refundAmount}`)
              }
            }
          }

          // 只刪除屬於本單 AR 的 allocations
          const allocIdsToDelete = allocationIdsBySettlement.get(settlementId) || []
          for (const allocId of allocIdsToDelete) {
            await (supabaseServer
              .from('settlement_allocations') as any)
              .delete()
              .eq('id', allocId)
          }

          // 檢查該 settlement 是否還有其他 allocations
          const { data: remainingAllocs } = await (supabaseServer
            .from('settlement_allocations') as any)
            .select('id, amount')
            .eq('settlement_id', settlementId)

          if (!remainingAllocs || remainingAllocs.length === 0) {
            // 沒有剩餘 allocations → 刪除整筆 settlement 及其帳戶交易
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
            // 有剩餘 allocations → 更新 settlement 金額
            const newSettlementAmount = remainingAllocs.reduce((sum: number, a: any) => sum + a.amount, 0)
            await (supabaseServer
              .from('settlements') as any)
              .update({ amount: newSettlementAmount })
              .eq('id', settlementId)
          }
        }
      }
    }

    // 4. Delete related partner accounts (AR)
    await (supabaseServer
      .from('partner_accounts') as any)
      .delete()
      .eq('ref_type', 'sale')
      .eq('ref_id', id.toString())

    // 5. Delete sale items
    await (supabaseServer.from('sale_items') as any).delete().eq('sale_id', id)

    // 6. Delete sale
    const { error: deleteError } = await (supabaseServer
      .from('sales') as any)
      .delete()
      .eq('id', id)

    if (deleteError) {
      return NextResponse.json(
        { ok: false, error: deleteError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
