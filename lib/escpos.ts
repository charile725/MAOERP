const LINE_WIDTH = 42

// ESC/POS commands
const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

export const CMD = {
  INIT:          Buffer.from([ESC, 0x40]),
  ALIGN_LEFT:    Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_CENTER:  Buffer.from([ESC, 0x61, 0x01]),
  BOLD_ON:       Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF:      Buffer.from([ESC, 0x45, 0x00]),
  FEED:          Buffer.from([ESC, 0x64, 0x04]),
  CUT:           Buffer.from([GS, 0x56, 0x41, 0x05]),
  LF:            Buffer.from([LF]),
}

// CJK characters count as 2 columns
function strWidth(str: string): number {
  let width = 0
  for (const char of str) {
    const code = char.codePointAt(0) || 0
    width += (code >= 0x1100 && code <= 0xFFE6) ? 2 : 1
  }
  return width
}

function padEnd(str: string, width: number): string {
  return str + ' '.repeat(Math.max(0, width - strWidth(str)))
}

function padStart(str: string, width: number): string {
  return ' '.repeat(Math.max(0, width - strWidth(str))) + str
}

function truncate(str: string, maxWidth: number): string {
  let width = 0
  let result = ''
  for (const char of str) {
    const w = (char.codePointAt(0) || 0) >= 0x1100 ? 2 : 1
    if (width + w > maxWidth - 1) { result += '.'; break }
    result += char
    width += w
  }
  return result
}

function t(str: string): Buffer {
  return Buffer.from(str + '\n', 'utf8')
}

function sep(char = '-'): Buffer {
  return t(char.repeat(LINE_WIDTH))
}

export type ReceiptItem = {
  snapshot_name: string
  quantity: number
  price: number
  is_free_gift?: boolean
}

export type ReceiptData = {
  sale_no: string
  created_at: string
  payment_label: string
  is_paid: boolean
  total: number
  discount_amount: number
  items: ReceiptItem[]
}

export function buildReceiptBuffer(data: ReceiptData): Buffer {
  const parts: Buffer[] = []

  // Taiwan time
  const dt = new Date(new Date(data.created_at).getTime() + 8 * 60 * 60 * 1000)
  const dateStr = `${dt.getUTCFullYear()}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${String(dt.getUTCDate()).padStart(2, '0')}`
  const timeStr = `${String(dt.getUTCHours()).padStart(2, '0')}:${String(dt.getUTCMinutes()).padStart(2, '0')}`

  const subtotal = data.total + data.discount_amount

  // ── Header ──────────────────────────────────────
  parts.push(CMD.INIT)
  parts.push(CMD.ALIGN_CENTER)
  parts.push(CMD.BOLD_ON)
  parts.push(t('瘋玩具Crazy Toys三重店'))
  parts.push(CMD.BOLD_OFF)
  parts.push(t('241新北市三重區自強路三段64號'))
  parts.push(t('0987 806 176'))
  parts.push(sep('='))

  // ── Sale info ────────────────────────────────────
  parts.push(CMD.ALIGN_LEFT)
  const rightInfo = `${dateStr} ${timeStr}`
  parts.push(t(padEnd(`單號: ${data.sale_no}`, LINE_WIDTH - strWidth(rightInfo)) + rightInfo))
  parts.push(sep('='))

  // ── Items ────────────────────────────────────────
  for (const item of data.items) {
    if (item.is_free_gift) continue

    const rightPart = `x${item.quantity}  $${(item.price * item.quantity).toLocaleString()}`
    const leftWidth = LINE_WIDTH - strWidth(rightPart) - 1
    const name = truncate(item.snapshot_name, leftWidth)
    parts.push(t(`${padEnd(name, leftWidth)} ${rightPart}`))

    // Show unit price if qty > 1
    if (item.quantity > 1) {
      const unitLine = `單價 $${item.price.toLocaleString()}`
      parts.push(t(padStart(unitLine, LINE_WIDTH)))
    }
  }

  parts.push(sep())

  // ── Totals ───────────────────────────────────────
  if (data.discount_amount > 0) {
    parts.push(t(padStart(`小計  $${subtotal.toLocaleString()}`, LINE_WIDTH)))
    parts.push(t(padStart(`折扣 -$${data.discount_amount.toLocaleString()}`, LINE_WIDTH)))
  }
  parts.push(CMD.BOLD_ON)
  parts.push(t(padStart(`合計  $${data.total.toLocaleString()}`, LINE_WIDTH)))
  parts.push(CMD.BOLD_OFF)
  parts.push(sep('='))

  // ── Payment ──────────────────────────────────────
  const payStatus = data.is_paid ? '' : '（待付款）'
  parts.push(t(`付款方式: ${data.payment_label}${payStatus}`))
  parts.push(sep('='))

  // ── Footer ───────────────────────────────────────
  parts.push(CMD.ALIGN_CENTER)
  parts.push(CMD.LF)
  parts.push(t('謝謝光臨！歡迎再次光臨'))
  parts.push(t('瘋玩具・玩具迷的天堂'))
  parts.push(CMD.LF)
  parts.push(sep('='))

  // Feed + cut
  parts.push(CMD.FEED)
  parts.push(CMD.CUT)

  return Buffer.concat(parts)
}
