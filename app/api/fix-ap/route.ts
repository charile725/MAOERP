import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// POST /api/fix-ap - Fix old AP records by adding purchase_item_id
export async function POST(request: NextRequest) {
  try {
    // Get all AP records without purchase_item_id
    const { data: accounts, error: accountsError } = await supabaseServer
      .from('partner_accounts')
      .select('*')
      .eq('partner_type', 'vendor')
      .eq('direction', 'AP')
      .eq('ref_type', 'purchase')
      .is('purchase_item_id', null) as any

    if (accountsError) {
      return NextResponse.json(
        { ok: false, error: accountsError.message },
        { status: 500 }
      )
    }

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No records to fix',
        fixed: 0
      })
    }

    // For each account, we need to:
    // 1. Get the purchase
    // 2. Get all purchase items
    // 3. Delete the old AP record
    // 4. Create new AP records for each item

    const results = []

    for (const account of accounts) {
      // Get purchase items
      const { data: items, error: itemsError } = await supabaseServer
        .from('purchase_items')
        .select('*')
        .eq('purchase_id', account.ref_id)

      if (itemsError || !items || items.length === 0) {
        results.push({
          account_id: account.id,
          purchase_id: account.ref_id,
          status: 'error',
          error: '找不到項目'
        })
        continue
      }

      // Calculate how much each item should have
      const totalAmount = account.amount
      const totalItemSubtotal = items.reduce((sum: number, item: any) => sum + item.subtotal, 0)
      
      // Create new AP records for each item
      const newRecords = items.map((item: any) => {
        // Proportionally distribute the paid amount
        const itemPortion = item.subtotal / totalItemSubtotal
        const itemPaid = Math.round(account.received_paid * itemPortion)
        const itemBalance = item.subtotal - itemPaid
        
        return {
          partner_type: account.partner_type,
          partner_code: account.partner_code,
          direction: account.direction,
          ref_type: account.ref_type,
          ref_id: account.ref_id,
          purchase_item_id: item.id,
          amount: item.subtotal,
          received_paid: itemPaid,
          balance: itemBalance,
          due_date: account.due_date,
          status: itemBalance === 0 ? 'paid' : itemPaid > 0 ? 'partial' : 'unpaid',
        }
      })

      // Delete old record
      const { error: deleteError } = await supabaseServer
        .from('partner_accounts')
        .delete()
        .eq('id', account.id)

      if (deleteError) {
        results.push({
          account_id: account.id,
          purchase_id: account.ref_id,
          status: 'error',
          error: deleteError.message
        })
        continue
      }

      // Insert new records
      const { error: insertError } = await supabaseServer
        .from('partner_accounts')
        .insert(newRecords as any)

      if (insertError) {
        results.push({
          account_id: account.id,
          purchase_id: account.ref_id,
          status: 'error',
          error: insertError.message
        })
      } else {
        results.push({
          account_id: account.id,
          purchase_id: account.ref_id,
          status: 'success',
          items_created: items.length
        })
      }
    }

    const successCount = results.filter(r => r.status === 'success').length

    return NextResponse.json({
      ok: true,
      message: `Fixed ${successCount} out of ${accounts.length} records`,
      fixed: successCount,
      total: accounts.length,
      results
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
