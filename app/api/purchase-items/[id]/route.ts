import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { getTaiwanTime } from '@/lib/timezone'

type RouteContext = {
  params: Promise<{ id: string }>
}

// DELETE /api/purchase-items/:id - Delete single purchase item and restore inventory
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params

    // 1. Get purchase item details including received_quantity
    const { data: item, error: fetchError } = await (supabaseServer
      .from('purchase_items') as any)
      .select(`
        *,
        purchases!inner(status)
      `)
      .eq('id', id)
      .single()

    if (fetchError || !item) {
      return NextResponse.json(
        { ok: false, error: '找不到進貨明細' },
        { status: 404 }
      )
    }

    // 2. Restore inventory based on actual received quantity
    const receivedQty = item.received_quantity || 0

    if (receivedQty > 0) {
      console.log(`[Delete Purchase Item ${id}] Restoring ${receivedQty} units for product ${item.product_id}`)

      // 寫入負數的庫存日誌來回補庫存（trigger 會自動更新 products.stock）
      await (supabaseServer
        .from('inventory_logs') as any)
        .insert({
          product_id: item.product_id,
          ref_type: 'purchase_item_delete',
          ref_id: id,
          qty_change: -receivedQty,
          memo: `刪除進貨明細回補庫存 - 明細 ID: ${id}`,
        })

      // 更新平均成本
      const { data: product } = await (supabaseServer
        .from('products') as any)
        .select('stock, avg_cost')
        .eq('id', item.product_id)
        .single()

      if (product) {
        const currentStock = product.stock  // trigger 已經更新過的庫存
        const oldAvgCost = product.avg_cost

        // 計算新的平均成本（移除這次進貨的成本貢獻）
        let newAvgCost = oldAvgCost
        if (currentStock > 0) {
          const oldStock = currentStock + receivedQty
          const totalCostBefore = oldStock * oldAvgCost
          const itemCost = receivedQty * item.cost
          newAvgCost = (totalCostBefore - itemCost) / currentStock

          if (newAvgCost < 0) newAvgCost = 0
        } else {
          newAvgCost = 0
        }

        // 只更新平均成本
        await (supabaseServer
          .from('products') as any)
          .update({ avg_cost: newAvgCost })
          .eq('id', item.product_id)

        console.log(`[Delete Purchase Item ${id}] Restored inventory: stock reduced by ${receivedQty}, avg_cost: ${oldAvgCost.toFixed(2)} -> ${newAvgCost.toFixed(2)}`)
      }
    } else {
      console.log(`[Delete Purchase Item ${id}] Item has not been received, no inventory to restore`)
    }

    // 3. Update purchase total
    const { data: remainingItems } = await (supabaseServer
      .from('purchase_items') as any)
      .select('quantity, cost')
      .eq('purchase_id', item.purchase_id)
      .neq('id', id)

    const newTotal = (remainingItems || []).reduce(
      (sum: number, i: any) => sum + (i.quantity * i.cost),
      0
    )

    await (supabaseServer
      .from('purchases') as any)
      .update({ total: newTotal })
      .eq('id', item.purchase_id)

    // 4. 回補已付款的帳戶餘額並刪除 AP 記錄
    // 查詢 AP 記錄
    const { data: apRecords } = await (supabaseServer
      .from('partner_accounts') as any)
      .select('id')
      .eq('purchase_item_id', id)

    if (apRecords && apRecords.length > 0) {
      const apIds = apRecords.map((ap: any) => ap.id)

      // 查詢關聯的 settlement_allocations
      const { data: allocations } = await (supabaseServer
        .from('settlement_allocations') as any)
        .select('settlement_id, amount')
        .in('partner_account_id', apIds)

      if (allocations && allocations.length > 0) {
        // 按 settlement 分組計算退款金額
        const settlementAmounts = new Map<string, number>()
        allocations.forEach((a: any) => {
          const current = settlementAmounts.get(a.settlement_id) || 0
          settlementAmounts.set(a.settlement_id, current + a.amount)
        })

        // 處理每個 settlement
        for (const [settlementId, refundAmount] of settlementAmounts) {
          // 查詢 settlement 資訊
          const { data: settlement } = await (supabaseServer
            .from('settlements') as any)
            .select('amount, account_id')
            .eq('id', settlementId)
            .single()

          if (settlement && settlement.account_id) {
            // 回補帳戶餘額（部分退款）
            const { data: account } = await (supabaseServer
              .from('accounts') as any)
              .select('balance')
              .eq('id', settlement.account_id)
              .single()

            if (account) {
              // 直接更新餘額（因為是退款操作，不需要創建新交易記錄）
              const newBalance = Number(account.balance) + refundAmount
              await (supabaseServer
                .from('accounts') as any)
                .update({
                  balance: newBalance,
                  updated_at: getTaiwanTime()
                })
                .eq('id', settlement.account_id)

              console.log(`[Delete Purchase Item ${id}] Restored account ${settlement.account_id}: +${refundAmount}`)
            }

            // 刪除 account_transactions 中對應金額的記錄
            // 注意：如果整個 settlement 只有這一項，才完全刪除 account_transactions
            const { data: remainingAllocations } = await (supabaseServer
              .from('settlement_allocations') as any)
              .select('id')
              .eq('settlement_id', settlementId)
              .not('partner_account_id', 'in', `(${apIds.join(',')})`)

            if (!remainingAllocations || remainingAllocations.length === 0) {
              // 沒有其他細項，刪除整個 settlement 的交易記錄
              await (supabaseServer
                .from('account_transactions') as any)
                .delete()
                .eq('ref_type', 'settlement')
                .eq('ref_id', settlementId)

              // 刪除 settlement
              await (supabaseServer
                .from('settlements') as any)
                .delete()
                .eq('id', settlementId)
            } else {
              // 還有其他細項，更新 settlement 金額
              const newSettlementAmount = settlement.amount - refundAmount
              await (supabaseServer
                .from('settlements') as any)
                .update({ amount: newSettlementAmount })
                .eq('id', settlementId)

              // 更新 account_transactions 金額
              const { data: txn } = await (supabaseServer
                .from('account_transactions') as any)
                .select('amount, balance_before, balance_after')
                .eq('ref_type', 'settlement')
                .eq('ref_id', settlementId)
                .single()

              if (txn) {
                // 正確的 balance_after 應該基於當前帳戶餘額
                const { data: currentAccount } = await (supabaseServer
                  .from('accounts') as any)
                  .select('balance')
                  .eq('id', settlement.account_id)
                  .single()

                if (currentAccount) {
                  await (supabaseServer
                    .from('account_transactions') as any)
                    .update({
                      amount: newSettlementAmount,
                      balance_after: currentAccount.balance
                    })
                    .eq('ref_type', 'settlement')
                    .eq('ref_id', settlementId)
                }
              }
            }
          }

          // 刪除 settlement_allocations
          await (supabaseServer
            .from('settlement_allocations') as any)
            .delete()
            .in('partner_account_id', apIds)
        }
      }

      // 刪除 AP 記錄
      await (supabaseServer
        .from('partner_accounts') as any)
        .delete()
        .in('id', apIds)
    }

    // 5. Delete purchase item
    const { error: deleteError } = await (supabaseServer
      .from('purchase_items') as any)
      .delete()
      .eq('id', id)

    if (deleteError) {
      return NextResponse.json(
        { ok: false, error: deleteError.message },
        { status: 500 }
      )
    }

    console.log(`[Delete Purchase Item ${id}] Successfully deleted item and restored inventory`)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
