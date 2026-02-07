import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { customerSchema } from '@/lib/schemas'
import { fromZodError } from 'zod-validation-error'
import { generateCode } from '@/lib/utils'

// GET /api/customers - List customers
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const active = searchParams.get('active')
    const keyword = searchParams.get('keyword') || ''

    let query = supabaseServer
      .from('customers')
      .select('*')
      .order('customer_code', { ascending: true })

    if (active !== null) {
      query = query.eq('is_active', active === 'true')
    }

    // Search by keyword (name, customer_code, phone, store_address, or delivery_address)
    if (keyword) {
      query = query.or(`customer_name.ilike.%${keyword}%,customer_code.ilike.%${keyword}%,phone.ilike.%${keyword}%,store_address.ilike.%${keyword}%,delivery_address.ilike.%${keyword}%`)
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

// POST /api/customers - Create new customer
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate input
    const validation = customerSchema.safeParse(body)
    if (!validation.success) {
      const error = fromZodError(validation.error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      )
    }

    const data = validation.data

    // Generate customer_code if not provided
    if (!data.customer_code) {
      // Get the latest customer code to avoid duplicates
      const { data: lastCustomerArray } = await supabaseServer
        .from('customers')
        .select('customer_code')
        .order('created_at', { ascending: false })
        .limit(1)

      let nextNumber = 1
      if (lastCustomerArray && lastCustomerArray.length > 0) {
        const lastCustomer = lastCustomerArray[0] as { customer_code: string }
        // Extract number from customer_code (e.g., "C0001" -> 1)
        const match = lastCustomer.customer_code.match(/\d+/)
        if (match) {
          nextNumber = parseInt(match[0], 10) + 1
        }
      }

      data.customer_code = generateCode('C', nextNumber - 1)
    }

    // Check if customer_code already exists (in case of race condition)
    const { data: existing } = await supabaseServer
      .from('customers')
      .select('id')
      .eq('customer_code', data.customer_code)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { ok: false, error: '客戶編號已存在' },
        { status: 400 }
      )
    }

    // Insert customer
    const { data: customer, error } = await (supabaseServer
      .from('customers') as any)
      .insert(data)
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, data: customer }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}

// PUT /api/customers?id=xxx - Update customer
export async function PUT(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { ok: false, error: '請提供客戶 ID' },
        { status: 400 }
      )
    }

    const body = await request.json()

    // Validate input (allow partial updates)
    const validation = customerSchema.partial().safeParse(body)
    if (!validation.success) {
      const error = fromZodError(validation.error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      )
    }

    const data = validation.data

    // If customer_code is being changed, check if new code already exists
    if (data.customer_code) {
      const { data: existing } = await supabaseServer
        .from('customers')
        .select('id')
        .eq('customer_code', data.customer_code)
        .neq('id', id)
        .maybeSingle()

      if (existing) {
        return NextResponse.json(
          { ok: false, error: '客戶編號已存在' },
          { status: 400 }
        )
      }
    }

    // Update customer
    const { data: customer, error } = await (supabaseServer
      .from('customers') as any)
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

    return NextResponse.json({ ok: true, data: customer })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}

// DELETE /api/customers?id=xxx - Delete customer
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { ok: false, error: '請提供客戶 ID' },
        { status: 400 }
      )
    }

    // Check if customer has related sales
    const { data: customer } = await (supabaseServer
      .from('customers') as any)
      .select('customer_code')
      .eq('id', id)
      .maybeSingle()

    if (!customer) {
      return NextResponse.json(
        { ok: false, error: '找不到該客戶' },
        { status: 404 }
      )
    }

    const { data: sales } = await (supabaseServer
      .from('sales') as any)
      .select('id')
      .eq('customer_code', customer.customer_code)
      .limit(1)

    if (sales && sales.length > 0) {
      return NextResponse.json(
        { ok: false, error: '此客戶有關聯的銷售記錄，無法刪除' },
        { status: 400 }
      )
    }

    // Delete customer
    const { error } = await supabaseServer
      .from('customers')
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
