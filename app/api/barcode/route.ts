import { NextRequest, NextResponse } from 'next/server'
import bwipjs from 'bwip-js'

// GET /api/barcode - Generate barcode image
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const text = searchParams.get('text')
    const type = searchParams.get('type') || 'code128' // code128, ean13
    const format = searchParams.get('format') || 'png' // png, svg
    const height = parseInt(searchParams.get('height') || '12', 10)
    const scale = parseFloat(searchParams.get('scale') || '0.7')
    const includeText = searchParams.get('includetext') === '1'

    if (!text) {
      return NextResponse.json(
        { ok: false, error: '缺少 text 參數' },
        { status: 400 }
      )
    }

    // Validate barcode type
    const validTypes = ['code128', 'ean13', 'ean8', 'upca', 'code39']
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { ok: false, error: `Invalid barcode type. Valid types: ${validTypes.join(', ')}` },
        { status: 400 }
      )
    }

    // Generate barcode using toBuffer (works for both PNG and SVG)
    const png = await bwipjs.toBuffer({
      bcid: type,
      text,
      scale,
      height,
      includetext: includeText,
      textxalign: 'center',
    })

    return new NextResponse(png as unknown as BodyInit, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error: any) {
    console.error('Barcode generation error:', error)
    return NextResponse.json(
      { ok: false, error: error.message || '條碼產生失敗' },
      { status: 500 }
    )
  }
}
