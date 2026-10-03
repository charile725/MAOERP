/**
 * 統一時區處理工具（系統以台灣時間 UTC+8 運作）
 *
 * ⚠️ 資料庫有兩種時間欄位，各有各的正確寫法，混用會差 8 小時：
 *
 *   1. timestamptz（帶時區）
 *      例：business_day_closings.closing_time、account_transactions.created_at
 *      → 存「真實 UTC 瞬間」，用 getTaiwanTime()
 *
 *   2. timestamp（不帶時區）
 *      例：sales.created_at、deliveries.created_at
 *      → 慣例是存「台灣牆上時間」，用 getTaiwanWallClock()
 *        台灣的瀏覽器讀回來會當成當地時間解析，顯示才會正確
 *
 *   2b. timestamp（不帶時區）但實際存的是真 UTC —— 例外，要特別小心
 *      例：inventory_logs.created_at、products.created_at
 *      → 因為沒有任何程式碼指定 created_at，吃的是資料庫預設 now()（UTC）。
 *        欄位型別跟第 2 類一樣，但內容是 UTC，直接顯示會少 8 小時。
 *        讀出來要顯示時用 parseDbUtc() / formatDbUtcAsTaiwan()，
 *        千萬不要用 parseTaiwanWallClock()（那會把 UTC 當成台灣時間）。
 *
 *   3. date（日期）
 *      例：sales.sale_date、deliveries.delivery_date、partner_accounts.due_date
 *      → 用 getTaiwanDateString()
 *
 * 不要再在各檔案裡自己寫 `+ 8 * 60 * 60 * 1000`，一律走這裡。
 */

const TAIWAN_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * 現在這一刻的真實 UTC 時間，給 timestamptz 欄位用。
 * @returns ISO 字串，例如 2026-08-25T15:59:09.105Z
 */
export function getTaiwanTime(): string {
  return new Date().toISOString()
}

/**
 * 現在的台灣牆上時間，給不帶時區的 timestamp 欄位用。
 * 字串尾端仍帶 Z，但 PostgreSQL 寫入 timestamp 欄位時會忽略它。
 * @returns ISO 字串，例如 2026-08-25T23:59:09.105Z（代表台灣時間 23:59）
 */
export function getTaiwanWallClock(): string {
  return new Date(Date.now() + TAIWAN_OFFSET_MS).toISOString()
}

/**
 * 取得偏移成台灣時間的 Date 物件。
 * 只適合用來取日期／時分秒的「數字」，不要直接當成時間點存進資料庫。
 */
export function getTaiwanDate(): Date {
  return new Date(Date.now() + TAIWAN_OFFSET_MS)
}

/**
 * 取得台灣時間的日期部分，給 date 欄位用。
 * @param date 可選；不給則用現在時間
 * @returns YYYY-MM-DD
 */
export function getTaiwanDateString(date?: Date): string {
  const taiwanDate = date ? new Date(date.getTime() + TAIWAN_OFFSET_MS) : getTaiwanDate()
  return taiwanDate.toISOString().split('T')[0]
}

/**
 * 解析時間欄位並回傳「可以直接用 getUTC* 取出台灣時間數字」的 Date。
 *
 * 兩種欄位都能正確處理：
 *   - 不帶時區（例如 sales.created_at "2026-08-25T23:05:31.142"）
 *     裡面存的已經是台灣牆上時間，當 UTC 解析即可。
 *   - 帶時區（例如 "2026-08-25T15:05:31Z"）是真實瞬間，再換算到台灣時間。
 *
 * 直接 `new Date(不帶時區的字串)` 會依「執行環境的當地時區」解讀，
 * 在 Vercel（UTC）與本機（台灣）結果不同，是很容易踩到的坑。
 */
export function parseTaiwanWallClock(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(value.getTime() + TAIWAN_OFFSET_MS)
  }

  const text = String(value)
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(text)

  return hasTimezone
    ? new Date(new Date(text).getTime() + TAIWAN_OFFSET_MS)
    : new Date(text + 'Z')
}

/**
 * 解析「不帶時區、但內容是真 UTC」的欄位，回傳可以用 getUTC* 取出台灣時間數字的 Date。
 *
 * 適用對象是沒有被程式碼指定過 created_at、直接吃資料庫預設 now() 的欄位，
 * 目前已知有 inventory_logs.created_at 與 products.created_at。
 * 這類欄位用 parseTaiwanWallClock() 會把 UTC 當成台灣時間，顯示就少 8 小時。
 */
export function parseDbUtc(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(value.getTime() + TAIWAN_OFFSET_MS)
  }

  const text = String(value)
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(text)
  const utcMs = hasTimezone ? new Date(text).getTime() : new Date(text + 'Z').getTime()

  return new Date(utcMs + TAIWAN_OFFSET_MS)
}

/** 把「不帶時區但內容是真 UTC」的欄位格式化成台灣時間 YYYY-MM-DD HH:mm */
export function formatDbUtcAsTaiwan(value: string | Date | null | undefined): string {
  if (!value) return '-'
  const d = parseDbUtc(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** 把「真 UTC」的時間欄位格式化成台灣日期 YYYY-MM-DD（不帶時間） */
export function formatDbUtcDate(value: string | Date | null | undefined): string {
  if (!value) return '-'
  const d = parseDbUtc(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
