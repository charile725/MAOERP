/**
 * 一番賞「第N套」名稱後綴的處理，前端兩個地方共用（一番賞庫、官方賞進貨紀錄）。
 *
 * 真正採用的名字由後端 app/api/ichiban-kuji/[id]/reopen/route.ts 決定，
 * 這裡只是給「開新套」輸入框一個預設值，兩邊的規則要一致。
 *
 * 括號是選擇性的：手動開的套常常直接打「戰鬥陀螺 第2套」，
 * 不認這種寫法的話下一套會變成「戰鬥陀螺 第2套 (第2套)」。
 */
export const SET_SUFFIX = /\s*[（(]?\s*第\s*(\d+)\s*套\s*[)）]?\s*$/

export function stripSetSuffix(name: string): string {
  return (name || '').replace(SET_SUFFIX, '').trim()
}

/** 同名套組裡目前最大的套號 + 1；沒有後綴的視為第 1 套 */
export function nextSetName(sourceName: string, existingNames: string[]): string {
  const base = stripSetSuffix(sourceName)

  let maxSet = 0
  for (const name of existingNames) {
    const trimmed = (name || '').trim()
    if (stripSetSuffix(trimmed) !== base) continue
    const matched = trimmed.match(SET_SUFFIX)
    maxSet = Math.max(maxSet, matched ? parseInt(matched[1], 10) : 1)
  }

  return `${base} (第${maxSet + 1}套)`
}

/**
 * 問後端拿全部套組的名字再算下一套的名稱。
 * 要看「全部」套組才知道現在到第幾套，所以不能只看畫面上那一頁。
 */
export async function fetchNextSetName(sourceName: string): Promise<string> {
  try {
    const res = await fetch('/api/ichiban-kuji?all=true')
    const data = await res.json()
    const names: string[] = (data?.data || []).map((k: any) => k.name)
    return nextSetName(sourceName, names)
  } catch {
    return `${stripSetSuffix(sourceName)} (第2套)`
  }
}
