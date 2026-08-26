import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateCode(prefix: string, count: number): string {
  const num = (count + 1).toString().padStart(4, '0')
  return `${prefix}${num}`
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    minimumFractionDigits: 0,
  }).format(amount)
}

export function formatDate(date: string | Date): string {
  // 以資料庫為原則：直接解析字串，不做時區轉換
  if (typeof date === 'string') {
    // 嘗試從字串中直接提取日期部分
    // 格式：2024-01-15 或 2024-01-15T14:30:00.000Z
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (match) {
      const [, year, month, day] = match
      return `${year}-${month}-${day}`
    }
  }

  // 如果不是字串或無法解析，回退到 Date 對象處理
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatDateTime(date: string | Date): string {
  // 以資料庫為原則：直接解析 ISO 字串，不做時區轉換
  if (typeof date === 'string') {
    // 嘗試從 ISO 字串中直接提取日期時間部分
    // 格式：2024-01-15T14:30:00.000Z 或 2024-01-15T14:30:00+08:00
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
    if (match) {
      const [, year, month, day, hours, minutes] = match
      return `${year}-${month}-${day} ${hours}:${minutes}`
    }
  }

  // 如果不是字串或無法解析，回退到 Date 對象處理
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

export function formatPaymentMethod(method: string): string {
  const methodMap: Record<string, string> = {
    'cash': '現金',
    'card': '刷卡',
    'transfer_cathay': '轉帳 - 國泰',
    'transfer_cathay_biz': '轉帳 - 國泰公司',
    'transfer_fubon': '轉帳 - 富邦',
    'transfer_esun': '轉帳 - 玉山',
    'transfer_union': '轉帳 - 聯邦',
    'transfer_linepay': '轉帳 - LINE Pay',
    'transfer_linebank': '轉帳 - Line Bank',
    'transfer_post': '轉帳 - 郵局',
    'transfer_sunny': '轉帳 - 陽信',
    'transfer_ctbc': '轉帳 - 中國信託',
    'cod': '貨到付款',
    'pending': '待確定',
    'store_credit': '購物金',
    // 兼容舊的 'transfer' 值
    'transfer': '轉帳',
  }
  return methodMap[method] || method
}
