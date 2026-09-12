/**
 * 修正一番賞組合價的分攤尾差（歷史資料）
 *
 * 舊版 POS 的每抽單價是 combo.price / combo.draws，除不盡就被小數兩位截掉，
 * 例如 6 抽 1000 元 → 每抽 166.67，六筆明細加起來變成 1000.02。
 * sales.total（實收）是對的，只有明細小計的加總差幾分錢，毛利報表會固定偏差。
 * 程式面已改成以「分」為單位精確分攤，這支負責把既有的單補平。
 *
 * 作法：
 *   目標 = sales.subtotal（結帳當下記錄的「商品小計 + 整筆加價」）
 *   殘差 = 目標 - Σ(sale_items.price × quantity)
 *   把殘差以每筆 ±0.01 分給「單價不是整數分」的明細（也就是被組合價拆過的那些），
 *   一筆只調一分錢。sales 那張表完全不動，實收金額不變。
 *
 * ⚠️ 只改 sale_items.price（subtotal 是 generated column，會跟著重算）。
 *
 * 用法：
 *   node fix-combo-price-cents.mjs            # dry-run
 *   node fix-combo-price-cents.mjs --apply    # 實際寫入
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
const cents = (n) => Math.round(Number(n || 0) * 100)
/** 只修幾分錢的分攤尾差；再大就是加價／新售價，不是這支要處理的 */
const MAX_RESIDUAL_CENTS = 5

console.log(`=== 組合價分攤尾差修正 ${apply ? '【實際寫入】' : '（dry-run，不寫入）'} ===`)
console.log(`環境檔：${envFile}\n資料庫：${env.NEXT_PUBLIC_SUPABASE_URL}\n`)

const sales = await all(() => db.from('sales').select('id, sale_no, sale_date, source, subtotal, total'))
const items = await all(() => db.from('sale_items').select('id, sale_id, price, quantity, subtotal, snapshot_name, ichiban_kuji_id'))
const bySale = new Map()
for (const it of items) {
  if (!bySale.has(it.sale_id)) bySale.set(it.sale_id, [])
  bySale.get(it.sale_id).push(it)
}

const targets = []
for (const s of sales) {
  const list = bySale.get(s.id) || []
  if (list.length === 0) continue
  const sumCents = list.reduce((a, i) => a + cents(i.price) * Number(i.quantity), 0)
  const targetCents = cents(s.subtotal)
  const residual = targetCents - sumCents          // 正=要加回來，負=要扣掉
  if (residual === 0) continue
  // 只處理「分」等級的尾差。差到元以上的是整筆加價／新售價那類正常情況
  // （sales.subtotal 本來就存商品小計 + 加價），不是分攤誤差，不能亂調。
  if (Math.abs(residual) > MAX_RESIDUAL_CENTS) continue

  // 只調整「被組合價拆過」的明細：單價不是整數元，而且數量是 1
  const adjustable = list.filter((i) => Number(i.quantity) === 1 && cents(i.price) % 100 !== 0)
  targets.push({ s, list, sumCents, targetCents, residual, adjustable })
}

if (targets.length === 0) { console.log('✅ 沒有需要修正的單。'); process.exit(0) }

console.log(`${targets.length} 張單的明細加總與記錄的小計不符：\n`)
const doable = []
for (const t of targets) {
  const need = Math.abs(t.residual)
  const can = t.adjustable.length >= need
  console.log(`  ${t.s.sale_no} ${t.s.sale_date} ${t.s.source}  記錄小計=${(t.targetCents / 100).toFixed(2)} 明細加總=${(t.sumCents / 100).toFixed(2)} 殘差=${(t.residual / 100).toFixed(2)}` +
    `  可調整明細 ${t.adjustable.length} 筆 ${can ? '' : '← 不足，跳過'}`)
  if (can) doable.push(t)
}

console.log(`\n可修正 ${doable.length} 張，跳過 ${targets.length - doable.length} 張。`)
if (!apply) { console.log('\n(dry-run，沒有寫入任何資料。要實際執行請加 --apply)'); process.exit(0) }

console.log('\n寫入中...')
let done = 0
for (const t of doable) {
  const step = t.residual > 0 ? 1 : -1
  const n = Math.abs(t.residual)
  let failed = false
  for (let i = 0; i < n; i++) {
    const it = t.adjustable[i]
    const newPrice = (cents(it.price) + step) / 100
    const { error } = await db.from('sale_items').update({ price: newPrice }).eq('id', it.id)
    if (error) { console.error(`  ❌ ${t.s.sale_no} 明細 ${it.id}：${error.message}`); failed = true; break }
  }
  if (failed) continue
  done += 1
  console.log(`  ✅ ${t.s.sale_no}  調整 ${n} 筆明細各 ${step > 0 ? '+' : '-'}0.01`)
}

console.log(`\n完成 ${done} 張。驗證：`)
const items2 = await all(() => db.from('sale_items').select('sale_id, price, quantity'))
const bySale2 = new Map()
for (const it of items2) {
  if (!bySale2.has(it.sale_id)) bySale2.set(it.sale_id, [])
  bySale2.get(it.sale_id).push(it)
}
let still = 0
for (const s of sales) {
  const list = bySale2.get(s.id) || []
  if (list.length === 0) continue
  const sumCents = list.reduce((a, i) => a + cents(i.price) * Number(i.quantity), 0)
  const diff = cents(s.subtotal) - sumCents
  // 只看分攤尾差；元以上的差是整筆加價／新售價，本來就該存在
  if (diff !== 0 && Math.abs(diff) <= MAX_RESIDUAL_CENTS) still += 1
}
console.log(`  仍有分攤尾差的單：${still} 張`)
if (still === 0) console.log('  ✅ 已經沒有分攤尾差了。')
