import { NextRequest, NextResponse } from 'next/server'
import { buildClientReceiptBuffer } from '@/lib/escpos'

// POST /api/print/receipt-bytes
// Returns raw ESC/POS bytes (GB2312 encoded) for the browser to send via Web Serial.
// Body: { sale_no, payment_label, is_paid, total, discount_amount, items[] }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sale_no, payment_label, is_paid, total, discount_amount, received, change, items } = body

    if (!sale_no || !items) {
      return NextResponse.json({ ok: false, error: '缺少必要欄位' }, { status: 400 })
    }

    const buffer = buildClientReceiptBuffer({ sale_no, payment_label, is_paid, total, discount_amount, received, change, items })

    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(buffer.length),
      },
    })
  } catch (err: any) {
    console.error('[receipt-bytes]', err)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
