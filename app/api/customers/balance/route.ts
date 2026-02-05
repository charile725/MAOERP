import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { balanceAdjustmentSchema } from '@/lib/schemas'
import { fromZodError } from 'zod-validation-error'
import { getTaiwanTime } from '@/lib/timezone'

// POST /api/customers/balance - 调整客户购物金余额
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // 验证输入
    const validation = balanceAdjustmentSchema.safeParse(body)
    if (!validation.success) {
      const error = fromZodError(validation.error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      )
    }

    const { customer_code, amount, type, note } = validation.data

    // 获取当前客户信息
    const { data: customer, error: customerError } = await (supabaseServer
      .from('customers') as any)
      .select('id, customer_name, store_credit, credit_limit')
      .eq('customer_code', customer_code)
      .single()

    if (customerError || !customer) {
      return NextResponse.json(
        { ok: false, error: '客户不存在' },
        { status: 404 }
      )
    }

    const balanceBefore = customer.store_credit || 0
    const balanceAfter = balanceBefore + amount

    // 检查信用额度限制
    if (balanceAfter < 0 && customer.credit_limit > 0) {
      if (Math.abs(balanceAfter) > customer.credit_limit) {
        return NextResponse.json(
          {
            ok: false,
            error: `超过信用额度限制。当前额度：$${customer.credit_limit.toFixed(2)}，调整后欠款：$${Math.abs(balanceAfter).toFixed(2)}`
          },
          { status: 400 }
        )
      }
    }

    // 如果信用额度为 0 且调整后余额为负，拒绝操作
    if (balanceAfter < 0 && customer.credit_limit === 0) {
      return NextResponse.json(
        { ok: false, error: '此客户不允许欠款（信用额度为 0）' },
        { status: 400 }
      )
    }

    // 开始事务：更新客户余额 + 创建调整记录
    // 1. 更新客户余额
    const { error: updateError } = await (supabaseServer
      .from('customers') as any)
      .update({ store_credit: balanceAfter })
      .eq('customer_code', customer_code)

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 }
      )
    }

    // 2. 创建余额调整记录（使用台灣時間）
    const { data: log, error: logError } = await (supabaseServer
      .from('customer_balance_logs') as any)
      .insert({
        customer_code,
        amount,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        type,
        note,
        ref_type: 'manual',
        created_by: null, // TODO: 从会话中获取当前用户
        created_at: getTaiwanTime(),
      })
      .select()
      .single()

    if (logError) {
      // 如果日志记录失败，尝试回滚客户余额
      await (supabaseServer
        .from('customers') as any)
        .update({ store_credit: balanceBefore })
        .eq('customer_code', customer_code)

      return NextResponse.json(
        { ok: false, error: '创建记录失败' },
        { status: 500 }
      )
    }

    // 返回更新后的客户信息
    const { data: updatedCustomer } = await (supabaseServer
      .from('customers') as any)
      .select('*')
      .eq('customer_code', customer_code)
      .single()

    return NextResponse.json({
      ok: true,
      data: {
        customer: updatedCustomer,
        log
      }
    })
  } catch (error) {
    console.error('Balance adjustment error:', error)
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}

// GET /api/customers/balance?customer_code=xxx - 获取客户购物金交易记录
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const customer_code = searchParams.get('customer_code')

    if (!customer_code) {
      return NextResponse.json(
        { ok: false, error: '請提供客戶編號' },
        { status: 400 }
      )
    }

    const { data, error } = await (supabaseServer
      .from('customer_balance_logs') as any)
      .select('*')
      .eq('customer_code', customer_code)
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
