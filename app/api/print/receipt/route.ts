import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import net from 'net'
import { buildReceiptBuffer } from '@/lib/escpos'

const PAYMENT_LABELS: Record<string, string> = {
  cash:        '現金',
  transfer:    '轉帳',
  credit_card: '信用卡',
  linepay:     'LINE Pay',
  jkopay:      '街口支付',
  pending:     '待定',
}

function sendToprinter(data: Buffer, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    socket.setTimeout(5000)

    socket.connect(port, host, () => {
      socket.write(data, (err) => {
        if (err) { socket.destroy(); return reject(err) }
        // Give printer time to receive before closing
        setTimeout(() => { socket.end(); resolve() }, 500)
      })
    })

    socket.on('timeout', () => { socket.destroy(); reject(new Error('印表機連線逾時')) })
    socket.on('error', (err) => reject(err))
  })
}

export async function POST(request: NextRequest) {
  try {
    const { sale_id } = await request.json()
    if (!sale_id) {
      return NextResponse.json({ ok: false, error: '缺少 sale_id' }, { status: 400 })
    }

    // Fetch sale
    const { data: sale, error: saleError } = await (supabaseServer
      .from('sales') as any)
      .select('id, sale_no, created_at, payment_method, is_paid, total, discount_amount')
      .eq('id', sale_id)
      .single()

    if (saleError || !sale) {
      return NextResponse.json({ ok: false, error: '找不到銷售單' }, { status: 404 })
    }

    // Fetch items
    const { data: items, error: itemsError } = await (supabaseServer
      .from('sale_items') as any)
      .select('snapshot_name, quantity, price')
      .eq('sale_id', sale_id)

    if (itemsError) {
      return NextResponse.json({ ok: false, error: itemsError.message }, { status: 500 })
    }

    // Resolve payment label (try accounts table first, fall back to mapping)
    let paymentLabel = PAYMENT_LABELS[sale.payment_method] || sale.payment_method
    if (!PAYMENT_LABELS[sale.payment_method]) {
      const { data: account } = await (supabaseServer
        .from('accounts') as any)
        .select('account_name')
        .eq('payment_method_code', sale.payment_method)
        .eq('is_active', true)
        .single()
      if (account) paymentLabel = account.account_name
    }

    // Build ESC/POS buffer
    const buffer = buildReceiptBuffer({
      sale_no: sale.sale_no,
      created_at: sale.created_at,
      payment_label: paymentLabel,
      is_paid: sale.is_paid,
      total: sale.total,
      discount_amount: sale.discount_amount || 0,
      items: items || [],
    })

    // Send to printer
    const host = process.env.PRINTER_IP || '192.168.1.200'
    const port = parseInt(process.env.PRINTER_PORT || '9100')

    await sendToprinter(buffer, host, port)

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('[Print] Error:', error)
    return NextResponse.json({ ok: false, error: error.message || '列印失敗' }, { status: 500 })
  }
}
