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

    // 如果有 keyword，先搜尋廠商名稱找出對應的 vendor_code
    let matchingVendorCodes: string[] = []

    if (keyword) {
      const { data: vendors } = await supabaseServer
        .from('vendors')
        .select('vendor_code')
        .ilike('vendor_name', `%${keyword}%`)

      matchingVendorCodes = (vendors as any[])?.map(v => v.vendor_code) || []
    }

    // 首先獲取所有符合條件的 partner_code 和 balance（不分頁），以確保完整分組和計算全域總額
    let allQuery = supabaseServer
      .from('partner_accounts')
      .select('partner_code, balance, status')
      .eq('partner_type', 'vendor')
      .eq('direction', 'AP')

    if (vendorCode) {
      allQuery = allQuery.eq('partner_code', vendorCode)
    }

    if (status) {
      allQuery = allQuery.eq('status', status)
    }

    if (dueBefore) {
      allQuery = allQuery.lte('due_date', dueBefore)
    }

    if (keyword) {
      const safeKeyword = keyword.replace(/[(),.*\\]/g, '')
      const conditions: string[] = []
      if (safeKeyword) {
        conditions.push(`partner_code.ilike.%${safeKeyword}%`)
      }
      if (matchingVendorCodes.length > 0) {
        conditions.push(`partner_code.in.(${matchingVendorCodes.join(',')})`)
      }
      if (conditions.length > 0) {
        allQuery = allQuery.or(conditions.join(','))
      }
    }

    const { data: allAccounts } = await allQuery

    // 計算全域未付總額（跨所有頁面）
    const globalTotalUnpaid = (allAccounts || [])
      .filter((a: any) => a.status !== 'paid')
      .reduce((sum: number, a: any) => sum + (a.balance || 0), 0)
    const globalUnpaidCount = (allAccounts || [])
      .filter((a: any) => a.status !== 'paid').length

    // 取得唯一的 partner_codes 並按照廠商分頁
    const uniquePartnerCodes = [...new Set((allAccounts || []).map((a: any) => a.partner_code))]
    const totalVendors = uniquePartnerCodes.length
    const totalPages = Math.ceil(totalVendors / pageSize)

    // 對廠商代碼進行分頁
    const from = (page - 1) * pageSize
    const to = from + pageSize
    const pagedPartnerCodes = uniquePartnerCodes.slice(from, to)

    if (pagedPartnerCodes.length === 0) {
      return NextResponse.json({
        ok: true,
        data: [],
        pagination: { page, pageSize, total: totalVendors, totalPages },
        summary: { globalTotalUnpaid, globalUnpaidCount }
      })
    }

    // 獲取這些廠商的所有帳款記錄
    let query = supabaseServer
      .from('partner_accounts')
      .select('*')
      .eq('partner_type', 'vendor')
      .eq('direction', 'AP')
      .in('partner_code', pagedPartnerCodes)
      .order('created_at', { ascending: false })

    if (status) {
      query = query.eq('status', status)
    }

    if (dueBefore) {
      query = query.lte('due_date', dueBefore)
    }

    const { data: accounts, error } = await query

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({
        ok: true,
        data: [],
        pagination: { page, pageSize, total: totalVendors, totalPages },
        summary: { globalTotalUnpaid, globalUnpaidCount }
      })
    }

    // Fetch vendor details separately
    const vendorCodes = [...new Set((accounts as any[]).map(a => a.partner_code))]
    const { data: vendors } = await supabaseServer
      .from('vendors')
      .select('vendor_code, vendor_name')
      .in('vendor_code', vendorCodes)

    // Fetch purchase item details for accounts with purchase_item_id
    const itemIds = (accounts as any[]).filter(a => a.purchase_item_id).map(a => a.purchase_item_id)
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
    const purchaseIds = [...new Set((accounts as any[]).filter(a => a.ref_type === 'purchase').map(a => a.ref_id))]
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

    const accountsWithDetails = (accounts as any[]).map(account => ({
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
        total: totalVendors,
        totalPages
      },
      summary: { globalTotalUnpaid, globalUnpaidCount }
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
