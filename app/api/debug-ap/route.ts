import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// GET /api/debug-ap - Debug AP data
export async function GET(request: NextRequest) {
  try {
    // Get all AP accounts
    const { data: accounts, error } = await supabaseServer
      .from('partner_accounts')
      .select('*')
      .eq('partner_type', 'vendor')
      .eq('direction', 'AP')
      .limit(5) as any

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    // Get purchase items info
    const itemIds = accounts?.filter((a: any) => a.purchase_item_id).map((a: any) => a.purchase_item_id) || []
    
    let items: any[] = []
    if (itemIds.length > 0) {
      const { data } = await supabaseServer
        .from('purchase_items')
        .select('*, products:product_id(name, item_code, unit)')
        .in('id', itemIds)
      items = data || []
    }

    // Get purchase info
    const purchaseIds = [...new Set(accounts?.filter((a: any) => a.ref_type === 'purchase').map((a: any) => a.ref_id) || [])]
    
    let purchases: any[] = []
    if (purchaseIds.length > 0) {
      const { data } = await supabaseServer
        .from('purchases')
        .select('*, purchase_items(*, products:product_id(*))')
        .in('id', purchaseIds)
      purchases = data || []
    }

    return NextResponse.json({
      ok: true,
      data: {
        accounts,
        items,
        purchases,
        summary: {
          total_accounts: accounts?.length || 0,
          accounts_with_item_id: accounts?.filter((a: any) => a.purchase_item_id).length || 0,
          accounts_without_item_id: accounts?.filter((a: any) => !a.purchase_item_id).length || 0,
        }
      }
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
