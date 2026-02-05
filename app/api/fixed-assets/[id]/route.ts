import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'

// GET /api/fixed-assets/[id] - Get single fixed asset
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        // 只有管理員可以查看固定資產
        await requireRole('admin')

        const { id } = await params

        const { data, error } = await (supabaseServer
            .from('fixed_assets') as any)
            .select('*')
            .eq('id', id)
            .single()

        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 404 })
        }

        return NextResponse.json({ ok: true, data })
    } catch (error) {
        return NextResponse.json({ ok: false, error: '系統錯誤' }, { status: 500 })
    }
}

// PATCH /api/fixed-assets/[id] - Update fixed asset
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        // 只有管理員可以更新固定資產
        await requireRole('admin')

        const { id } = await params
        const body = await request.json()

        const allowedFields = [
            'asset_name',
            'category',
            'purchase_date',
            'purchase_amount',
            'residual_value',
            'useful_life_months',
            'depreciation_start_date',
            'status',
            'note'
        ]

        const updateData: Record<string, any> = {}
        for (const field of allowedFields) {
            if (body[field] !== undefined) {
                updateData[field] = body[field]
            }
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ ok: false, error: '沒有要更新的欄位' }, { status: 400 })
        }

        const { data, error } = await (supabaseServer
            .from('fixed_assets') as any)
            .update(updateData)
            .eq('id', id)
            .select()
            .single()

        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ ok: true, data })
    } catch (error) {
        return NextResponse.json({ ok: false, error: '系統錯誤' }, { status: 500 })
    }
}

// DELETE /api/fixed-assets/[id] - Delete fixed asset
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        // 只有管理員可以刪除固定資產
        await requireRole('admin')

        const { id } = await params

        const { error } = await (supabaseServer
            .from('fixed_assets') as any)
            .delete()
            .eq('id', id)

        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ ok: true })
    } catch (error) {
        return NextResponse.json({ ok: false, error: '系統錯誤' }, { status: 500 })
    }
}
