/**
 * 已收款但沒進帳戶的銷售單稽核（唯讀）
 *
 * 找出「is_paid=true、有 account_id、total>0，卻沒有任何 ref_type='sale' 帳戶交易」的單。
 * 成因見 PATCH /api/sales/[id]：結帳時 payment_method='pending' 不寫帳戶交易，
 * 之後改成現金／LINE Pay 時舊版程式又因為找不到舊交易而整段跳過。
 *
 * ⚠️ 這支腳本只做 .select()，不會寫入任何資料。
 *
 * 用法：node audit-sale-account-tx.mjs
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
async function all(b) { const r = []; for (let f = 0; ; f += PAGE) { const { data, error } = await b().range(f, f + PAGE - 1); if (error) throw new Error(error.message); r.push(...(data || [])); if (!data || data.length < PAGE) return r } }

console.log(`環境檔：${envFile}\n資料庫：${env.NEXT_PUBLIC_SUPABASE_URL}\n`)

const sales = await all(() => db.from('sales').select('id, sale_no, sale_date, created_at, status, total, is_paid, account_id, payment_method, source'))
const tx = await all(() => db.from('account_transactions').select('ref_id').eq('ref_type', 'sale'))
const has = new Set(tx.map(t => t.ref_id))
const accounts = await all(() => db.from('accounts').select('id, account_name, payment_method_code, balance'))
const acc = new Map(accounts.map(a => [a.id, a]))

const bad = sales.filter(s =>
  s.is_paid && s.account_id && Number(s.total) > 0 &&
  s.status !== 'store_credit' && !has.has(s.id)
)

if (bad.length === 0) { console.log('✅ 沒有「已收款卻沒進帳戶」的銷售單。'); process.exit(0) }

console.log(`⚠️  ${bad.length} 筆已收款但沒有帳戶交易，合計 $${bad.reduce((a, s) => a + Number(s.total), 0)}\n`)
console.log('單號'.padEnd(10) + '日期'.padEnd(13) + '金額'.padStart(9) + '  付款'.padEnd(12) + '帳戶')
console.log('-'.repeat(70))
for (const s of bad.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
  console.log(
    String(s.sale_no).padEnd(10) + String(s.sale_date).padEnd(13) +
    String(s.total).padStart(9) + '  ' + String(s.payment_method).padEnd(10) +
    (acc.get(s.account_id)?.account_name || s.account_id)
  )
}
console.log('\n受影響帳戶目前餘額：')
for (const id of new Set(bad.map(s => s.account_id))) {
  const a = acc.get(id)
  const short = bad.filter(s => s.account_id === id).reduce((x, s) => x + Number(s.total), 0)
  console.log(`  ${a?.account_name || id}: ${a?.balance}  （少了 ${short}）`)
}
