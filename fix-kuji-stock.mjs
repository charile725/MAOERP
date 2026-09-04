/**
 * 一番賞庫存補正
 *
 * 把「已確認出貨、但 inventory_logs 沒有對應扣庫存紀錄」的數量補寫回去。
 * 稽核邏輯與 audit-kuji-stock.mjs 相同，這支會實際寫入。
 *
 * 補寫的日誌刻意用 ref_type='delivery' + ref_id=出貨單ID，跟正常扣庫存
 * 完全同形，好處有兩個：
 *   1. 之後刪單／刪出貨單的回補邏輯會自動把它算進去，不會漏補。
 *   2. 補完再跑一次稽核就會歸零 → 這支腳本可以重複執行不會重複扣。
 *
 * 用法：
 *   node fix-kuji-stock.mjs                    # dry-run，只列出要寫什麼
 *   node fix-kuji-stock.mjs --apply            # 實際寫入 .env.local
 *   node fix-kuji-stock.mjs .env.old.local --apply
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const envFile = args.find((a) => !a.startsWith('--')) || '.env.local'

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

console.log(`=== 一番賞庫存補正 ${apply ? '【實際寫入】' : '（dry-run，不寫入）'} ===`)
console.log(`環境檔：${envFile}`)
console.log(`資料庫：${url}\n`)

const deliveries = await fetchAll(() =>
  db.from('deliveries').select('id, delivery_no, sale_id, delivery_date').eq('status', 'confirmed')
)
const deliveryById = new Map(deliveries.map((d) => [d.id, d]))
const deliveryIds = deliveries.map((d) => d.id)

const deliveryItems = []
for (const ids of chunks(deliveryIds, CHUNK)) {
  deliveryItems.push(
    ...(await fetchAll(() =>
      db.from('delivery_items').select('delivery_id, sale_item_id, product_id, quantity').in('delivery_id', ids)
    ))
  )
}

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

const saleItemIds = [...new Set(deliveryItems.map((di) => di.sale_item_id).filter(Boolean))]
const saleItems = []
for (const ids of chunks(saleItemIds, CHUNK)) {
  saleItems.push(
    ...(await fetchAll(() => db.from('sale_items').select('id, ichiban_kuji_prize_id').in('id', ids)))
  )
}
const saleItemById = new Map(saleItems.map((si) => [si.id, si]))

const expected = new Map()
for (const di of deliveryItems) {
  if (!di.product_id) continue
  const k = `${di.delivery_id}|${di.product_id}`
  const cur = expected.get(k) || { qty: 0, kujiQty: 0 }
  cur.qty += di.quantity
  if (saleItemById.get(di.sale_item_id)?.ichiban_kuji_prize_id) cur.kujiQty += di.quantity
  expected.set(k, cur)
}

const logged = new Map()
for (const log of logs) {
  const k = `${log.ref_id}|${log.product_id}`
  logged.set(k, (logged.get(k) || 0) - log.qty_change)
}

const missing = []
for (const [k, exp] of expected) {
  const [deliveryId, productId] = k.split('|')
  const diff = exp.qty - (logged.get(k) || 0)
  if (diff > 0) missing.push({ deliveryId, productId, qty: diff, kujiQty: exp.kujiQty })
}

if (missing.length === 0) {
  console.log('✅ 沒有需要補正的庫存。')
  process.exit(0)
}

const productIds = [...new Set(missing.map((m) => m.productId))]
const products = []
for (const ids of chunks(productIds, CHUNK)) {
  products.push(...(await fetchAll(() => db.from('products').select('id, item_code, name, stock').in('id', ids))))
}
const productById = new Map(products.map((p) => [p.id, p]))

const rowsToInsert = missing.map((m) => ({
  product_id: m.productId,
  ref_type: 'delivery',
  ref_id: m.deliveryId,
  qty_change: -m.qty,
  memo: `補扣一番賞庫存（修正遺漏）- ${deliveryById.get(m.deliveryId)?.delivery_no || m.deliveryId}`,
}))

const byProduct = new Map()
for (const m of missing) byProduct.set(m.productId, (byProduct.get(m.productId) || 0) + m.qty)

console.log(`要補寫 ${rowsToInsert.length} 筆庫存日誌，涉及 ${byProduct.size} 個商品：\n`)
console.log('貨號'.padEnd(16) + '商品'.padEnd(34) + '目前庫存'.padStart(12) + '補扣'.padStart(8) + '補後'.padStart(12))
console.log('-'.repeat(84))
for (const [productId, qty] of [...byProduct].sort((a, b) => b[1] - a[1])) {
  const p = productById.get(productId)
  console.log(
    String(p?.item_code || '').padEnd(16) +
      String(p?.name || productId).slice(0, 32).padEnd(34) +
      String(p?.stock ?? '?').padStart(12) +
      String(-qty).padStart(8) +
      String((p?.stock ?? 0) - qty).padStart(12)
  )
}

if (!apply) {
  console.log('\n(dry-run，沒有寫入任何資料。要實際執行請加 --apply)')
  process.exit(0)
}

console.log('\n寫入中...')
let written = 0
for (const batch of chunks(rowsToInsert, 100)) {
  const { error } = await db.from('inventory_logs').insert(batch)
  if (error) {
    console.error(`❌ 批次寫入失敗（已寫入 ${written} 筆）：${error.message}`)
    process.exit(1)
  }
  written += batch.length
  console.log(`  已寫入 ${written}/${rowsToInsert.length}`)
}

console.log('\n驗證補正後的庫存：')
const after = []
for (const ids of chunks(productIds, CHUNK)) {
  after.push(...(await fetchAll(() => db.from('products').select('id, item_code, name, stock').in('id', ids))))
}
for (const p of after.sort((a, b) => (byProduct.get(b.id) || 0) - (byProduct.get(a.id) || 0))) {
  console.log(`  ${String(p.item_code).padEnd(10)} ${String(p.name).slice(0, 30).padEnd(32)} → ${p.stock}`)
}
console.log('\n✅ 完成。再跑一次 audit-kuji-stock.mjs 應該會顯示沒有差異。')
