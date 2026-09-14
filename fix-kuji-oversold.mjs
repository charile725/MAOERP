/**
 * 修正「賞項總數比已賣出抽數還少」的一番賞
 *
 * 成因：換掉沒中獎的商品時，舊賞項有銷售紀錄刪不掉，編輯頁的錯誤提示又叫人
 * 「把數量設為 0」，於是舊賞項被改成總數 0 或 1 —— 但它已經賣出幾十抽了。
 * 舊版編輯流程沒擋，結果「總數 1、已賣 59」：total_draws 少算、每抽成本被灌大。
 * 程式面已改成數量自動拉回已賣出的抽數，這支負責修歷史資料。
 *
 * 修法（跟新版編輯流程一致）：
 *   quantity = 已賣出抽數（以 sale_items 為準），remaining = 0（視為售完）
 *   再依整套賞項重算 total_draws / total_cost / avg_cost
 *
 * 用法：
 *   node fix-kuji-oversold.mjs            # dry-run
 *   node fix-kuji-oversold.mjs --apply    # 實際寫入
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
const money = (n) => Math.round(Number(n || 0) * 100) / 100

console.log(`=== 一番賞超賣賞項修正 ${apply ? '【實際寫入】' : '（dry-run，不寫入）'} ===`)
console.log(`環境檔：${envFile}\n資料庫：${env.NEXT_PUBLIC_SUPABASE_URL}\n`)

const kujis = await all(() => db.from('ichiban_kuji').select('id, name, set_type, is_active, total_draws, total_cost, avg_cost, last_prize_product_id'))
const kujiById = new Map(kujis.map((k) => [k.id, k]))
const prizes = await all(() => db.from('ichiban_kuji_prizes').select('id, kuji_id, prize_tier, product_id, quantity, remaining'))
const options = await all(() => db.from('ichiban_kuji_prize_options').select('prize_id, product_id'))
const saleItems = await all(() => db.from('sale_items').select('ichiban_kuji_prize_id, quantity').not('ichiban_kuji_prize_id', 'is', null))

const soldByPrize = new Map()
for (const s of saleItems) soldByPrize.set(s.ichiban_kuji_prize_id, (soldByPrize.get(s.ichiban_kuji_prize_id) || 0) + Number(s.quantity))

const oversold = prizes.filter((p) => (soldByPrize.get(p.id) || 0) > Number(p.quantity))
if (oversold.length === 0) { console.log('✅ 沒有超賣的賞項。'); process.exit(0) }

const optionsByPrize = new Map()
for (const o of options) {
  if (!optionsByPrize.has(o.prize_id)) optionsByPrize.set(o.prize_id, [])
  optionsByPrize.get(o.prize_id).push(o.product_id)
}
const costIds = [...new Set([
  ...prizes.map((p) => p.product_id).filter(Boolean),
  ...options.map((o) => o.product_id),
  ...kujis.map((k) => k.last_prize_product_id).filter(Boolean),
])]
const products = costIds.length ? await all(() => db.from('products').select('id, item_code, name, cost').in('id', costIds)) : []
const productById = new Map(products.map((p) => [p.id, p]))
const costOf = (id) => Number(productById.get(id)?.cost) || 0

const affectedKujiIds = [...new Set(oversold.map((p) => p.kuji_id))]
const plans = affectedKujiIds.map((kujiId) => {
  const k = kujiById.get(kujiId)
  const kujiPrizes = prizes.filter((p) => p.kuji_id === kujiId)
  const fixes = oversold.filter((p) => p.kuji_id === kujiId).map((p) => ({ p, sold: soldByPrize.get(p.id) || 0 }))
  const newQty = new Map(fixes.map((f) => [f.p.id, f.sold]))

  let draws = 0
  let cost = 0
  for (const p of kujiPrizes) {
    const q = newQty.has(p.id) ? newQty.get(p.id) : Number(p.quantity)
    draws += q
    if (k.set_type !== 'official') {
      const opts = optionsByPrize.get(p.id) || []
      const unit = opts.length > 0 ? opts.reduce((s, pid) => s + costOf(pid), 0) / opts.length : costOf(p.product_id)
      cost += unit * q
    }
  }
  if (k.set_type === 'official') cost = Number(k.total_cost) || 0
  else if (k.last_prize_product_id) cost += costOf(k.last_prize_product_id)

  return { k, fixes, totals: { draws, cost: money(cost), avg: money(draws > 0 ? cost / draws : 0) } }
})

for (const { k, fixes, totals } of plans) {
  console.log(`【${k.name}】${k.is_active ? '啟用' : '停用'}`)
  for (const { p, sold } of fixes) {
    const prod = productById.get(p.product_id)
    console.log(`  [${p.prize_tier}] ${prod ? `${prod.item_code} ${prod.name}` : ''}  總數 ${p.quantity} → ${sold}、剩餘 ${p.remaining} → 0（已賣 ${sold}，視為售完）`)
  }
  console.log(`  抽數     ${k.total_draws} → ${totals.draws}`)
  console.log(`  總成本   ${money(k.total_cost)} → ${totals.cost}`)
  console.log(`  每抽成本 ${money(k.avg_cost)} → ${totals.avg}\n`)
}

if (!apply) { console.log('(dry-run，沒有寫入任何資料。要實際執行請加 --apply)'); process.exit(0) }

console.log('寫入中...')
for (const { k, fixes, totals } of plans) {
  let failed = false
  for (const { p, sold } of fixes) {
    const { error } = await db.from('ichiban_kuji_prizes').update({ quantity: sold, remaining: 0 }).eq('id', p.id)
    if (error) { console.error(`  ❌ 【${k.name}】賞項 ${p.id}：${error.message}`); failed = true }
  }
  if (failed) continue
  const { error: kErr } = await db.from('ichiban_kuji').update({
    total_draws: totals.draws,
    total_cost: totals.cost,
    avg_cost: totals.avg,
  }).eq('id', k.id)
  if (kErr) { console.error(`  ⚠️  【${k.name}】賞項已修，但抽數／成本更新失敗：${kErr.message}`); continue }
  console.log(`  ✅ 【${k.name}】抽數=${totals.draws} 每抽成本=${totals.avg}`)
}

console.log('\n驗證：')
const prizes2 = await all(() => db.from('ichiban_kuji_prizes').select('id, quantity, remaining'))
const still = prizes2.filter((p) => (soldByPrize.get(p.id) || 0) > Number(p.quantity)).length
console.log(`  仍然超賣的賞項：${still} 筆`)
if (still === 0) console.log('  ✅ 修正完成。')
