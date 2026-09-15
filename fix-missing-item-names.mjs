/**
 * 補回銷售明細沒有品名（snapshot_name 為 null／空白）的資料
 *
 * 成因：結帳時批次查商品的那一次查詢沒有檢查錯誤。查失敗時 productMap 是空的，
 * 一番賞明細又不會走「商品不存在」的檢查，於是照樣結帳、品名寫成 null。
 * 程式面已改成查失敗就中止結帳、品名永遠有值，這支負責補歷史資料。
 *
 * 補法（跟結帳時的命名規則一致）：
 *   有實體商品的明細      → 商品名稱
 *   官方套（沒有商品）    → 「套組名稱 賞項名稱／賞別」
 *
 * ⚠️ 動到 sale_items 會觸發資料庫重算 sales.total（而且不扣折扣），
 *    跑完之後一定要接著跑 node fix-sale-total-discount.mjs --apply。
 *
 * 用法：
 *   node fix-missing-item-names.mjs            # dry-run
 *   node fix-missing-item-names.mjs --apply    # 實際寫入
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
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
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

console.log(`=== 補回銷售明細品名 ${apply ? '【實際寫入】' : '（dry-run，不寫入）'} ===`)
console.log(`環境檔：${envFile}\n資料庫：${env.NEXT_PUBLIC_SUPABASE_URL}\n`)

const items = await all(() => db.from('sale_items').select('id, sale_id, snapshot_name, product_id, ichiban_kuji_prize_id, ichiban_kuji_id'))
const missing = items.filter((i) => !i.snapshot_name || !String(i.snapshot_name).trim())
if (missing.length === 0) { console.log('✅ 沒有缺品名的明細。'); process.exit(0) }

const productIds = [...new Set(missing.map((i) => i.product_id).filter(Boolean))]
const prizeIds = [...new Set(missing.map((i) => i.ichiban_kuji_prize_id).filter(Boolean))]
const products = productIds.length ? await all(() => db.from('products').select('id, item_code, name').in('id', productIds)) : []
const prizes = prizeIds.length ? await all(() => db.from('ichiban_kuji_prizes').select('id, kuji_id, prize_tier, prize_name').in('id', prizeIds)) : []
const kujiIds = [...new Set([...prizes.map((p) => p.kuji_id), ...missing.map((i) => i.ichiban_kuji_id)].filter(Boolean))]
const kujis = kujiIds.length ? await all(() => db.from('ichiban_kuji').select('id, name').in('id', kujiIds)) : []
const saleIds = [...new Set(missing.map((i) => i.sale_id))]
const sales = await all(() => db.from('sales').select('id, sale_no, sale_date').in('id', saleIds))

const productById = new Map(products.map((p) => [p.id, p]))
const prizeById = new Map(prizes.map((p) => [p.id, p]))
const kujiById = new Map(kujis.map((k) => [k.id, k]))
const saleById = new Map(sales.map((s) => [s.id, s]))

const plans = []
const unresolved = []
for (const it of missing) {
  let name = null
  if (it.product_id && productById.has(it.product_id)) {
    name = productById.get(it.product_id).name
  } else if (it.ichiban_kuji_prize_id && prizeById.has(it.ichiban_kuji_prize_id)) {
    const prize = prizeById.get(it.ichiban_kuji_prize_id)
    const kuji = kujiById.get(it.ichiban_kuji_id || prize.kuji_id)
    name = [kuji?.name, prize.prize_name || prize.prize_tier].filter(Boolean).join(' ') || null
  }
  if (name) plans.push({ it, name })
  else unresolved.push(it)
}

const bySale = new Map()
for (const p of plans) {
  if (!bySale.has(p.it.sale_id)) bySale.set(p.it.sale_id, [])
  bySale.get(p.it.sale_id).push(p)
}
console.log(`缺品名 ${missing.length} 筆，可補 ${plans.length} 筆，查不到來源 ${unresolved.length} 筆\n`)
for (const [saleId, list] of bySale) {
  const s = saleById.get(saleId)
  const names = {}
  for (const p of list) names[p.name] = (names[p.name] || 0) + 1
  console.log(`  ${s?.sale_no} ${s?.sale_date}  ${list.length} 筆 → ${Object.entries(names).map(([n, c]) => `「${n}」×${c}`).join('、')}`)
}
if (unresolved.length > 0) {
  console.log('\n  查不到商品或賞項、無法補的：')
  for (const it of unresolved.slice(0, 10)) console.log(`    ${saleById.get(it.sale_id)?.sale_no} 明細 ${it.id}`)
}

if (!apply) { console.log('\n(dry-run，沒有寫入任何資料。要實際執行請加 --apply)'); process.exit(0) }

console.log('\n寫入中...')
let ok = 0
for (const { it, name } of plans) {
  const { error } = await db.from('sale_items').update({ snapshot_name: name }).eq('id', it.id)
  if (error) { console.error(`  ❌ ${it.id}：${error.message}`); continue }
  ok += 1
}
console.log(`  ✅ 補回 ${ok} / ${plans.length} 筆`)
console.log('\n⚠️  接著請執行：node fix-sale-total-discount.mjs --apply（還原被觸發器吃掉的折扣）')
