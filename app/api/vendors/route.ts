import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { vendorSchema } from '@/lib/schemas'
import { fromZodError } from 'zod-validation-error'
import { generateCode } from '@/lib/utils'
import { ilikeAny } from '@/lib/postgrest'

// GET /api/vendors - List vendors
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const active = searchParams.get('active')
    const keyword = searchParams.get('keyword') || ''

    let query = supabaseServer
      .from('vendors')
      .select('*')
      .order('vendor_code', { ascending: true })

    if (active !== null) {
      query = query.eq('is_active', active === 'true')
    }

    // 廠商只留名稱與備註，搜尋也只找這兩個（編號留著是因為進貨單靠它關聯）
    if (keyword) {
      query = query.or(ilikeAny(['vendor_name', 'vendor_code', 'note'], keyword))
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, data })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}

// POST /api/vendors - Create new vendor
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate input
    const validation = vendorSchema.safeParse(body)
    if (!validation.success) {
      const error = fromZodError(validation.error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      )
    }

    const data = validation.data

    // Generate vendor_code if not provided
    if (!data.vendor_code) {
      // Get the latest vendor code to avoid duplicates
      const { data: lastVendorArray } = await supabaseServer
        .from('vendors')
        .select('vendor_code')
        .order('created_at', { ascending: false })
        .limit(1)

      let nextNumber = 1
      if (lastVendorArray && lastVendorArray.length > 0) {
        const lastVendor = lastVendorArray[0] as { vendor_code: string }
        // Extract number from vendor_code (e.g., "V0001" -> 1)
        const match = lastVendor.vendor_code.match(/\d+/)
        if (match) {
          nextNumber = parseInt(match[0], 10) + 1
        }
      }

      data.vendor_code = generateCode('V', nextNumber - 1)
    }

    // Check if vendor_code already exists (in case of race condition)
    const { data: existing } = await supabaseServer
      .from('vendors')
      .select('id')
      .eq('vendor_code', data.vendor_code)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { ok: false, error: '廠商編號已存在' },
        { status: 400 }
      )
    }

    // Insert vendor
    const { data: vendor, error } = await (supabaseServer
      .from('vendors') as any)
      .insert(data)
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, data: vendor }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}

// PUT /api/vendors?id=xxx - Update vendor
export async function PUT(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { ok: false, error: '請提供廠商 ID' },
        { status: 400 }
      )
    }

    const body = await request.json()

    // Validate input (allow partial updates)
    const validation = vendorSchema.partial().safeParse(body)
    if (!validation.success) {
      const error = fromZodError(validation.error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      )
    }

    const data = validation.data

    // If vendor_code is being changed, check if new code already exists
    if (data.vendor_code) {
      const { data: existing } = await supabaseServer
        .from('vendors')
        .select('id')
        .eq('vendor_code', data.vendor_code)
        .neq('id', id)
        .maybeSingle()

      if (existing) {
        return NextResponse.json(
          { ok: false, error: '廠商編號已存在' },
          { status: 400 }
        )
      }
    }

    // Update vendor
    const { data: vendor, error } = await (supabaseServer
      .from('vendors') as any)
      .update(data)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, data: vendor })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}

// DELETE /api/vendors?id=xxx - Delete vendor
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { ok: false, error: '請提供廠商 ID' },
        { status: 400 }
      )
    }

    // Check if vendor has related purchases
    const { data: vendor } = await (supabaseServer
      .from('vendors') as any)
      .select('vendor_code')
      .eq('id', id)
      .maybeSingle()

    if (!vendor) {
      return NextResponse.json(
        { ok: false, error: '找不到該廠商' },
        { status: 404 }
      )
    }

    const { data: purchases } = await (supabaseServer
      .from('purchases') as any)
      .select('id')
      .eq('vendor_code', vendor.vendor_code)
      .limit(1)

    if (purchases && purchases.length > 0) {
      return NextResponse.json(
        { ok: false, error: '此廠商有關聯的進貨記錄，無法刪除' },
        { status: 400 }
      )
    }

    // Delete vendor
    const { error } = await (supabaseServer
      .from('vendors') as any)
      .delete()
      .eq('id', id)

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
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
