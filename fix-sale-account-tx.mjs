/**
 * 補記「已收款卻沒進帳戶」的銷售單
 *
 * 對象：audit-sale-account-tx.mjs 找出來的單（is_paid=true、有 account_id、total>0、
 * status 不是 store_credit，卻沒有任何 ref_type='sale' 的 account_transactions）。
 *
 * 寫入的資料刻意跟 lib/account-service.ts 的 updateAccountBalance 完全同形
 * （transaction_type='sale' / ref_type='sale' / ref_id=銷售單ID），好處是：
 *   1. 之後刪除銷售單時，DELETE 的 3.1 節會照常反向沖銷，不會多也不會少。
 *   2. 重複執行不會重複補（有交易就不在清單裡了）。
 *
 * 用法：
 *   node fix-sale-account-tx.mjs            # dry-run，只列出要寫什麼
 *   node fix-sale-account-tx.mjs --apply    # 實際寫入
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
if (!url || !key) {
  console.error(`${envFile} 缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY`)
  process.exit(1)
}

const db = createClient(url, key)
const PAGE = 1000
async function all(b) {
  const r = []
  for (let f = 0; ; f += PAGE) {
    const { data, error } = await b().range(f, f + PAGE - 1)
    if (error) throw new Error(error.message)
    r.push(...(data || []))
    if (!data || data.length < PAGE) return r
  }
}

/** lib/timezone.ts 的 getTaiwanTime()：台灣牆鐘時間 */
function taiwanTime() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace('Z', '+00:00')
}

console.log(`=== 補記帳戶交易 ${apply ? '【實際寫入】' : '（dry-run，不寫入）'} ===`)
console.log(`環境檔：${envFile}\n資料庫：${url}\n`)

const sales = await all(() =>
  db.from('sales').select('id, sale_no, sale_date, created_at, status, total, is_paid, account_id, payment_method')
)
const tx = await all(() => db.from('account_transactions').select('ref_id').eq('ref_type', 'sale'))
const has = new Set(tx.map((t) => t.ref_id))
const accounts = await all(() => db.from('accounts').select('id, account_name, balance, is_active'))
const acc = new Map(accounts.map((a) => [a.id, a]))

const bad = sales
  .filter((s) => s.is_paid && s.account_id && Number(s.total) > 0 && s.status !== 'store_credit' && !has.has(s.id))
  .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))

if (bad.length === 0) {
  console.log('✅ 沒有需要補記的銷售單。')
  process.exit(0)
}

// 依帳戶依序累加，模擬一筆一筆入帳的 balance_before / balance_after
const running = new Map()
const plan = []
for (const s of bad) {
  const a = acc.get(s.account_id)
  if (!a) { console.warn(`⚠️  ${s.sale_no} 的帳戶 ${s.account_id} 不存在，略過`); continue }
  const before = running.has(a.id) ? running.get(a.id) : Number(a.balance) || 0
  const after = before + Number(s.total)
  running.set(a.id, after)
  plan.push({ sale: s, account: a, before, after })
}

console.log(`要補記 ${plan.length} 筆帳戶交易：\n`)
console.log('單號'.padEnd(10) + '日期'.padEnd(13) + '金額'.padStart(9) + '  帳戶'.padEnd(12) + '餘額變化')
console.log('-'.repeat(72))
for (const p of plan) {
  console.log(
    String(p.sale.sale_no).padEnd(10) + String(p.sale.sale_date).padEnd(13) +
    String(p.sale.total).padStart(9) + '  ' + String(p.account.account_name).padEnd(10) +
    `${p.before} → ${p.after}`
  )
}

if (!apply) {
  console.log('\n(dry-run，沒有寫入任何資料。要實際執行請加 --apply)')
  process.exit(0)
}

console.log('\n寫入中...')
for (const p of plan) {
  const { error: txError } = await db.from('account_transactions').insert({
    account_id: p.account.id,
    transaction_type: 'sale',
    amount: Number(p.sale.total),
    balance_before: p.before,
    balance_after: p.after,
    ref_type: 'sale',
    ref_id: p.sale.id,
    ref_no: p.sale.sale_no,
    note: `銷售單 ${p.sale.sale_no} - 補記入帳（原本 payment_method=pending 未入帳）`,
    created_at: taiwanTime(),
  })
  if (txError) { console.error(`❌ ${p.sale.sale_no} 寫交易失敗：${txError.message}`); process.exit(1) }

  const { error: balError } = await db
    .from('accounts')
    .update({ balance: p.after, updated_at: taiwanTime() })
    .eq('id', p.account.id)
  if (balError) { console.error(`❌ ${p.sale.sale_no} 更新餘額失敗：${balError.message}`); process.exit(1) }

  console.log(`  ${p.sale.sale_no} +${p.sale.total} → ${p.account.account_name} ${p.after}`)
}

console.log('\n驗證：')
const after = await all(() => db.from('accounts').select('id, account_name, balance').in('id', [...running.keys()]))
for (const a of after) console.log(`  ${a.account_name}: ${a.balance}`)
console.log('\n✅ 完成。再跑一次 audit-sale-account-tx.mjs 應該會顯示沒有差異。')
