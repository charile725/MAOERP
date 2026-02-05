import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// GET /api/sale-drafts - List all draft orders
export async function GET(request: NextRequest) {
  try {
    const { data, error } = await (supabaseServer
      .from('sale_drafts') as any)
      .select(`
        *,
        customers:customer_code (
          customer_name
        )
      `)
      .order('created_at', { ascending: false })

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

// POST /api/sale-drafts - Create a draft order
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const { data, error } = await (supabaseServer
      .from('sale_drafts') as any)
      .insert({
        customer_code: body.customer_code || null,
        payment_method: body.payment_method,
        is_paid: body.is_paid,
        note: body.note || null,
        discount_type: body.discount_type || 'none',
        discount_value: body.discount_value || 0,
        items: body.items,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { ok: true, data },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
