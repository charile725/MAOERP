import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'

// GET /api/ap - List accounts payable
export async function GET(request: NextRequest) {
  try {
    // 只有管理員可以查看應付帳款
    await requireRole('admin')

    const searchParams = request.nextUrl.searchParams
    const vendorCode = searchParams.get('vendor_code')
    const status = searchParams.get('status')
    const dueBefore = searchParams.get('due_before')
    const keyword = searchParams.get('keyword')
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')

    let query = supabaseServer
      .from('partner_accounts')
      .select('*', { count: 'exact' })
      .eq('partner_type', 'vendor')
      .eq('direction', 'AP')
      .order('created_at', { ascending: false })

    if (vendorCode) {
      query = query.eq('partner_code', vendorCode)
    }

    if (status) {
      query = query.eq('status', status)
    }

    if (dueBefore) {
      query = query.lte('due_date', dueBefore)
    }

    if (keyword) {
      query = query.ilike('partner_code', `%${keyword}%`)
    }

    // Apply pagination
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1
    query = query.range(from, to)

    const { data: accounts, error, count } = await query

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    // Fetch vendor details separately
    const vendorCodes = [...new Set((accounts as any[])?.map(a => a.partner_code) || [])]
    const { data: vendors } = await supabaseServer
      .from('vendors')
      .select('vendor_code, vendor_name')
      .in('vendor_code', vendorCodes)

    // Fetch purchase item details for accounts with purchase_item_id
    const itemIds = (accounts as any[])?.filter(a => a.purchase_item_id).map(a => a.purchase_item_id) || []
    let itemsMap = new Map()

    if (itemIds.length > 0) {
      const { data: items } = await supabaseServer
        .from('purchase_items')
        .select('id, quantity, cost, subtotal, product_id, purchase_id, products:product_id(name, item_code, unit)')
        .in('id', itemIds)

      itemsMap = new Map(
        (items as any[])?.map(item => [item.id, item]) || []
      )
    }

    // Fetch purchase details to get purchase_no
    const purchaseIds = [...new Set((accounts as any[])?.filter(a => a.ref_type === 'purchase').map(a => a.ref_id) || [])]
    let purchasesMap = new Map()

    if (purchaseIds.length > 0) {
      const { data: purchases } = await supabaseServer
        .from('purchases')
        .select('id, purchase_no')
        .in('id', purchaseIds)

      purchasesMap = new Map(
        (purchases as any[])?.map(p => [p.id, p]) || []
      )
    }

    // Map vendor names and product info to accounts
    const vendorsMap = new Map(
      (vendors as any[])?.map(v => [v.vendor_code, v]) || []
    )

    const accountsWithDetails = (accounts as any[])?.map(account => ({
      ...account,
      vendors: vendorsMap.get(account.partner_code) || null,
      purchase_item: account.purchase_item_id ? itemsMap.get(account.purchase_item_id) : null,
      purchases: account.ref_type === 'purchase' ? purchasesMap.get(account.ref_id) : null
    }))

    return NextResponse.json({
      ok: true,
      data: accountsWithDetails,
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize)
      }
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
