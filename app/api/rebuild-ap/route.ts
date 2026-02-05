import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// POST /api/rebuild-ap - Rebuild AP records for all unpaid purchases
export async function POST(request: NextRequest) {
  try {
    // Get all purchases that are not paid
    const { data: purchases, error: purchasesError } = await supabaseServer
      .from('purchases')
      .select('*, purchase_items(*)')
      .eq('is_paid', false) as any

    if (purchasesError) {
      return NextResponse.json(
        { ok: false, error: purchasesError.message },
        { status: 500 }
      )
    }

    if (!purchases || purchases.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No unpaid purchases found',
        created: 0
      })
    }

    let totalCreated = 0
    const results = []

    for (const purchase of purchases) {
      // Check if AP records already exist for this purchase
      const { data: existingAP } = await supabaseServer
        .from('partner_accounts')
        .select('id')
        .eq('ref_type', 'purchase')
        .eq('ref_id', purchase.id)

      if (existingAP && existingAP.length > 0) {
        results.push({
          purchase_no: purchase.purchase_no,
          status: 'skipped',
          message: 'AP records already exist'
        })
        continue
      }

      // Create AP records for each item
      const items = purchase.purchase_items || []
      
      if (items.length === 0) {
        results.push({
          purchase_no: purchase.purchase_no,
          status: 'error',
          message: 'No items found'
        })
        continue
      }

      const apRecords = items.map((item: any) => ({
        partner_type: 'vendor',
        partner_code: purchase.vendor_code,
        direction: 'AP',
        ref_type: 'purchase',
        ref_id: purchase.id,
        purchase_item_id: item.id,
        amount: item.subtotal,
        received_paid: 0,
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        status: 'unpaid',
      }))

      const { error: insertError } = await supabaseServer
        .from('partner_accounts')
        .insert(apRecords)

      if (insertError) {
        results.push({
          purchase_no: purchase.purchase_no,
          status: 'error',
          message: insertError.message
        })
      } else {
        totalCreated += items.length
        results.push({
          purchase_no: purchase.purchase_no,
          status: 'success',
          items_created: items.length
        })
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Created ${totalCreated} AP records for ${purchases.length} purchases`,
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
