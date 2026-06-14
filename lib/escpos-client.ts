// Browser-compatible ESC/POS builder using Uint8Array (no Node.js Buffer)
const LINE_WIDTH = 42

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

function cmd(...bytes: number[]): Uint8Array {
  return new Uint8Array(bytes)
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

function strWidth(str: string): number {
  let w = 0
  for (const char of str) {
    const code = char.codePointAt(0) || 0
    w += code >= 0x1100 && code <= 0xFFE6 ? 2 : 1
  }
  return w
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

const enc = new TextEncoder()

function t(str: string): Uint8Array {
  return enc.encode(str + '\n')
}

function sep(char = '-'): Uint8Array {
  return t(char.repeat(LINE_WIDTH))
}

export type ClientReceiptItem = {
  name: string
  quantity: number
  price: number
  isFreeGift?: boolean
}

export type ClientReceiptData = {
  sale_no: string
  payment_label: string
  is_paid: boolean
  total: number
  discount_amount: number
  items: ClientReceiptItem[]
}

export function buildClientReceiptBytes(data: ClientReceiptData): Uint8Array {
  const parts: Uint8Array[] = []

  const now = new Date()
  const tw = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const dateStr = `${tw.getUTCFullYear()}/${String(tw.getUTCMonth() + 1).padStart(2, '0')}/${String(tw.getUTCDate()).padStart(2, '0')}`
  const timeStr = `${String(tw.getUTCHours()).padStart(2, '0')}:${String(tw.getUTCMinutes()).padStart(2, '0')}`
  const subtotal = data.total + data.discount_amount

  parts.push(cmd(ESC, 0x40))           // INIT
  parts.push(cmd(ESC, 0x61, 0x01))     // ALIGN CENTER
  parts.push(cmd(ESC, 0x45, 0x01))     // BOLD ON
  parts.push(t('瘋玩具Crazy Toys三重店'))
  parts.push(cmd(ESC, 0x45, 0x00))     // BOLD OFF
  parts.push(t('241新北市三重區自強路三段64號'))
  parts.push(t('0987 806 176'))
  parts.push(sep('='))

  parts.push(cmd(ESC, 0x61, 0x00))     // ALIGN LEFT
  const rightInfo = `${dateStr} ${timeStr}`
  parts.push(t(padEnd(`單號: ${data.sale_no}`, LINE_WIDTH - strWidth(rightInfo)) + rightInfo))
  parts.push(sep('='))

  for (const item of data.items) {
    if (item.isFreeGift) continue
    const rightPart = `x${item.quantity}  $${(item.price * item.quantity).toLocaleString()}`
    const leftWidth = LINE_WIDTH - strWidth(rightPart) - 1
    const name = truncate(item.name, leftWidth)
    parts.push(t(`${padEnd(name, leftWidth)} ${rightPart}`))
    if (item.quantity > 1) {
      parts.push(t(padStart(`單價 $${item.price.toLocaleString()}`, LINE_WIDTH)))
    }
  }

  parts.push(sep())

  if (data.discount_amount > 0) {
    parts.push(t(padStart(`小計  $${subtotal.toLocaleString()}`, LINE_WIDTH)))
    parts.push(t(padStart(`折扣 -$${data.discount_amount.toLocaleString()}`, LINE_WIDTH)))
  }
  parts.push(cmd(ESC, 0x45, 0x01))     // BOLD ON
  parts.push(t(padStart(`合計  $${data.total.toLocaleString()}`, LINE_WIDTH)))
  parts.push(cmd(ESC, 0x45, 0x00))     // BOLD OFF
  parts.push(sep('='))

  const payStatus = data.is_paid ? '' : '（待付款）'
  parts.push(t(`付款方式: ${data.payment_label}${payStatus}`))
  parts.push(sep('='))

  parts.push(cmd(ESC, 0x61, 0x01))     // ALIGN CENTER
  parts.push(cmd(LF))
  parts.push(t('謝謝光臨！歡迎再次光臨'))
  parts.push(t('瘋玩具・玩具迷的天堂'))
  parts.push(cmd(LF))
  parts.push(sep('='))

  parts.push(cmd(ESC, 0x64, 0x04))     // FEED 4 lines
  parts.push(cmd(GS, 0x56, 0x41, 0x05)) // CUT

  return concat(...parts)
}
