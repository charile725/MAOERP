import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'

// GET /api/fixed-assets/summary - Get depreciation summary
export async function GET(request: NextRequest) {
    try {
        // 只有管理員可以查看固定資產摘要
        await requireRole('admin')

        const searchParams = request.nextUrl.searchParams
        const month = searchParams.get('month') // format: YYYY-MM

        const { data: assets, error } = await (supabaseServer
            .from('fixed_assets') as any)
            .select('*')
            .eq('status', 'active')

        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
        }

        // Calculate summary
        const targetDate = month
            ? new Date(`${month}-01`)
            : new Date()

        // Set to end of month for calculation
        if (month) {
            targetDate.setMonth(targetDate.getMonth() + 1)
            targetDate.setDate(0)
        }

        let totalMonthlyDepreciation = 0
        let totalPurchaseAmount = 0
        let totalAccumulatedDepreciation = 0
        let totalRemainingValue = 0

        const assetDetails = (assets || []).map((asset: any) => {
            const startDate = new Date(asset.depreciation_start_date)
            const monthsElapsed = Math.max(0,
                (targetDate.getFullYear() - startDate.getFullYear()) * 12 +
                (targetDate.getMonth() - startDate.getMonth())
            )

            const totalDepreciable = asset.purchase_amount - (asset.residual_value || 0)
            const accumulatedDepreciation = Math.min(
                asset.monthly_depreciation * monthsElapsed,
                totalDepreciable
            )
            const remainingValue = asset.purchase_amount - accumulatedDepreciation
            const isActive = monthsElapsed < asset.useful_life_months

            // Only count monthly depreciation if still depreciating
            if (isActive) {
                totalMonthlyDepreciation += asset.monthly_depreciation
            }
            totalPurchaseAmount += asset.purchase_amount
            totalAccumulatedDepreciation += accumulatedDepreciation
            totalRemainingValue += remainingValue

            return {
                id: asset.id,
                name: asset.asset_name,
                category: asset.category,
                purchase_amount: asset.purchase_amount,
                monthly_depreciation: asset.monthly_depreciation,
                months_elapsed: monthsElapsed,
                total_months: asset.useful_life_months,
                accumulated_depreciation: Math.round(accumulatedDepreciation * 100) / 100,
                remaining_value: Math.round(remainingValue * 100) / 100,
                is_active: isActive
            }
        })

        // Group by category
        const byCategory: Record<string, { count: number; monthly: number; accumulated: number }> = {}
        for (const asset of assetDetails) {
            if (!byCategory[asset.category]) {
                byCategory[asset.category] = { count: 0, monthly: 0, accumulated: 0 }
            }
            byCategory[asset.category].count++
            if (asset.is_active) {
                byCategory[asset.category].monthly += asset.monthly_depreciation
            }
            byCategory[asset.category].accumulated += asset.accumulated_depreciation
        }

        return NextResponse.json({
            ok: true,
            data: {
                month: month || new Date().toISOString().slice(0, 7),
                summary: {
                    total_assets: assets?.length || 0,
                    total_purchase_amount: Math.round(totalPurchaseAmount * 100) / 100,
                    total_monthly_depreciation: Math.round(totalMonthlyDepreciation * 100) / 100,
                    total_accumulated_depreciation: Math.round(totalAccumulatedDepreciation * 100) / 100,
                    total_remaining_value: Math.round(totalRemainingValue * 100) / 100
                },
                by_category: byCategory,
                assets: assetDetails
            }
        })
    } catch (error) {
        console.error('[Fixed Assets Summary] Error:', error)
        return NextResponse.json({ ok: false, error: '系統錯誤' }, { status: 500 })
    }
}
