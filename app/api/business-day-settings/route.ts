import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { getTaiwanDateString } from '@/lib/timezone'

// GET /api/business-day-settings - 取得當前營業日
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const source = searchParams.get('source') // 'pos' | 'live'

    if (!source) {
      return NextResponse.json(
        { ok: false, error: '缺少來源參數' },
        { status: 400 }
      )
    }

    // 查詢當前營業日
    const { data, error } = await (supabaseServer
      .from('business_day_settings') as any)
      .select('current_business_date, updated_at')
      .eq('source', source)
      .single()

    if (error) {
      // 如果表不存在或沒有資料，返回今天日期
      console.warn('[Business Day Settings] Query error:', error.message)
      return NextResponse.json({
        ok: true,
        data: {
          current_business_date: getTaiwanDateString(),
          source,
          initialized: false
        }
      })
    }

    return NextResponse.json({
      ok: true,
      data: {
        current_business_date: data.current_business_date,
        updated_at: data.updated_at,
        source,
        initialized: true
      }
    })
  } catch (error) {
    console.error('[Business Day Settings] Error:', error)
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}

// POST /api/business-day-settings - 更新當前營業日（通常由日結觸發）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { source, business_date } = body

    if (!source || !business_date) {
      return NextResponse.json(
        { ok: false, error: '缺少來源或營業日期' },
        { status: 400 }
      )
    }

    // 更新或插入
    const { data, error } = await (supabaseServer
      .from('business_day_settings') as any)
      .upsert({
        source,
        current_business_date: business_date,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'source'
      })
      .select()
      .single()

    if (error) {
      console.error('[Business Day Settings] Update error:', error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      data: {
        current_business_date: data.current_business_date,
        source
      }
    })
  } catch (error) {
    console.error('[Business Day Settings] Error:', error)
    return NextResponse.json(
      { ok: false, error: '系統錯誤' },
      { status: 500 }
    )
  }
}
