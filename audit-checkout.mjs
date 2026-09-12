/**
 * 結帳帳務一致性稽核（唯讀）
 *
 * 用實際資料反查各種「應該永遠成立」的關係，找出結帳流程裡真的在發生的錯誤。
 *
 *   1. 金額組成：sale_items 小計 - 折扣 + 加價 - 購物金 == sales.total
 *   2. 未收款單：應收帳款(AR) 合計 == sales.total
 *   3. 購物金餘額：customers.store_credit == customer_balance_logs 累計
 *   4. 積分餘額：customers.loyalty_points == customer_points_logs 累計
 *   5. 出貨數量：已確認出貨量 + 轉購物金量 <= sale_items.quantity（不可超出）
 *   6. 庫存：products.stock == inventory_logs 累計
 *   7. 孤兒資料：sale_items / delivery_items / AR 指向不存在的母單
 *
 * ⚠️ 只做 .select()，不會寫入任何資料。
 *
 * 用法：node audit-checkout.mjs
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const envFile = process.argv[2] || '.env.local'
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
const eq = (a, b) => Math.abs(money(a) - money(b)) < 0.01
let issues = 0
const section = (t) => console.log(`\n--- ${t} ---`)

console.log('=== 結帳帳務一致性稽核（唯讀）===')
console.log(`環境檔：${envFile}\n資料庫：${env.NEXT_PUBLIC_SUPABASE_URL}`)

const sales = await all(() => db.from('sales').select('*'))
const saleItems = await all(() => db.from('sale_items').select('*'))
const saleById = new Map(sales.map((s) => [s.id, s]))
const itemsBySale = new Map()
for (const it of saleItems) {
  if (!itemsBySale.has(it.sale_id)) itemsBySale.set(it.sale_id, [])
  itemsBySale.get(it.sale_id).push(it)
}
console.log(`\n銷售單 ${sales.length} 張、明細 ${saleItems.length} 筆`)

// ---------- 1. 金額組成 ----------
section('1. 金額組成：明細小計 - 折扣 + 加價 - 購物金 == total')
// sales.subtotal 存的是「商品明細合計 + 整筆加價」，所以加價 = subtotal - 明細合計
// sales.subtotal 存的是「商品明細合計 + 整筆加價」，所以差額就是加價。
// 差到「分」等級的是組合價分攤除不盡（bug）；差到「元」等級的是真的有加價／新售價（正常）。
const amountBad = []   // total 算不出來 → 真的有問題
const centGap = []     // 分攤尾差 → bug
const surcharged = []  // 整筆加價 → 只列出來對照
for (const s of sales) {
  const items = itemsBySale.get(s.id) || []
  if (items.length === 0) continue
  const itemSum = items.reduce((a, i) => a + Number(i.subtotal ?? i.price * i.quantity), 0)
  const recorded = Number(s.subtotal ?? itemSum)
  const gap = money(recorded - itemSum)
  if (gap !== 0) {
    if (Math.abs(gap) < 1) centGap.push({ s, itemSum, recorded, gap })
    else surcharged.push({ s, itemSum, gap })
  }
  const surcharge = Math.max(0, gap)
  const expected = Math.max(0, itemSum - Number(s.discount_amount || 0)) + surcharge - Number(s.store_credit_used || 0)
  if (!eq(expected, s.total)) amountBad.push({ s, itemSum, surcharge, expected })
}
if (amountBad.length === 0 && centGap.length === 0) console.log('  ✅ 全部吻合')
if (centGap.length > 0) {
  issues += centGap.length
  console.log(`  ⚠️  ${centGap.length} 張單有「分」等級的分攤尾差（組合價除不盡，實收金額沒錯，但明細加總對不上小計）`)
  for (const { s, itemSum, recorded, gap } of centGap.slice(0, 10)) {
    console.log(`      ${s.sale_no} ${s.sale_date}  明細加總 ${money(itemSum)} vs 記錄小計 ${money(recorded)}（差 ${gap}）`)
  }
  if (centGap.length > 10) console.log(`      ...另外 ${centGap.length - 10} 張`)
}
if (amountBad.length > 0) {
  issues += amountBad.length
  console.log(`  ⚠️  ${amountBad.length} 張單的 total 算不出來：`)
  for (const { s, itemSum, surcharge, expected } of amountBad.slice(0, 15)) {
    console.log(`      ${s.sale_no} ${s.sale_date} ${s.source}  明細${money(itemSum)} 折扣${money(s.discount_amount)} 加價${surcharge} 購物金${money(s.store_credit_used)}` +
      ` → 應為 ${money(expected)}，實際 ${money(s.total)}（差 ${money(s.total - expected)}）`)
  }
}
if (surcharged.length > 0) {
  console.log(`  ℹ️  ${surcharged.length} 張單有整筆加價／新售價（正常，列出來對照）：`)
  for (const { s, itemSum, gap } of surcharged.slice(0, 10)) {
    console.log(`      ${s.sale_no} ${s.sale_date}  商品 ${money(itemSum)} + 加價 ${gap} = ${money(s.subtotal)}`)
  }
  if (surcharged.length > 10) console.log(`      ...另外 ${surcharged.length - 10} 張`)
}

// ---------- 2. 未收款單的應收帳款 ----------
section('2. 未收款單：應收帳款合計 == total')
const ar = await all(() => db.from('partner_accounts').select('*').eq('ref_type', 'sale').eq('direction', 'AR'))
const arBySale = new Map()
for (const a of ar) {
  if (!arBySale.has(a.ref_id)) arBySale.set(a.ref_id, [])
  arBySale.get(a.ref_id).push(a)
}
const arBad = []
for (const s of sales) {
  if (s.is_paid || s.status === 'store_credit') continue
  if (!s.customer_code) continue          // 沒客戶就不會建 AR，屬設計
  if (s.source === 'live') continue        // 直播不建 AR
  if (Number(s.total) === 0) continue
  const list = arBySale.get(s.id) || []
  const sum = list.reduce((a, x) => a + Number(x.amount), 0)
  if (!eq(sum, s.total)) arBad.push({ s, list, sum })
}
if (arBad.length === 0) console.log('  ✅ 全部吻合')
else {
  issues += arBad.length
  for (const { s, list, sum } of arBad.slice(0, 15)) {
    console.log(`  ⚠️  ${s.sale_no} ${s.sale_date} ${s.source} 客戶=${s.customer_code}  total=${money(s.total)} AR合計=${money(sum)}（${list.length} 筆）差=${money(s.total - sum)}`)
  }
  if (arBad.length > 15) console.log(`  ...另外 ${arBad.length - 15} 筆`)
}

// ---------- 3. 購物金餘額 ----------
section('3. 購物金：customers.store_credit == customer_balance_logs 累計')
const customers = await all(() => db.from('customers').select('customer_code, customer_name, store_credit, loyalty_points'))
const balLogs = await all(() => db.from('customer_balance_logs').select('customer_code, amount'))
const balSum = new Map()
for (const l of balLogs) balSum.set(l.customer_code, (balSum.get(l.customer_code) || 0) + Number(l.amount))
const scBad = customers.filter((c) => !eq(c.store_credit || 0, balSum.get(c.customer_code) || 0))
if (scBad.length === 0) console.log(`  ✅ ${customers.length} 位客戶全部吻合`)
else {
  issues += scBad.length
  for (const c of scBad.slice(0, 15)) {
    console.log(`  ⚠️  ${c.customer_code} ${c.customer_name}  餘額=${money(c.store_credit)} 日誌累計=${money(balSum.get(c.customer_code) || 0)}（差 ${money((c.store_credit || 0) - (balSum.get(c.customer_code) || 0))}）`)
  }
  if (scBad.length > 15) console.log(`  ...另外 ${scBad.length - 15} 位`)
}

// ---------- 4. 積分餘額 ----------
section('4. 積分：customers.loyalty_points == customer_points_logs 累計')
const ptLogs = await all(() => db.from('customer_points_logs').select('customer_code, amount'))
const ptSum = new Map()
for (const l of ptLogs) ptSum.set(l.customer_code, (ptSum.get(l.customer_code) || 0) + Number(l.amount))
const ptBad = customers.filter((c) => !eq(c.loyalty_points || 0, ptSum.get(c.customer_code) || 0))
if (ptLogs.length === 0) console.log('  （沒有任何積分日誌，略過）')
else if (ptBad.length === 0) console.log(`  ✅ ${customers.length} 位客戶全部吻合`)
else {
  issues += ptBad.length
  for (const c of ptBad.slice(0, 15)) {
    console.log(`  ⚠️  ${c.customer_code} ${c.customer_name}  積分=${c.loyalty_points} 日誌累計=${ptSum.get(c.customer_code) || 0}（差 ${(c.loyalty_points || 0) - (ptSum.get(c.customer_code) || 0)}）`)
  }
  if (ptBad.length > 15) console.log(`  ...另外 ${ptBad.length - 15} 位`)
}

// ---------- 5. 出貨數量不可超出訂購量 ----------
section('5. 出貨：已確認出貨量 + 轉購物金量 <= 訂購量')
const deliveries = await all(() => db.from('deliveries').select('id, sale_id, status, delivery_no'))
const confirmedIds = new Set(deliveries.filter((d) => d.status === 'confirmed').map((d) => d.id))
const deliveryItems = await all(() => db.from('delivery_items').select('delivery_id, sale_item_id, product_id, quantity'))
const deliveredByItem = new Map()
for (const di of deliveryItems) {
  if (!confirmedIds.has(di.delivery_id)) continue
  deliveredByItem.set(di.sale_item_id, (deliveredByItem.get(di.sale_item_id) || 0) + Number(di.quantity))
}
const overBad = []
for (const it of saleItems) {
  const delivered = deliveredByItem.get(it.id) || 0
  const sc = Number(it.store_credit_qty || 0)
  if (delivered + sc > Number(it.quantity) + 0.001) {
    overBad.push({ it, delivered, sc, sale: saleById.get(it.sale_id) })
  }
}
if (overBad.length === 0) console.log('  ✅ 沒有超出訂購量的品項')
else {
  issues += overBad.length
  for (const { it, delivered, sc, sale } of overBad.slice(0, 15)) {
    console.log(`  ⚠️  ${sale?.sale_no || it.sale_id} ${String(it.snapshot_name).slice(0, 24)}  訂購${it.quantity} 已出${delivered} 轉購物金${sc}（超出 ${delivered + sc - it.quantity}）`)
  }
  if (overBad.length > 15) console.log(`  ...另外 ${overBad.length - 15} 筆`)
}

// ---------- 6. 庫存 ----------
section('6. 庫存：products.stock == inventory_logs 累計')
const products = await all(() => db.from('products').select('id, item_code, name, stock'))
const invLogs = await all(() => db.from('inventory_logs').select('product_id, qty_change'))
const invSum = new Map()
for (const l of invLogs) invSum.set(l.product_id, (invSum.get(l.product_id) || 0) + Number(l.qty_change))
const stockBad = products.filter((p) => !eq(p.stock || 0, invSum.get(p.id) || 0))
if (stockBad.length === 0) console.log(`  ✅ ${products.length} 個商品全部吻合`)
else {
  issues += stockBad.length
  console.log(`  ⚠️  ${stockBad.length} 個商品的庫存與日誌累計不符（盤點調整 /adjust-stock 是直接改 stock 不寫日誌，屬已知）`)
  for (const p of stockBad.slice(0, 15)) {
    console.log(`      ${String(p.item_code).padEnd(8)} ${String(p.name).slice(0, 26).padEnd(28)} stock=${p.stock} 日誌=${invSum.get(p.id) || 0}`)
  }
  if (stockBad.length > 15) console.log(`      ...另外 ${stockBad.length - 15} 個`)
}

// ---------- 7. 孤兒資料 ----------
section('7. 孤兒資料')
const saleIdSet = new Set(sales.map((s) => s.id))
const itemIdSet = new Set(saleItems.map((i) => i.id))
const deliveryIdSet = new Set(deliveries.map((d) => d.id))
const orphanItems = saleItems.filter((i) => !saleIdSet.has(i.sale_id))
const orphanDeliveries = deliveries.filter((d) => !saleIdSet.has(d.sale_id))
const orphanDeliveryItems = deliveryItems.filter((di) => !deliveryIdSet.has(di.delivery_id) || (di.sale_item_id && !itemIdSet.has(di.sale_item_id)))
const orphanAr = ar.filter((a) => !saleIdSet.has(a.ref_id))
const rows = [
  ['sale_items 指向不存在的銷售單', orphanItems.length],
  ['deliveries 指向不存在的銷售單', orphanDeliveries.length],
  ['delivery_items 指向不存在的出貨單或明細', orphanDeliveryItems.length],
  ['應收帳款指向不存在的銷售單', orphanAr.length],
]
for (const [label, n] of rows) {
  console.log(`  ${n === 0 ? '✅' : '⚠️ '} ${label}：${n}`)
  if (n > 0) issues += n
}
if (orphanDeliveries.length > 0) {
  for (const d of orphanDeliveries.slice(0, 10)) console.log(`      出貨單 ${d.delivery_no} sale_id=${d.sale_id}`)
}
if (orphanAr.length > 0) {
  for (const a of orphanAr.slice(0, 10)) console.log(`      AR ${a.partner_code} $${a.amount} ref_id=${a.ref_id}`)
}

console.log('\n' + '='.repeat(64))
console.log(issues === 0 ? '✅ 全部一致，沒有發現結帳資料錯誤。' : `⚠️  共 ${issues} 筆不一致（明細見上）。`)
