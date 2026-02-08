/**
 * 統一時區處理工具
 *
 * ToyFlow ERP 系統使用台灣時間 (UTC+8)
 * 本模組提供統一的時間處理函數，確保所有時間記錄一致
 */

/**
 * 取得當前台灣時間 (UTC+8)
 * 
 * 注意：資料庫使用 timestamptz 類型，會自動處理時區轉換
 * 我們只需要傳入當前時間（ISO 格式），PostgreSQL 會正確存儲
 * 
 * @returns ISO 格式的當前時間字串
 */
export function getTaiwanTime(): string {
  return new Date().toISOString()
}

/**
 * 取得當前台灣時間的 Date 物件
 * @returns Date 物件（台灣時間）
 */
export function getTaiwanDate(): Date {
  const now = new Date()
  return new Date(now.getTime() + 8 * 60 * 60 * 1000)
}

/**
 * 將 UTC 時間轉換為台灣時間
 * @param utcDate - UTC 時間（Date 物件或 ISO 字串）
 * @returns ISO 格式的台灣時間字串
 */
export function utcToTaiwan(utcDate: Date | string): string {
  const date = typeof utcDate === 'string' ? new Date(utcDate) : utcDate
  const taiwanTime = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return taiwanTime.toISOString()
}

/**
 * 取得台灣時間的日期部分 (YYYY-MM-DD)
 * @param date - 可選的日期，不提供則使用當前時間
 * @returns YYYY-MM-DD 格式的日期字串
 */
export function getTaiwanDateString(date?: Date): string {
  const taiwanDate = date
    ? new Date(date.getTime() + 8 * 60 * 60 * 1000)
    : getTaiwanDate()

  return taiwanDate.toISOString().split('T')[0]
}

/**
 * 取得台灣時間的當天起始時間 (00:00:00)
 * @param date - 可選的日期，不提供則使用當前日期
 * @returns ISO 格式的台灣時間字串
 */
export function getTaiwanDayStart(date?: Date): string {
  const dateStr = getTaiwanDateString(date)
  return `${dateStr}T00:00:00.000Z`
}

/**
 * 取得台灣時間的當天結束時間 (23:59:59.999)
 * @param date - 可選的日期，不提供則使用當前日期
 * @returns ISO 格式的台灣時間字串
 */
export function getTaiwanDayEnd(date?: Date): string {
  const dateStr = getTaiwanDateString(date)
  return `${dateStr}T23:59:59.999Z`
}

/**
 * 格式化台灣時間為可讀格式
 * @param date - Date 物件或 ISO 字串
 * @param includeTime - 是否包含時間部分（預設 true）
 * @returns 格式化的時間字串 (YYYY-MM-DD HH:mm:ss 或 YYYY-MM-DD)
 */
export function formatTaiwanTime(date: Date | string, includeTime: boolean = true): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const taiwanDate = new Date(d.getTime() + 8 * 60 * 60 * 1000)

  const year = taiwanDate.getUTCFullYear()
  const month = String(taiwanDate.getUTCMonth() + 1).padStart(2, '0')
  const day = String(taiwanDate.getUTCDate()).padStart(2, '0')

  if (!includeTime) {
    return `${year}-${month}-${day}`
  }

  const hours = String(taiwanDate.getUTCHours()).padStart(2, '0')
  const minutes = String(taiwanDate.getUTCMinutes()).padStart(2, '0')
  const seconds = String(taiwanDate.getUTCSeconds()).padStart(2, '0')

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}
