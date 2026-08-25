/**
 * PostgREST 篩選字串工具
 *
 * `.or()` 的參數是一整串以逗號分隔、以括號分組的條件式。關鍵字若直接內插，
 * 使用者只要打到 `,` 或 `)` 就會破壞語法：
 *
 *   關鍵字 "盲盒,小新"  → 500 failed to parse logic tree
 *   關鍵字 "盲盒)"      → 條件被提早截斷，安靜地回傳錯誤結果
 *
 * PostgREST 允許把值用雙引號包起來，引號內的分隔字元就只是普通字元。
 */

/** 把值包成 PostgREST 的引號字串，並轉義內部的反斜線與雙引號 */
export function quoteFilterValue(value: string): string {
  const escaped = String(value)
    .split('\\').join('\\\\')
    .split('"').join('\\"')
  return `"${escaped}"`
}

/**
 * 產生「任一欄位模糊符合關鍵字」的 or() 條件字串。
 *
 * @example
 *   query.or(ilikeAny(['name', 'item_code'], keyword))
 */
export function ilikeAny(fields: string[], keyword: string): string {
  const pattern = quoteFilterValue(`%${keyword}%`)
  return fields.map(field => `${field}.ilike.${pattern}`).join(',')
}
