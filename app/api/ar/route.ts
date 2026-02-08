import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'

// GET /api/ar - List accounts receivable
export async function GET(request: NextRequest) {
  try {
    // 只有管理員可以查看應收帳款
    await requireRole('admin')

    const searchParams = request.nextUrl.searchParams
    const customerCode = searchParams.get('customer_code')
    const status = searchParams.get('status')
    const dueBefore = searchParams.get('due_before')
    const keyword = searchParams.get('keyword')
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')

    // 如果有 keyword，先搜尋銷貨單號和客戶名稱找出對應的 ID
    let saleRefIds: string[] = []
    let matchingCustomerCodes: string[] = []

    if (keyword) {
      // 並行搜尋銷貨單號和客戶名稱
      const [salesResult, customersResult] = await Promise.all([
        supabaseServer
          .from('sales')
          .select('id')
          .ilike('sale_no', `%${keyword}%`),
        supabaseServer
          .from('customers')
          .select('customer_code')
          .ilike('customer_name', `%${keyword}%`)
      ])

      saleRefIds = (salesResult.data as any[])?.map(s => s.id) || []
      matchingCustomerCodes = (customersResult.data as any[])?.map(c => c.customer_code) || []
    }

    // 首先獲取所有符合條件的 partner_code 和 balance（不分頁），以確保完整分組和計算全域總額
    let allQuery = supabaseServer
      .from('partner_accounts')
      .select('partner_code, balance, status')
      .eq('partner_type', 'customer')
      .eq('direction', 'AR')

    if (customerCode) {
      allQuery = allQuery.eq('partner_code', customerCode)
    }

    if (status) {
      allQuery = allQuery.eq('status', status)
    }

    if (dueBefore) {
      allQuery = allQuery.lte('due_date', dueBefore)
    }

    if (keyword) {
      // 清理 keyword，移除 PostgREST filter 特殊字元避免 injection
      const safeKeyword = keyword.replace(/[(),.*\\]/g, '')
      const conditions: string[] = []
      if (safeKeyword) {
        conditions.push(`partner_code.ilike.%${safeKeyword}%`)
      }
      if (matchingCustomerCodes.length > 0) {
        conditions.push(`partner_code.in.(${matchingCustomerCodes.join(',')})`)
      }
      if (saleRefIds.length > 0) {
        conditions.push(`ref_id.in.(${saleRefIds.join(',')})`)
      }
      if (conditions.length > 0) {
        allQuery = allQuery.or(conditions.join(','))
      }
    }

    const { data: allAccounts } = await allQuery

    // 計算全域未收總額（跨所有頁面）
    const globalTotalUnpaid = (allAccounts || [])
      .filter((a: any) => a.status !== 'paid')
      .reduce((sum: number, a: any) => sum + (a.balance || 0), 0)
    const globalUnpaidCount = (allAccounts || [])
      .filter((a: any) => a.status !== 'paid').length

    // 取得唯一的 partner_codes 並按照它們分頁
    const uniquePartnerCodes = [...new Set((allAccounts || []).map((a: any) => a.partner_code))]
    const totalCustomers = uniquePartnerCodes.length
    const totalPages = Math.ceil(totalCustomers / pageSize)

    // 對客戶代碼進行分頁
    const from = (page - 1) * pageSize
    const to = from + pageSize
    const pagedPartnerCodes = uniquePartnerCodes.slice(from, to)

    if (pagedPartnerCodes.length === 0) {
      return NextResponse.json({
        ok: true,
        data: [],
        pagination: { page, pageSize, total: totalCustomers, totalPages },
        summary: { globalTotalUnpaid, globalUnpaidCount }
      })
    }

    // 獲取這些客戶的所有帳款記錄
    let query = supabaseServer
      .from('partner_accounts')
      .select('*')
      .eq('partner_type', 'customer')
      .eq('direction', 'AR')
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
        pagination: { page, pageSize, total: totalCustomers, totalPages },
        summary: { globalTotalUnpaid, globalUnpaidCount }
      })
    }

    // 收集需要查詢的 ID
    const customerCodes = [...new Set((accounts as any[]).map(a => a.partner_code))]
    const itemIds = (accounts as any[]).filter(a => a.sale_item_id).map(a => a.sale_item_id)
    const saleIds = [...new Set((accounts as any[]).filter(a => a.ref_type === 'sale' || a.ref_type === 'sale_correction').map(a => a.ref_id))]

    // 並行查詢所有相關資料
    const [customersResult, itemsResult, salesResult, saleItemsResult] = await Promise.all([
      // 查詢客戶（包含購物金餘額）
      supabaseServer
        .from('customers')
        .select('customer_code, customer_name, store_credit')
        .in('customer_code', customerCodes),
      // 查詢 sale items（如果有）
      itemIds.length > 0
        ? supabaseServer
          .from('sale_items')
          .select('id, quantity, price, subtotal, product_id, sale_id, snapshot_name, products:product_id(item_code, unit)')
          .in('id', itemIds)
        : Promise.resolve({ data: [] }),
      // 查詢 sales
      saleIds.length > 0
        ? supabaseServer
          .from('sales')
          .select('id, sale_no, sale_date, payment_method')
          .in('id', saleIds)
        : Promise.resolve({ data: [] }),
      // 查詢完整 sale_items
      saleIds.length > 0
        ? supabaseServer
          .from('sale_items')
          .select('id, quantity, price, subtotal, product_id, sale_id, snapshot_name, products:product_id(item_code, unit)')
          .in('sale_id', saleIds)
        : Promise.resolve({ data: [] })
    ])

    // 建立 Map
    const customersMap = new Map(
      (customersResult.data as any[])?.map(c => [c.customer_code, c]) || []
    )
    const itemsMap = new Map(
      (itemsResult.data as any[])?.map(item => [item.id, item]) || []
    )
    const salesMap = new Map(
      (salesResult.data as any[])?.map(s => [s.id, s]) || []
    )
    const saleItemsBySaleId = new Map<string, any[]>()
    saleItemsResult.data?.forEach((item: any) => {
      if (!saleItemsBySaleId.has(item.sale_id)) {
        saleItemsBySaleId.set(item.sale_id, [])
      }
      saleItemsBySaleId.get(item.sale_id)!.push(item)
    })

    // 組合結果
    const accountsWithDetails = (accounts as any[]).map(account => {
      const saleData = (account.ref_type === 'sale' || account.ref_type === 'sale_correction') ? salesMap.get(account.ref_id) : null
      const saleItems = (account.ref_type === 'sale' || account.ref_type === 'sale_correction') ? saleItemsBySaleId.get(account.ref_id) || [] : []

      return {
        ...account,
        customers: customersMap.get(account.partner_code) || null,
        sale_item: account.sale_item_id ? itemsMap.get(account.sale_item_id) : null,
        sales: saleData,
        sale_items: saleItems
      }
    })

    return NextResponse.json({
      ok: true,
      data: accountsWithDetails,
      pagination: {
        page,
        pageSize,
        total: totalCustomers,
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
