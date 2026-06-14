import iconv from 'iconv-lite'

const LINE_WIDTH = 42

// ESC/POS commands
const ESC = 0x1b
const GS  = 0x1d
const FS  = 0x1c
const LF  = 0x0a

export const CMD = {
  INIT:         Buffer.from([ESC, 0x40]),
  CHINESE_ON:   Buffer.from([FS,  0x26]),          // FS & — 啟用中文模式（GB2312）
  ALIGN_LEFT:   Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_CENTER: Buffer.from([ESC, 0x61, 0x01]),
  BOLD_ON:      Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF:     Buffer.from([ESC, 0x45, 0x00]),
  // GS ! n — 字體倍率：bits 0-2 = 高(0=1x,1=2x…)  bits 4-6 = 寬
  FONT_NORMAL:  Buffer.from([GS,  0x21, 0x00]),    // 1x 1x
  FONT_DOUBLE_H:Buffer.from([GS,  0x21, 0x01]),    // 1x 寬  2x 高
  FONT_DOUBLE_W:Buffer.from([GS,  0x21, 0x10]),    // 2x 寬  1x 高
  FONT_DOUBLE:  Buffer.from([GS,  0x21, 0x11]),    // 2x 寬  2x 高（大字）
  FEED:         Buffer.from([ESC, 0x64, 0x04]),
  CUT:          Buffer.from([GS,  0x56, 0x41, 0x05]),
  LF:           Buffer.from([LF]),
}

// ── Layout constants ────────────────────────────────────────────────────────
// Item table: [seq:2] [name:24] [qty:4] [amt:10]  → total 42 (with 2 separators)
const SEQ_W  = 2
const NAME_W = 24
const QTY_W  = 4
const AMT_W  = 10
// Totals: [label:27] [qty:4] [amt:10]  → total 42 (with 1 separator)
const LABEL_W = LINE_WIDTH - 1 - QTY_W - 1 - AMT_W   // 26 — rows with qty+amt
const LABEL1_W = LINE_WIDTH - 1 - AMT_W               // 31 — rows with amt only

// ── Helpers ─────────────────────────────────────────────────────────────────

// CJK chars = 2 print columns; ASCII = 1
function strWidth(str: string): number {
  let w = 0
  for (const ch of str) {
    const cp = ch.codePointAt(0) || 0
    w += cp >= 0x1100 && cp <= 0xFFE6 ? 2 : 1
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
  let w = 0, result = ''
  for (const ch of str) {
    const cw = (ch.codePointAt(0) || 0) >= 0x1100 ? 2 : 1
    if (w + cw > maxWidth - 1) { result += '.'; break }
    result += ch; w += cw
  }
  return result
}

// Encode as GBK (superset of GB2312) — required for Chinese thermal printers
function t(str: string): Buffer {
  return iconv.encode(str + '\n', 'gbk')
}

function sep(char = '-'): Buffer {
  return t(char.repeat(LINE_WIDTH))
}

// [label padEnd LABEL_W] [qty padStart QTY_W] [amt padStart AMT_W]
function rowQtyAmt(label: string, qty: number | string, amt: number | string): Buffer {
  return t(
    padEnd(label, LABEL_W) + ' ' +
    padStart(String(qty), QTY_W) + ' ' +
    padStart(String(amt), AMT_W)
  )
}

// [label padEnd LABEL1_W] [amt padStart AMT_W]
function rowAmt(label: string, amt: number | string): Buffer {
  return t(padEnd(label, LABEL1_W) + ' ' + padStart(String(amt), AMT_W))
}

// Extract numeric part from sale_no (e.g. "S000123" → "123")
function seqNo(saleNo: string): string {
  const m = saleNo.match(/\d+/)
  return m ? String(parseInt(m[0], 10)) : saleNo
}

// ── Receipt layout shared by both TCP and Serial paths ───────────────────────

function buildBody(parts: Buffer[], opts: {
  sale_no: string
  dateStr: string
  timeStr: string
  items: { name: string; quantity: number; price: number; isFreeGift?: boolean }[]
  total: number
  discount_amount: number
  payment_label: string
  is_paid: boolean
  received?: number
  change?: number
}) {
  const { sale_no, dateStr, timeStr, items, total, discount_amount,
          payment_label, is_paid, received, change } = opts
  const subtotal = total + discount_amount
  const seq = seqNo(sale_no)

  // ── 全域大字：高度 x2，寬度不變 → 欄位對齊完全不受影響 ──
  parts.push(CMD.INIT)
  parts.push(CMD.CHINESE_ON)
  parts.push(CMD.ALIGN_LEFT)
  parts.push(CMD.BOLD_ON)
  parts.push(t('瘋玩具Crazy Toys三重店'))
  parts.push(CMD.BOLD_OFF)
  parts.push(sep('='))

  // ── Info block ────────────────────────────────
  parts.push(CMD.ALIGN_LEFT)
  const receipt = '<< 銷貨憑單 >>'
  parts.push(t(padEnd('門市: 瘋玩具三重店', LINE_WIDTH - strWidth(receipt)) + receipt))
  const seqLabel = `序號: ${seq}`
  parts.push(t(padEnd(`單號: ${sale_no}`, LINE_WIDTH - strWidth(seqLabel)) + seqLabel))
  const timeLabel = `時間: ${timeStr}`
  parts.push(t(padEnd(`日期: ${dateStr}`, LINE_WIDTH - strWidth(timeLabel)) + timeLabel))
  parts.push(sep('='))

  // ── Column header ─────────────────────────────
  const hdr =
    padEnd('序', SEQ_W) + ' ' +
    padEnd('商品名稱', NAME_W) + ' ' +
    padStart('數量', QTY_W) + ' ' +
    padStart('金額', AMT_W)
  parts.push(t(hdr))
  parts.push(sep('-'))

  // ── Items ─────────────────────────────────────
  let idx = 0
  for (const item of items) {
    if (item.isFreeGift) continue
    idx++
    const seq2 = padStart(String(idx), SEQ_W)
    const name = truncate(item.name, NAME_W)
    const qty  = padStart(String(item.quantity), QTY_W)
    const amt  = padStart(String(Math.round(item.price * item.quantity)), AMT_W)
    parts.push(t(`${seq2} ${padEnd(name, NAME_W)} ${qty} ${amt}`))
    if (item.quantity > 1) {
      parts.push(t(padStart(`單價 ${item.price}`, LINE_WIDTH)))
    }
  }

  parts.push(sep('-'))

  // ── Totals ────────────────────────────────────
  const totalQty = items.filter(i => !i.isFreeGift).reduce((s, i) => s + i.quantity, 0)
  parts.push(rowQtyAmt('小計:', totalQty, Math.round(subtotal)))
  parts.push(rowAmt('折扣項金額:', discount_amount > 0 ? `-${Math.round(discount_amount)}` : '0'))
  parts.push(CMD.BOLD_ON)
  parts.push(rowAmt('實收金額:', Math.round(total)))
  parts.push(CMD.BOLD_OFF)
  parts.push(sep('='))

  // ── Payment ───────────────────────────────────
  const payStatus = is_paid ? '' : '  (待付款)'
  parts.push(rowAmt(`${payment_label}:${payStatus}`, is_paid ? Math.round(received ?? total) : 0))
  if (change !== undefined && change > 0) {
    parts.push(rowAmt('找零:', Math.round(change)))
  }
  parts.push(sep('='))

  parts.push(CMD.FEED)
  parts.push(CMD.CUT)
}

// ── TCP path (server → network printer) ─────────────────────────────────────

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
  const dt = new Date(new Date(data.created_at).getTime() + 8 * 60 * 60 * 1000)
  const dateStr = `${dt.getUTCFullYear()}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${String(dt.getUTCDate()).padStart(2, '0')}`
  const timeStr = `${String(dt.getUTCHours()).padStart(2, '0')}:${String(dt.getUTCMinutes()).padStart(2, '0')}`

  buildBody(parts, {
    sale_no: data.sale_no,
    dateStr,
    timeStr,
    items: data.items.map(i => ({ name: i.snapshot_name, quantity: i.quantity, price: i.price, isFreeGift: i.is_free_gift })),
    total: data.total,
    discount_amount: data.discount_amount,
    payment_label: data.payment_label,
    is_paid: data.is_paid,
  })

  return Buffer.concat(parts)
}

// ── Serial path (browser → Web Serial → USB/BT printer) ─────────────────────

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
  received?: number   // 實收現金（現金付款時顯示找零用）
  change?: number     // 找零
  items: ClientReceiptItem[]
}

export function buildClientReceiptBuffer(data: ClientReceiptData): Buffer {
  const parts: Buffer[] = []
  const now = new Date()
  const tw = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const dateStr = `${tw.getUTCFullYear()}/${String(tw.getUTCMonth() + 1).padStart(2, '0')}/${String(tw.getUTCDate()).padStart(2, '0')}`
  const timeStr = `${String(tw.getUTCHours()).padStart(2, '0')}:${String(tw.getUTCMinutes()).padStart(2, '0')}`

  buildBody(parts, { ...data, dateStr, timeStr })

  return Buffer.concat(parts)
}
