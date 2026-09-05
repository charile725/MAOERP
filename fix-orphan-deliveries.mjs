/**
 * 補建「有履約狀態、卻一張出貨單都沒有」的銷售單
 *
 * 成因：刪除銷售單時，回補一番賞賞品那段用 .single() 撈賞品，賞品被刪掉（整套一番賞刪除、
 * 或「開新套」換掉舊套組）就直接 return 500。中斷點在「刪出貨單」之後、「還原帳戶餘額」之前，
 * 所以出貨單被刪光、銷售單卻留著 → 銷貨紀錄顯示「待處理」，而且怎麼按刪除都會再爆同一個地方。
 * 程式面已修（.maybeSingle() + 跳過），這支負責把被誤刪的出貨單補回來。
 *
 * 判定：sales.fulfillment_status != 'none'（結帳時確實建過出貨單）但 deliveries 一筆都沒有。
 * 動作：重建 status='confirmed' 的出貨單 + 出貨明細 + inventory_logs（把當初沒扣掉的庫存扣掉）。
 * 寫入形狀與 /api/sales 結帳時完全相同（ref_type='delivery' + ref_id=出貨單ID），
 * 所以之後刪單／刪出貨單的回補邏輯會照常運作。補完再跑一次會顯示「沒有需要補建的」。
 *
 * 帳戶交易的缺漏由 fix-sale-account-tx.mjs 處理，這支不碰金流。
 *
 * 用法：
 *   node fix-orphan-deliveries.mjs            # dry-run，只列出要建什麼
 *   node fix-orphan-deliveries.mjs --apply    # 實際寫入
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const envFile = args.find((a) => !a.startsWith('--')) || '.env.local'

const env = {}
for (const l of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const t = l.trim(); if (!t || t.startsWith('#')) continue
  const i = t.indexOf('='); if (i < 0) continue
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error(`${envFile} 缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY`); process.exit(1) }

const db = createClient(url, key)
const PAGE = 1000
async function all(build) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < PAGE) return rows
  }
}

console.log(`=== 補建被誤刪的出貨單 ${apply ? '【實際寫入】' : '（dry-run，不寫入）'} ===`)
console.log(`環境檔：${envFile}\n資料庫：${url}\n`)

const sales = await all(() => db.from('sales').select('id, sale_no, sale_date, created_at, fulfillment_status, source, delivery_method'))
const deliveries = await all(() => db.from('deliveries').select('id, sale_id, delivery_no'))
const hasDelivery = new Set(deliveries.map((d) => d.sale_id))

const orphans = sales
  .filter((s) => s.fulfillment_status && s.fulfillment_status !== 'none' && !hasDelivery.has(s.id))
  .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))

if (orphans.length === 0) { console.log('✅ 沒有需要補建的出貨單。'); process.exit(0) }

const items = await all(() =>
  db.from('sale_items').select('id, sale_id, product_id, quantity, snapshot_name').in('sale_id', orphans.map((s) => s.id))
)
const itemsBySale = new Map()
for (const it of items) {
  if (!itemsBySale.has(it.sale_id)) itemsBySale.set(it.sale_id, [])
  itemsBySale.get(it.sale_id).push(it)
}

const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))]
const products = productIds.length ? await all(() => db.from('products').select('id, item_code, name, stock').in('id', productIds)) : []
const prodById = new Map(products.map((p) => [p.id, p]))

console.log(`⚠️  ${orphans.length} 筆銷售單有履約狀態卻沒有出貨單：\n`)
const stockDelta = new Map()
for (const s of orphans) {
  const its = itemsBySale.get(s.id) || []
  const stockIts = its.filter((i) => !!i.product_id)
  console.log(`  ${s.sale_no}  ${s.sale_date}  ${s.source}  fulfillment=${s.fulfillment_status}  明細 ${its.length} 筆（要扣庫存 ${stockIts.length} 筆）`)
  for (const i of stockIts) stockDelta.set(i.product_id, (stockDelta.get(i.product_id) || 0) + i.quantity)
}

if (stockDelta.size > 0) {
  console.log('\n補建後的庫存變化：')
  console.log('貨號'.padEnd(14) + '商品'.padEnd(34) + '目前'.padStart(9) + '扣'.padStart(6) + '修正後'.padStart(10))
  console.log('-'.repeat(73))
  for (const [pid, qty] of [...stockDelta].sort((a, b) => b[1] - a[1])) {
    const p = prodById.get(pid)
    console.log(
      String(p?.item_code || '').padEnd(14) +
      String(p?.name || pid).slice(0, 32).padEnd(34) +
      String(p?.stock ?? '?').padStart(9) +
      String(-qty).padStart(6) +
      String((p?.stock ?? 0) - qty).padStart(10)
    )
  }
}

if (!apply) { console.log('\n(dry-run，沒有寫入任何資料。要實際執行請加 --apply)'); process.exit(0) }

// 出貨單號取現有最大值 +1（不能用 count，刪過的紀錄會造成重複）
const nums = deliveries.map((d) => parseInt(String(d.delivery_no).replace(/\D/g, ''), 10)).filter((n) => !isNaN(n))
let next = (nums.length ? Math.max(...nums) : 0) + 1

console.log('\n寫入中...')
for (const s of orphans) {
  const its = itemsBySale.get(s.id) || []
  if (its.length === 0) { console.log(`  ⏭  ${s.sale_no} 沒有明細，跳過`); continue }

  const deliveryNo = `D${String(next).padStart(4, '0')}`
  next += 1

  const { data: delivery, error: dErr } = await db.from('deliveries').insert({
    sale_id: s.id,
    delivery_no: deliveryNo,
    status: 'confirmed',
    delivery_date: s.sale_date,
    method: s.delivery_method || null,
    note: '補建出貨單（原出貨單在刪除銷售單失敗時被誤刪）',
  }).select().single()

  if (dErr) { console.error(`  ❌ ${s.sale_no} 建出貨單失敗：${dErr.message}`); continue }

  const { error: diErr } = await db.from('delivery_items').insert(
    its.map((i) => ({ delivery_id: delivery.id, sale_item_id: i.id, product_id: i.product_id, quantity: i.quantity }))
  )
  if (diErr) {
    console.error(`  ❌ ${s.sale_no} 建出貨明細失敗：${diErr.message}，回滾出貨單`)
    await db.from('deliveries').delete().eq('id', delivery.id)
    continue
  }

  // 官方套一番賞的 product_id 是 null，不進庫存；只有 product_id 有值的才寫日誌
  const logs = its.filter((i) => !!i.product_id).map((i) => ({
    product_id: i.product_id,
    ref_type: 'delivery',
    ref_id: delivery.id,
    qty_change: -i.quantity,
    memo: `出貨扣庫存 - ${deliveryNo}（補建）`,
  }))
  if (logs.length > 0) {
    const { error: lErr } = await db.from('inventory_logs').insert(logs)
    if (lErr) console.error(`  ⚠️  ${s.sale_no} 庫存日誌寫入失敗：${lErr.message}（出貨單 ${deliveryNo} 已建立，需手動處理）`)
  }

  console.log(`  ✅ ${s.sale_no} → ${deliveryNo}，明細 ${its.length} 筆，庫存日誌 ${logs.length} 筆`)
}

console.log('\n驗證補建後的庫存：')
const afterProd = productIds.length ? await all(() => db.from('products').select('id, item_code, name, stock').in('id', productIds)) : []
for (const p of afterProd.sort((a, b) => (stockDelta.get(b.id) || 0) - (stockDelta.get(a.id) || 0))) {
  console.log(`  ${String(p.item_code).padEnd(10)} ${String(p.name).slice(0, 30).padEnd(32)} → ${p.stock}`)
}
console.log('\n✅ 完成。再跑一次這支腳本應該會顯示「沒有需要補建的出貨單」。')
