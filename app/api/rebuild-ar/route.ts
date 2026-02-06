import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// POST /api/rebuild-ar - Rebuild AR records for all unpaid sales
export async function POST(request: NextRequest) {
  try {
    // Get all unpaid sales with customers (skip cash/paid sales without AR needs)
    const { data: sales, error: salesError } = await supabaseServer
      .from('sales')
      .select('*, sale_items(*)')
      .not('customer_code', 'is', null)
      .eq('status', 'confirmed') as any

    if (salesError) {
      return NextResponse.json(
        { ok: false, error: salesError.message },
        { status: 500 }
      )
    }

    if (!sales || sales.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No sales found',
        created: 0
      })
    }

    let totalCreated = 0
    const results = []

    for (const sale of sales) {
      // Check if AR records already exist for this sale
      const { data: existingAR } = await supabaseServer
        .from('partner_accounts')
        .select('id, sale_item_id')
        .eq('ref_type', 'sale')
        .eq('ref_id', sale.id) as any

      // If all items already have AR records, skip
      const items = sale.sale_items || []
      if (items.length === 0) {
        results.push({
          sale_no: sale.sale_no,
          status: 'error',
          message: 'No items found'
        })
        continue
      }

      const existingItemIds = new Set(existingAR?.map((ar: any) => ar.sale_item_id).filter(Boolean))
      const itemsToCreate = items.filter((item: any) => !existingItemIds.has(item.id))

      if (itemsToCreate.length === 0) {
        results.push({
          sale_no: sale.sale_no,
          status: 'skipped',
          message: 'AR records already exist for all items'
        })
        continue
      }

      // Get total AR amount and paid amount for this sale
      let totalARAmount = 0
      let totalPaid = 0
      if (existingAR && existingAR.length > 0) {
        const { data: existingARDetails } = await supabaseServer
          .from('partner_accounts')
          .select('amount, received_paid')
          .eq('ref_type', 'sale')
          .eq('ref_id', sale.id) as any

        totalARAmount = existingARDetails?.reduce((sum: number, ar: any) => sum + ar.amount, 0) || 0
        totalPaid = existingARDetails?.reduce((sum: number, ar: any) => sum + ar.received_paid, 0) || 0
      }

      // Calculate remaining amount to allocate
      const totalItemSubtotal = items.reduce((sum: number, item: any) => sum + item.subtotal, 0)
      const remainingAmount = sale.total - totalARAmount

      // Delete old AR records without sale_item_id
      if (existingAR && existingAR.some((ar: any) => !ar.sale_item_id)) {
        await supabaseServer
          .from('partner_accounts')
          .delete()
          .eq('ref_type', 'sale')
          .eq('ref_id', sale.id)
          .is('sale_item_id', null)
      }

      // Create new AR records for items that don't have them
      // 使用 sale.total（已扣除購物金）按比例分配
      let remainingTotal = sale.total - totalARAmount // 尚未分配的金額
      const arRecords = itemsToCreate.map((item: any, index: number) => {
        // 按比例分配金額
        let itemAmount: number
        if (index === itemsToCreate.length - 1) {
          // 最後一筆用剩餘金額，避免四捨五入誤差
          itemAmount = remainingTotal
        } else {
          const itemPortion = item.subtotal / totalItemSubtotal
          itemAmount = Math.round(sale.total * itemPortion)
          remainingTotal -= itemAmount
        }

        // 按比例分配已付金額
        const itemPaid = totalPaid > 0 ? Math.round(totalPaid * (item.subtotal / totalItemSubtotal)) : 0

        return {
          partner_type: 'customer',
          partner_code: sale.customer_code,
          direction: 'AR',
          ref_type: 'sale',
          ref_id: sale.id,
          sale_item_id: item.id,
          amount: itemAmount,
          received_paid: Math.min(itemPaid, itemAmount), // 確保已付不超過應付
          due_date: sale.sale_date || new Date().toISOString().split('T')[0],
          status: itemPaid >= itemAmount ? 'paid' : itemPaid > 0 ? 'partial' : 'unpaid',
        }
      }).filter((ar: any) => ar.amount > 0) // 過濾掉金額為 0 的記錄

      if (arRecords.length === 0) {
        results.push({
          sale_no: sale.sale_no,
          status: 'skipped',
          message: 'No AR amount to create (fully covered by store credit)'
        })
        continue
      }

      const { error: insertError } = await supabaseServer
        .from('partner_accounts')
        .insert(arRecords)

      if (insertError) {
        results.push({
          sale_no: sale.sale_no,
          status: 'error',
          message: insertError.message
        })
      } else {
        totalCreated += arRecords.length
        results.push({
          sale_no: sale.sale_no,
          status: 'success',
          items_created: arRecords.length
        })
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Created ${totalCreated} AR records for ${sales.length} sales`,
      created: totalCreated,
      results
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
