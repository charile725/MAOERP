import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { transferFunds } from '@/lib/account-service'
import { requireRole } from '@/lib/auth'

export async function POST(request: NextRequest) {
    try {
        await requireRole('admin')
        const body = await request.json()
        const { fromAccountId, toAccountId, amount, date, note } = body

        if (!fromAccountId || !toAccountId || !amount) {
            return NextResponse.json({ ok: false, error: '缺少必要欄位' }, { status: 400 })
        }

        const { success, error } = await transferFunds({
            supabase: supabaseServer,
            fromAccountId,
            toAccountId,
            amount: Number(amount),
            date,
            note
        })

        if (!success) {
            return NextResponse.json({ ok: false, error: error || 'Transfer failed' }, { status: 400 })
        }

        return NextResponse.json({ ok: true })
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
    }
}
