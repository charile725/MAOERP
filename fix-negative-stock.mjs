/**
 * 把負庫存全部歸零
 *
 * 負庫存的成因都是「賣掉的比帳上有的多」——期初盤點數字填少了，或進貨沒建單。
 * 這支不去追成因，單純把每個負庫存商品補到 0。
 *
 * 作法是寫 inventory_logs（ref_type='adjustment'、qty_change = -目前庫存），
 * 讓 DB trigger 去更新 products.stock。刻意不直接 UPDATE products.stock：
 * 走日誌的話，不管 trigger 是「累加」還是「重算總和」，結果都會是 0，而且
 * 日誌累計與 products.stock 會保持一致，之後對帳看得出這筆是人為調整。
 *
 * 冪等：補完之後庫存就不是負數了，再跑一次會顯示「沒有負庫存」。
 *
 * 用法：
 *   node fix-negative-stock.mjs            # dry-run，只列出要調整什麼
 *   node fix-negative-stock.mjs --apply    # 實際寫入
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
function chunks(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

console.log(`=== 負庫存歸零 ${apply ? '【實際寫入】' : '（dry-run，不寫入）'} ===`)
console.log(`環境檔：${envFile}\n資料庫：${url}\n`)

const negatives = (await all(() => db.from('products').select('id, item_code, name, stock').lt('stock', 0)))
  .sort((a, b) => Number(a.stock) - Number(b.stock))

if (negatives.length === 0) { console.log('✅ 沒有負庫存的商品。'); process.exit(0) }

const totalFix = negatives.reduce((sum, p) => sum + -Number(p.stock), 0)
console.log(`${negatives.length} 個商品庫存為負，合計要補 ${totalFix} 件：\n`)
console.log('貨號'.padEnd(12) + '商品'.padEnd(36) + '目前'.padStart(8) + '補'.padStart(7) + '調整後'.padStart(9))
console.log('-'.repeat(72))
for (const p of negatives) {
  console.log(
    String(p.item_code || '').padEnd(12) +
    String(p.name || p.id).slice(0, 34).padEnd(36) +
    String(p.stock).padStart(8) +
    `+${-Number(p.stock)}`.padStart(7) +
    '0'.padStart(9)
  )
}

if (!apply) { console.log('\n(dry-run，沒有寫入任何資料。要實際執行請加 --apply)'); process.exit(0) }

const rows = negatives.map((p) => ({
  product_id: p.id,
  ref_type: 'adjustment',
  ref_id: null,
  qty_change: -Number(p.stock),
  memo: `負庫存歸零調整（原庫存 ${p.stock}）`,
}))

console.log('\n寫入中...')
let written = 0
for (const batch of chunks(rows, 100)) {
  const { error } = await db.from('inventory_logs').insert(batch)
  if (error) { console.error(`❌ 寫入失敗（已寫入 ${written} 筆）：${error.message}`); process.exit(1) }
  written += batch.length
  console.log(`  已寫入 ${written}/${rows.length}`)
}

console.log('\n驗證：')
const after = await all(() => db.from('products').select('id, item_code, name, stock').in('id', negatives.map((p) => p.id)))
let bad = 0
for (const p of after) {
  const ok = Number(p.stock) === 0
  if (!ok) bad += 1
  console.log(`  ${ok ? '✅' : '❌'} ${String(p.item_code).padEnd(10)} ${String(p.name).slice(0, 30).padEnd(32)} → ${p.stock}`)
}
const stillNeg = await all(() => db.from('products').select('id').lt('stock', 0))
console.log(`\n目前仍有負庫存的商品：${stillNeg.length} 個`)
if (bad > 0) { console.error('⚠️  有商品沒有歸零，請檢查 inventory_logs 的 trigger 行為。'); process.exit(1) }
console.log('✅ 完成。')
