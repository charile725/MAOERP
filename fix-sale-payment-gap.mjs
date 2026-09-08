/**
 * 補回多元付款漏記的那一筆帳戶交易
 *
 * 成因：lib/account-service.ts 的冪等檢查原本只比對 (ref_type, ref_id, transaction_type)，
 * 沒有比對 account_id。多元付款是同一張銷售單分帳到多個帳戶、referenceId 相同，
 * 所以第一筆寫進去之後，後面每一筆都被當成「已記帳」跳過 —— 錢只進了一個帳戶，
 * 日結的差額會被丟進「其他未入帳」。程式面已修，這支負責把資料補回來。
 *
 * 判定：is_paid=true、status 不是 store_credit、ref_type='sale' 的帳戶交易合計 < total，
 *       而且 sales.account_id 還沒有對應的交易。
 * 補法：差額記到 sales.account_id。那個欄位存的是「金額最大的付款方式」對應的帳戶，
 *       被跳過的正好就是它（先寫進去的是另一種方式）。
 * 順帶：把 sales.payment_method 校正成 account_id 那個帳戶的付款方式代碼，
 *       否則銷貨紀錄顯示 A、日結卻把錢算在 B 帳上。
 *
 * 冪等：補完之後交易合計就等於 total，再跑一次會顯示「沒有需要補的」。
 *
 * 用法：
 *   node fix-sale-payment-gap.mjs            # dry-run
 *   node fix-sale-payment-gap.mjs --apply    # 實際寫入
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
/** sales.created_at 是台灣牆鐘（不帶時區），account_transactions.created_at 是真 UTC，差 8 小時 */
function wallClockToUtcIso(s) {
  const d = new Date(`${String(s).replace(' ', 'T').replace(/Z$/, '')}Z`)
  return new Date(d.getTime() - 8 * 3600 * 1000).toISOString()
}

console.log(`=== 多元付款漏記補正 ${apply ? '【實際寫入】' : '（dry-run，不寫入）'} ===`)
console.log(`環境檔：${envFile}\n資料庫：${url}\n`)

const accounts = await all(() => db.from('accounts').select('id, account_name, payment_method_code, balance'))
const accById = new Map(accounts.map((a) => [a.id, a]))
const sales = await all(() => db.from('sales').select('id, sale_no, sale_date, created_at, status, total, is_paid, account_id, payment_method'))
const txns = await all(() => db.from('account_transactions').select('ref_id, account_id, amount').eq('ref_type', 'sale').eq('transaction_type', 'sale'))

const txBySale = new Map()
for (const t of txns) {
  if (!txBySale.has(t.ref_id)) txBySale.set(t.ref_id, [])
  txBySale.get(t.ref_id).push(t)
}

const targets = []
const skipped = []
for (const s of sales) {
  if (!s.is_paid || s.status === 'store_credit') continue
  const list = txBySale.get(s.id) || []
  const sum = list.reduce((a, t) => a + Number(t.amount), 0)
  const gap = Number(s.total) - sum
  if (Math.abs(gap) < 0.01) continue
  if (gap < 0) { skipped.push({ s, reason: `交易合計 ${sum} 大於 total ${s.total}，不自動處理` }); continue }
  if (!s.account_id) { skipped.push({ s, reason: `沒有 account_id（付款方式 ${s.payment_method}），無法判斷該記到哪個帳戶` }); continue }
  if (list.some((t) => t.account_id === s.account_id)) {
    skipped.push({ s, reason: `sales.account_id（${accById.get(s.account_id)?.account_name}）已經有交易，差額 ${gap} 的歸屬無法判斷` })
    continue
  }
  targets.push({ s, list, sum, gap })
}

if (skipped.length > 0) {
  console.log(`--- 有差額但不自動處理的 ${skipped.length} 筆（需人工確認）---`)
  for (const { s, reason } of skipped) console.log(`  ${s.sale_no} ${s.sale_date} total=${s.total}：${reason}`)
  console.log('')
}

if (targets.length === 0) { console.log('✅ 沒有需要補的多元付款交易。'); process.exit(0) }

console.log(`--- 要補 ${targets.length} 筆 ---`)
for (const { s, list, gap } of targets) {
  const acc = accById.get(s.account_id)
  console.log(`  ${s.sale_no} ${s.sale_date} total=${s.total}`)
  console.log(`    已記：${list.map((t) => `${accById.get(t.account_id)?.account_name} ${t.amount}`).join(' + ') || '無'}`)
  console.log(`    要補：${acc?.account_name} ${gap}   （帳戶餘額 ${acc?.balance} → ${Number(acc?.balance || 0) + gap}）`)
  if (acc?.payment_method_code && acc.payment_method_code !== s.payment_method) {
    console.log(`    順帶校正 payment_method：${s.payment_method} → ${acc.payment_method_code}`)
  }
}

if (!apply) { console.log('\n(dry-run，沒有寫入任何資料。要實際執行請加 --apply)'); process.exit(0) }

console.log('\n寫入中...')
for (const { s, gap } of targets) {
  const acc = accById.get(s.account_id)
  const before = Number(acc.balance) || 0
  const after = before + gap

  const { error: txErr } = await db.from('account_transactions').insert({
    account_id: s.account_id,
    transaction_type: 'sale',
    amount: gap,
    balance_before: before,
    balance_after: after,
    ref_type: 'sale',
    ref_id: s.id,
    ref_no: s.sale_no,
    note: `多元付款補記 - ${acc.account_name}: $${gap}（結帳時被冪等檢查誤判為重複而跳過）`,
    created_at: wallClockToUtcIso(s.created_at),
  })
  if (txErr) { console.error(`  ❌ ${s.sale_no} 帳戶交易寫入失敗：${txErr.message}`); continue }

  const { error: balErr } = await db.from('accounts').update({ balance: after, updated_at: new Date().toISOString() }).eq('id', s.account_id)
  if (balErr) { console.error(`  ❌ ${s.sale_no} 帳戶餘額更新失敗：${balErr.message}`); continue }
  acc.balance = after

  if (acc.payment_method_code && acc.payment_method_code !== s.payment_method) {
    const { error: pmErr } = await db.from('sales').update({ payment_method: acc.payment_method_code }).eq('id', s.id)
    if (pmErr) console.error(`  ⚠️  ${s.sale_no} payment_method 校正失敗：${pmErr.message}`)
  }

  console.log(`  ✅ ${s.sale_no}  ${acc.account_name} ${before} → ${after}`)
}

console.log('\n驗證：')
const afterTx = await all(() => db.from('account_transactions').select('ref_id, account_id, amount').eq('ref_type', 'sale').eq('transaction_type', 'sale').in('ref_id', targets.map((t) => t.s.id)))
for (const { s } of targets) {
  const list = afterTx.filter((t) => t.ref_id === s.id)
  const sum = list.reduce((a, t) => a + Number(t.amount), 0)
  console.log(`  ${sum === Number(s.total) ? '✅' : '❌'} ${s.sale_no} total=${s.total} 交易合計=${sum}  [${list.map((t) => `${accById.get(t.account_id)?.account_name}:${t.amount}`).join(' + ')}]`)
}
for (const id of new Set(targets.map((t) => t.s.account_id))) {
  const { data: a } = await db.from('accounts').select('account_name, balance').eq('id', id).single()
  console.log(`  帳戶 ${a?.account_name} → ${a?.balance}`)
}
console.log('\n✅ 完成。')
