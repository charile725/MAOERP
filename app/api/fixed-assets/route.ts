import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'

// GET /api/fixed-assets - List all fixed assets
export async function GET(request: NextRequest) {
    try {
        // 只有管理員可以查看固定資產
        await requireRole('admin')

        const searchParams = request.nextUrl.searchParams
        const category = searchParams.get('category')
        const status = searchParams.get('status')

        let query = (supabaseServer
            .from('fixed_assets') as any)
            .select('*')
            .order('purchase_date', { ascending: false })

        if (category) {
            query = query.eq('category', category)
        }

        if (status) {
            query = query.eq('status', status)
        } else {
            // Default to active assets
            query = query.neq('status', 'disposed')
        }

        const { data, error } = await query

        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
        }

        // Calculate accumulated depreciation and remaining value for each asset
        const now = new Date()
        const assetsWithCalculations = (data || []).map((asset: any) => {
            const startDate = new Date(asset.depreciation_start_date)
            const monthsElapsed = Math.max(0,
                (now.getFullYear() - startDate.getFullYear()) * 12 +
                (now.getMonth() - startDate.getMonth())
            )

            const totalDepreciable = asset.purchase_amount - (asset.residual_value || 0)
            const accumulatedDepreciation = Math.min(
                asset.monthly_depreciation * monthsElapsed,
                totalDepreciable
            )
            const remainingValue = asset.purchase_amount - accumulatedDepreciation
            const progressPercent = totalDepreciable > 0
                ? Math.min(100, (accumulatedDepreciation / totalDepreciable) * 100)
                : 0

            return {
                ...asset,
                months_elapsed: monthsElapsed,
                accumulated_depreciation: Math.round(accumulatedDepreciation * 100) / 100,
                remaining_value: Math.round(remainingValue * 100) / 100,
                progress_percent: Math.round(progressPercent * 10) / 10,
                is_fully_depreciated: monthsElapsed >= asset.useful_life_months
            }
        })

        return NextResponse.json({ ok: true, data: assetsWithCalculations })
    } catch (error) {
        console.error('[Fixed Assets] GET error:', error)
        return NextResponse.json({ ok: false, error: '系統錯誤' }, { status: 500 })
    }
}

// POST /api/fixed-assets - Create new fixed asset
export async function POST(request: NextRequest) {
    try {
        // 只有管理員可以新增固定資產
        await requireRole('admin')

        const body = await request.json()
        const {
            asset_name,
            category,
            purchase_date,
            purchase_amount,
            residual_value,
            useful_life_months,
            depreciation_start_date,
            note
        } = body

        // Validation
        if (!asset_name || !purchase_date || !purchase_amount || !useful_life_months) {
            return NextResponse.json(
                { ok: false, error: '請填寫必要欄位：資產名稱、購入日期、購入金額、攤提月數' },
                { status: 400 }
            )
        }

        if (purchase_amount <= 0) {
            return NextResponse.json(
                { ok: false, error: '購入金額必須大於 0' },
                { status: 400 }
            )
        }

        if (useful_life_months <= 0) {
            return NextResponse.json(
                { ok: false, error: '攤提月數必須大於 0' },
                { status: 400 }
            )
        }

        const { data, error } = await (supabaseServer
            .from('fixed_assets') as any)
            .insert({
                asset_name,
                category: category || 'equipment',
                purchase_date,
                purchase_amount,
                residual_value: residual_value || 0,
                useful_life_months,
                depreciation_start_date: depreciation_start_date || purchase_date,
                note: note || null,
                status: 'active'
            })
            .select()
            .single()

        if (error) {
            console.error('[Fixed Assets] Insert error:', error)
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ ok: true, data }, { status: 201 })
    } catch (error) {
        console.error('[Fixed Assets] POST error:', error)
        return NextResponse.json({ ok: false, error: '系統錯誤' }, { status: 500 })
    }
}
