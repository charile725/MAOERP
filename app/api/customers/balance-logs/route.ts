import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// GET /api/customers/balance-logs?customer_code=xxx - 取得客戶購物金異動記錄
export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams
        const customerCode = searchParams.get('customer_code')

        if (!customerCode) {
            return NextResponse.json(
                { ok: false, error: '請提供客戶編號' },
                { status: 400 }
            )
        }

        const { data, error } = await (supabaseServer
            .from('customer_balance_logs') as any)
            .select('*')
            .eq('customer_code', customerCode)
            .order('created_at', { ascending: false })
            .limit(100)

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
