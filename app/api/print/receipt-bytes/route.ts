import { NextRequest, NextResponse } from 'next/server'
import { buildClientReceiptBuffer } from '@/lib/escpos'

// POST /api/print/receipt-bytes
// Returns raw ESC/POS bytes (GB2312 encoded) for the browser to send via Web Serial.
// Body: { sale_no, payment_label, is_paid, total, discount_amount,
//         surcharge_amount, store_credit_used, received, change, items[] }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      sale_no,
      payment_label,
      is_paid,
      total,
      discount_amount,
      surcharge_amount = 0,
      store_credit_used = 0,
      received,
      change,
      items,
    } = body

    if (!sale_no || !Array.isArray(items)) {
      return NextResponse.json({ ok: false, error: '缺少必要欄位' }, { status: 400 })
    }

    // 舊匯入單可能只存 total，沒有存 discount_amount。用各金額的差額補回折扣，
    // 讓補印時「商品小計 - 折扣 + 加價 - 購物金 = 實收」仍可對得上。
    const itemSubtotal = items.reduce(
      (sum: number, item: { price?: unknown; quantity?: unknown }) =>
        sum + Number(item.price || 0) * Number(item.quantity || 0),
      0
    )
    const normalizedSurcharge = Math.max(0, Number(surcharge_amount) || 0)
    const normalizedStoreCredit = Math.max(0, Number(store_credit_used) || 0)
    const impliedDiscount = Math.max(
      0,
      itemSubtotal + normalizedSurcharge - normalizedStoreCredit - (Number(total) || 0)
    )
    const effectiveDiscount = Math.max(0, Number(discount_amount) || 0, impliedDiscount)

    const buffer = buildClientReceiptBuffer({
      sale_no,
      payment_label,
      is_paid,
      total,
      discount_amount: effectiveDiscount,
      surcharge_amount: normalizedSurcharge,
      store_credit_used: normalizedStoreCredit,
      received,
      change,
      items,
    })

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
