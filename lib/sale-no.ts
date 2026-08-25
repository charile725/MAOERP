import { generateCode } from './utils'

/**
 * 銷售單號產生
 *
 * ⚠️ 不要用 `sales` 的總筆數來產生單號 —— 只要刪過任何一筆，筆數就會倒退，
 * 下一張單直接撞到既有單號。一律以「現有最大編號 +1」為準，並在撞號時重試。
 *
 * 這裡只放純計算，查詢由呼叫端自己發（結帳流程會把它併進 Promise.all 平行送出）。
 */

type SaleNoRow = { sale_no?: string | null }

/** 從一批銷售單中取出最大的數字編號 */
export function maxSaleNumber(rows: SaleNoRow[] | null | undefined): number {
  return (rows || []).reduce((max: number, row) => {
    const match = String(row?.sale_no || '').match(/\d+/)
    if (!match) return max
    const num = parseInt(match[0], 10)
    return num > max ? num : max
  }, 0)
}

/** 依據一批既有單號算出下一個可用單號 */
export function nextSaleNoFrom(rows: SaleNoRow[] | null | undefined): string {
  return generateCode('S', maxSaleNumber(rows))
}

/** 撞號時往上遞增一號 */
export function bumpSaleNo(saleNo: string): string {
  const match = saleNo.match(/\d+/)
  return generateCode('S', match ? parseInt(match[0], 10) : 0)
}

/** 取最近的單號樣本，交給 nextSaleNoFrom 計算（Supabase 預設 1000 筆上限，取 100 筆足夠） */
export const RECENT_SALE_NO_LIMIT = 100
