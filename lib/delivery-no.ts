import { supabaseServer } from './supabase/server'

/**
 * 取得目前最大的出貨單號數字。
 *
 * 走資料庫函式而不是查表，避免 Supabase 預設 1000 筆上限導致取到的不是真正的最大值。
 */
export async function getMaxDeliveryNumber(): Promise<number> {
  const { data, error } = await supabaseServer.rpc('get_max_delivery_number')

  if (error) {
    // 不要用 0 當備案。回 0 會讓編號從 D0001 重新開始，一路撞上既有單號，
    // 重試耗盡後才失敗，而且錯誤訊息變成「無法生成唯一單號」，掩蓋真正的原因。
    throw new Error(`無法取得出貨單號：${error.message}`)
  }

  return data || 0
}
