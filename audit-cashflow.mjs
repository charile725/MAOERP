/**
 * 金流對帳稽核（唯讀）
 *
 * 檢查三件事：
 *   A. accounts.balance 是否等於該帳戶所有 account_transactions 的累計
 *   B. account_transactions 的 balance_before / balance_after 有沒有斷鏈
 *      （斷鏈＝有人繞過 updateAccountBalance 直接改餘額，或有並發覆寫）
 *   C. 每一張已存檔的日結，用現在的資料重算一次，跟當初存的快照比對
 *   D. 已收款但帳戶交易對不起來的銷售單
 *
 * ⚠️ 只做 .select()，不會寫入任何資料。
 *
 * 用法：node audit-cashflow.mjs
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
const money = (n) => (Math.round(Number(n) * 100) / 100)
const eq = (a, b) => Math.abs(money(a) - money(b)) < 0.01

console.log('=== 金流對帳稽核（唯讀）===')
console.log(`環境檔：${envFile}\n資料庫：${env.NEXT_PUBLIC_SUPABASE_URL}\n`)

const accounts = await all(() => db.from('accounts').select('id, account_name, balance, is_active').order('sort_order'))
const accById = new Map(accounts.map((a) => [a.id, a]))
const txns = await all(() => db.from('account_transactions').select('id, account_id, transaction_type, ref_type, ref_id, ref_no, amount, balance_before, balance_after, created_at, note'))

let problems = 0

// ---------- A. 帳戶餘額 vs 交易累計 ----------
console.log('--- A. 帳戶餘額 vs 交易累計 ---')
console.log('帳戶'.padEnd(16) + '目前餘額'.padStart(12) + '交易累計'.padStart(12) + '差額'.padStart(10) + '  筆數')
console.log('-'.repeat(60))
const txByAccount = new Map()
for (const t of txns) {
  if (!txByAccount.has(t.account_id)) txByAccount.set(t.account_id, [])
  txByAccount.get(t.account_id).push(t)
}
for (const a of accounts) {
  const list = (txByAccount.get(a.id) || []).sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))
  const sumDelta = list.reduce((s, t) => s + (Number(t.balance_after) - Number(t.balance_before)), 0)
  const diff = money(Number(a.balance) - sumDelta)
  if (!eq(diff, 0)) problems += 1
  console.log(
    String(a.account_name).padEnd(16) +
    String(money(a.balance)).padStart(12) +
    String(money(sumDelta)).padStart(12) +
    String(diff).padStart(10) +
    `  ${list.length}` + (eq(diff, 0) ? '' : '   ⚠️')
  )
}

// ---------- B. amount 與餘額變化是否一致 ----------
// 慣例：流入記正數、流出記負數。不一致代表 amount 的正負號寫錯，
// 餘額本身還是對的，但任何加總 amount 的報表都會算錯。
console.log('\n--- B. amount 與餘額變化是否一致 ---')
const signBad = txns.filter((t) => !eq(Number(t.balance_after) - Number(t.balance_before), t.amount))
if (signBad.length === 0) console.log('  ✅ 每筆交易的 amount 都等於餘額變化')
else {
  problems += signBad.length
  for (const t of signBad) {
    console.log(`  ⚠️  ${String(t.created_at).slice(0, 19)} ${accById.get(t.account_id)?.account_name} ${t.transaction_type} ${t.ref_no || t.ref_id}` +
      `  amount=${money(t.amount)} 但餘額變化=${money(Number(t.balance_after) - Number(t.balance_before))}`)
  }
}

// ---------- B2. 餘額鏈連續性（參考用）----------
// 刪銷售單／改費用時，程式是直接刪掉舊交易而不是寫反向沖銷，
// 被抽掉那幾筆之後的每一筆，balance_before 就接不上前一筆的結餘。
// 只要 A 的差額是 0，錢就沒有少，這裡的斷點是刪除留下的洞。
console.log('\n--- B2. 餘額鏈連續性（參考用，斷點 = 有交易被刪過）---')
let chainBreaks = 0
for (const a of accounts) {
  const list = (txByAccount.get(a.id) || []).sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))
  let prev = null
  for (const t of list) {
    if (prev !== null && !eq(prev, t.balance_before)) chainBreaks += 1
    prev = Number(t.balance_after)
  }
}
console.log(chainBreaks === 0 ? '  ✅ 完全連續' : `  ℹ️  ${chainBreaks} 處斷點（A 已確認餘額正確，屬於刪除交易留下的洞，不是掉錢）`)

// ---------- C. 日結快照 vs 重算 ----------
console.log('\n--- C. 已存檔的日結 vs 用現在資料重算 ---')
const closings = await all(() => db.from('business_day_closings').select('*').order('business_date'))
const sales = await all(() => db.from('sales').select('id, sale_no, sale_date, source, total, is_paid, account_id, status'))
const saleTx = txns.filter((t) => t.ref_type === 'sale' && t.transaction_type === 'sale')
const saleTxBySale = new Map()
for (const t of saleTx) {
  if (!saleTxBySale.has(t.ref_id)) saleTxBySale.set(t.ref_id, [])
  saleTxBySale.get(t.ref_id).push(t)
}

let closingProblems = 0
for (const c of closings) {
  const daySales = sales.filter((s) => s.sale_date === c.business_date && s.source === c.source)
  const paid = daySales.filter((s) => s.is_paid).reduce((sum, s) => sum + Number(s.total), 0)
  const byAcct = {}
  const covered = new Set()
  for (const s of daySales) {
    for (const t of saleTxBySale.get(s.id) || []) {
      byAcct[t.account_id] = (byAcct[t.account_id] || 0) + Number(t.amount)
      covered.add(s.id)
    }
  }
  for (const s of daySales) {
    if (s.is_paid && s.account_id && !covered.has(s.id)) byAcct[s.account_id] = (byAcct[s.account_id] || 0) + Number(s.total)
  }
  const tracked = Object.values(byAcct).reduce((a, b) => a + b, 0)
  const gap = money(paid - tracked)

  const snap = c.sales_by_account || {}
  const snapSum = Object.values(snap).reduce((a, b) => a + Number(b), 0)
  const okPaid = eq(paid, c.paid_sales)
  const okSplit = eq(snapSum, Number(c.paid_sales))

  if (!okPaid || !okSplit || gap > 0.01) {
    closingProblems += 1
    console.log(`\n  ⚠️  ${c.business_date} ${c.source}`)
    console.log(`      快照 paid_sales=${money(c.paid_sales)}  分帳合計=${money(snapSum)}` + (okSplit ? '' : '  ← 快照本身就不平'))
    console.log(`      重算 paid_sales=${money(paid)}  分帳合計=${money(tracked)}  未入帳=${gap > 0 ? gap : 0}`)
    const keys = new Set([...Object.keys(snap), ...Object.keys(byAcct)])
    for (const k of keys) {
      const name = k === '__untracked__' ? '（其他未入帳）' : (accById.get(k)?.account_name || k)
      const s0 = money(snap[k] || 0), s1 = money(byAcct[k] || 0)
      if (!eq(s0, s1)) console.log(`        ${String(name).padEnd(14)} 快照 ${String(s0).padStart(9)}  →  重算 ${String(s1).padStart(9)}`)
    }
  }
}
if (closingProblems === 0) console.log(`  ✅ ${closings.length} 張日結全部與重算結果一致`)
else { console.log(`\n  ${closings.length} 張日結中有 ${closingProblems} 張對不上`); problems += closingProblems }

// ---------- D. 已收款但交易對不起來的銷售單 ----------
console.log('\n--- D. 已收款但帳戶交易對不起來的銷售單 ---')
const badSales = []
for (const s of sales) {
  if (!s.is_paid || s.status === 'store_credit' || Number(s.total) === 0) continue
  const list = saleTxBySale.get(s.id) || []
  const sum = list.reduce((a, t) => a + Number(t.amount), 0)
  if (!eq(sum, s.total)) badSales.push({ s, list, sum })
}
if (badSales.length === 0) console.log('  ✅ 每張已收款銷售單的帳戶交易都等於 total')
else {
  problems += badSales.length
  for (const { s, list, sum } of badSales.sort((a, b) => a.s.sale_date.localeCompare(b.s.sale_date))) {
    console.log(`  ⚠️  ${s.sale_no} ${s.sale_date} ${s.source}  total=${money(s.total)} 交易合計=${money(sum)} 差=${money(s.total - sum)}` +
      `  [${list.map((t) => `${accById.get(t.account_id)?.account_name}:${t.amount}`).join(' + ') || '無交易'}]` +
      (s.account_id ? `  sales.account_id=${accById.get(s.account_id)?.account_name}` : '  無 account_id'))
  }
}

console.log('\n' + '='.repeat(60))
console.log(problems === 0 ? '✅ 日結與金流完全對齊，沒有發現問題。' : `⚠️  共發現 ${problems} 個對不上的地方（明細見上）。`)
