/**
 * 補上「盤點調整沒寫庫存日誌」留下的缺口
 *
 * 舊版 /api/products/[id]/adjust-stock 是直接 UPDATE products.stock，沒有寫 inventory_logs，
 * 所以那些商品的 stock 跟日誌累計永遠對不起來，庫存異動紀錄也看不到這筆調整。
 * 程式面已改成寫日誌讓 trigger 更新，這支負責補歷史資料。
 *
 * 作法（每個商品）：
 *   目前庫存 S、日誌累計 L、缺口 delta = S - L
 *   1. 寫一筆 ref_type='adjustment'、qty_change = delta 的日誌
 *   2. 讀回 stock；trigger 若是「累加」會變成 S + delta，這時把 stock 改回 S
 *      （trigger 若是「重算總和」則已經正好是 S，不用動）
 *   結束後 stock == 日誌累計 == 原本的 S，庫存數字完全沒變，只是補上軌跡。
 *
 * 冪等：補完 delta 就是 0，再跑一次會顯示沒有缺口。
 *
 * 用法：
 *   node fix-stock-ledger-gap.mjs            # dry-run
 *   node fix-stock-ledger-gap.mjs --apply    # 實際寫入
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
if (!url || !key) { console.error(`${envFile} 缺少必要環境變數`); process.exit(1) }

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

console.log(`=== 補庫存日誌缺口 ${apply ? '【實際寫入】' : '（dry-run，不寫入）'} ===`)
console.log(`環境檔：${envFile}\n資料庫：${url}\n`)

const products = await all(() => db.from('products').select('id, item_code, name, stock'))
const logs = await all(() => db.from('inventory_logs').select('product_id, qty_change'))
const sum = new Map()
for (const l of logs) sum.set(l.product_id, (sum.get(l.product_id) || 0) + Number(l.qty_change))

const gaps = products
  .map((p) => ({ p, stock: Number(p.stock || 0), logged: sum.get(p.id) || 0 }))
  .filter((x) => x.stock !== x.logged)
  .map((x) => ({ ...x, delta: x.stock - x.logged }))
  .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

if (gaps.length === 0) { console.log('✅ 沒有缺口，所有商品的庫存都等於日誌累計。'); process.exit(0) }

console.log(`${gaps.length} 個商品的庫存與日誌累計不符（庫存數字不會變，只補軌跡）：\n`)
console.log('貨號'.padEnd(10) + '商品'.padEnd(32) + '目前庫存'.padStart(9) + '日誌累計'.padStart(9) + '要補日誌'.padStart(10))
console.log('-'.repeat(72))
for (const g of gaps) {
  console.log(
    String(g.p.item_code || '').padEnd(10) +
    String(g.p.name || g.p.id).slice(0, 30).padEnd(32) +
    String(g.stock).padStart(9) +
    String(g.logged).padStart(9) +
    (g.delta > 0 ? `+${g.delta}` : String(g.delta)).padStart(10)
  )
}

if (!apply) { console.log('\n(dry-run，沒有寫入任何資料。要實際執行請加 --apply)'); process.exit(0) }

console.log('\n寫入中...')
let ok = 0, failed = 0
for (const g of gaps) {
  const { error: logErr } = await db.from('inventory_logs').insert({
    product_id: g.p.id,
    ref_type: 'adjustment',
    ref_id: null,
    qty_change: g.delta,
    memo: `補記歷史盤點調整（舊版盤點沒寫庫存日誌，庫存數字不變）`,
  })
  if (logErr) { console.error(`  ❌ ${g.p.item_code}：日誌寫入失敗 ${logErr.message}`); failed += 1; continue }

  // trigger 若是累加，stock 會變成 S + delta，要改回原本的 S
  const { data: after, error: readErr } = await db.from('products').select('stock').eq('id', g.p.id).single()
  if (readErr) { console.error(`  ❌ ${g.p.item_code}：讀回庫存失敗 ${readErr.message}`); failed += 1; continue }

  if (Number(after.stock) !== g.stock) {
    const { error: fixErr } = await db.from('products').update({ stock: g.stock }).eq('id', g.p.id)
    if (fixErr) { console.error(`  ❌ ${g.p.item_code}：庫存還原失敗 ${fixErr.message}`); failed += 1; continue }
  }
  ok += 1
  console.log(`  ✅ ${String(g.p.item_code).padEnd(8)} ${String(g.p.name).slice(0, 26).padEnd(28)} 庫存維持 ${g.stock}，日誌補 ${g.delta > 0 ? '+' : ''}${g.delta}`)
}

console.log(`\n完成 ${ok} 個，失敗 ${failed} 個。驗證：`)
const products2 = await all(() => db.from('products').select('id, item_code, name, stock'))
const logs2 = await all(() => db.from('inventory_logs').select('product_id, qty_change'))
const sum2 = new Map()
for (const l of logs2) sum2.set(l.product_id, (sum2.get(l.product_id) || 0) + Number(l.qty_change))
const still = products2.filter((p) => Number(p.stock || 0) !== (sum2.get(p.id) || 0))
console.log(`  仍有缺口的商品：${still.length} 個`)
for (const p of still.slice(0, 10)) console.log(`    ${p.item_code} stock=${p.stock} 日誌=${sum2.get(p.id) || 0}`)
if (still.length === 0) console.log('  ✅ 全部商品的庫存都等於日誌累計了。')
