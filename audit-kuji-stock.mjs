/**
 * 一番賞庫存稽核（唯讀）
 *
 * 用途：找出「已確認出貨、但 inventory_logs 沒有對應扣庫存紀錄」的品項。
 * 主要是修正前的 bug —— 自製套一番賞賞品結帳後庫存沒扣。
 *
 * ⚠️ 這支腳本只做 .select()，不會寫入任何資料。
 *
 * 用法：
 *   node audit-kuji-stock.mjs                 # 讀 .env.local（本專案唯一的環境檔）
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const envFile = process.argv[2] || '.env.local'

function loadEnv(path) {
  const env = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return env
}

const env = loadEnv(envFile)
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error(`${envFile} 缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY`)
  process.exit(1)
}

const db = createClient(url, key)
const PAGE = 1000
const CHUNK = 150

/** 分頁把整張表（或整個查詢）撈完，PostgREST 單次最多 1000 筆 */
async function fetchAll(build) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < PAGE) return rows
  }
}

function chunks(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

console.log(`=== 一番賞庫存稽核（唯讀）===`)
console.log(`環境檔：${envFile}`)
console.log(`資料庫：${url}\n`)

// 1. 所有已確認的出貨單
const deliveries = await fetchAll(() =>
  db.from('deliveries').select('id, delivery_no, sale_id, delivery_date').eq('status', 'confirmed')
)
console.log(`已確認出貨單：${deliveries.length} 張`)

const deliveryById = new Map(deliveries.map((d) => [d.id, d]))
const deliveryIds = deliveries.map((d) => d.id)

// 2. 出貨明細（目前值 —— 撤銷出貨/更正都會把數量改小）
const deliveryItems = []
for (const ids of chunks(deliveryIds, CHUNK)) {
  deliveryItems.push(
    ...(await fetchAll(() =>
      db.from('delivery_items').select('delivery_id, sale_item_id, product_id, quantity').in('delivery_id', ids)
    ))
  )
}
console.log(`出貨明細：${deliveryItems.length} 筆`)

// 3. 出貨相關的庫存日誌，算淨額
//    delivery = 扣庫存(負)、delivery_return = 撤銷出貨回補(正)、delivery_delete = 刪出貨單回補(正)
const logs = []
for (const ids of chunks(deliveryIds.map(String), CHUNK)) {
  logs.push(
    ...(await fetchAll(() =>
      db
        .from('inventory_logs')
        .select('ref_id, ref_type, product_id, qty_change')
        .in('ref_type', ['delivery', 'delivery_return', 'delivery_delete'])
        .in('ref_id', ids)
    ))
  )
}
console.log(`出貨相關庫存日誌：${logs.length} 筆\n`)

// 4. 判斷哪些明細是一番賞賞品
const saleItemIds = [...new Set(deliveryItems.map((di) => di.sale_item_id).filter(Boolean))]
const saleItems = []
for (const ids of chunks(saleItemIds, CHUNK)) {
  saleItems.push(
    ...(await fetchAll(() =>
      db.from('sale_items').select('id, sale_id, product_id, snapshot_name, ichiban_kuji_prize_id').in('id', ids)
    ))
  )
}
const saleItemById = new Map(saleItems.map((si) => [si.id, si]))

// 5. 逐 (出貨單, 商品) 比對：應扣多少 vs 日誌實際扣了多少
const expected = new Map() // `${deliveryId}|${productId}` -> { qty, kujiQty }
for (const di of deliveryItems) {
  if (!di.product_id) continue // 官方套賞品沒有商品，本來就不進庫存
  const k = `${di.delivery_id}|${di.product_id}`
  const cur = expected.get(k) || { qty: 0, kujiQty: 0 }
  cur.qty += di.quantity
  if (saleItemById.get(di.sale_item_id)?.ichiban_kuji_prize_id) cur.kujiQty += di.quantity
  expected.set(k, cur)
}

const logged = new Map() // `${deliveryId}|${productId}` -> 淨扣除量（正數）
for (const log of logs) {
  const k = `${log.ref_id}|${log.product_id}`
  logged.set(k, (logged.get(k) || 0) - log.qty_change)
}

const missing = [] // 應扣未扣（庫存偏多）
const over = [] // 扣超過（可能是更正/轉購物金另以 adjustment 回補，屬正常）
for (const [k, exp] of expected) {
  const [deliveryId, productId] = k.split('|')
  const diff = exp.qty - (logged.get(k) || 0)
  if (diff > 0) missing.push({ deliveryId, productId, qty: diff, kujiQty: exp.kujiQty })
  else if (diff < 0) over.push({ deliveryId, productId, qty: -diff })
}

// 6. 補上商品名稱與目前庫存
const productIds = [...new Set(missing.map((m) => m.productId))]
const products = []
for (const ids of chunks(productIds, CHUNK)) {
  products.push(...(await fetchAll(() => db.from('products').select('id, item_code, name, stock').in('id', ids))))
}
const productById = new Map(products.map((p) => [p.id, p]))

// 7. 依商品彙總
const byProduct = new Map()
for (const m of missing) {
  const cur = byProduct.get(m.productId) || { qty: 0, kujiQty: 0, deliveries: [] }
  cur.qty += m.qty
  cur.kujiQty += Math.min(m.qty, m.kujiQty)
  cur.deliveries.push({ ...m, delivery: deliveryById.get(m.deliveryId) })
  byProduct.set(m.productId, cur)
}

const rows = [...byProduct].sort((a, b) => b[1].qty - a[1].qty)

if (rows.length === 0) {
  console.log('✅ 沒有發現「應扣未扣」的庫存，不需要補正。')
} else {
  const totalQty = rows.reduce((s, [, v]) => s + v.qty, 0)
  const totalKuji = rows.reduce((s, [, v]) => s + v.kujiQty, 0)
  console.log(`⚠️  ${rows.length} 個商品的庫存偏多，合計應扣未扣 ${totalQty} 件（其中一番賞賞品 ${totalKuji} 件）\n`)
  console.log('貨號'.padEnd(16) + '商品'.padEnd(34) + '目前庫存'.padStart(8) + '應扣未扣'.padStart(10) + '修正後'.padStart(8) + '  一番賞')
  console.log('-'.repeat(92))
  for (const [productId, v] of rows) {
    const p = productById.get(productId)
    const name = (p?.name || productId).slice(0, 32)
    console.log(
      String(p?.item_code || '').padEnd(16) +
        name.padEnd(34) +
        String(p?.stock ?? '?').padStart(8) +
        String(-v.qty).padStart(10) +
        String((p?.stock ?? 0) - v.qty).padStart(8) +
        `  ${v.kujiQty}`
    )
  }

  console.log('\n--- 明細（出貨單）---')
  for (const [productId, v] of rows) {
    const p = productById.get(productId)
    console.log(`\n${p?.item_code || ''} ${p?.name || productId}`)
    for (const d of v.deliveries.sort((a, b) => (a.delivery?.delivery_date || '').localeCompare(b.delivery?.delivery_date || ''))) {
      console.log(
        `  ${d.delivery?.delivery_date || '?'}  ${d.delivery?.delivery_no || d.deliveryId}  x${d.qty}` +
          (d.kujiQty > 0 ? `（一番賞 ${d.kujiQty}）` : '')
      )
    }
  }
}

if (over.length > 0) {
  const overQty = over.reduce((s, o) => s + o.qty, 0)
  console.log(
    `\n（另有 ${over.length} 筆日誌扣除量大於目前出貨明細，合計 ${overQty} 件。` +
      `這通常是銷貨更正或轉購物金用 ref_type='adjustment' 另外回補過，不算異常，僅供對照。）`
  )
}
