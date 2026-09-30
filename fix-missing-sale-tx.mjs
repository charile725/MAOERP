/**
 * 補回「已收款但沒有帳戶交易」的銷售單，並讓帳戶餘額與交易明細對齊
 *
 * 成因：lib/account-service.ts 的 updateAccountBalance 是「先更新 accounts.balance、
 * 再寫 account_transactions」，而且日誌寫失敗時只印警告、仍然回報成功。
 * 所以會出現兩種殘缺狀態：
 *   (a) 餘額加了、明細沒寫 → 餘額比明細累計多，對帳永遠差這筆
 *   (b) 兩邊都沒寫        → 單子標示已收款，但錢完全沒進帳
 *
 * 這支同時處理兩種：
 *   先算每個帳戶的「餘額 − 明細累計」＝漂移量，
 *   再從缺交易的銷售單裡找出「金額加總剛好等於漂移量」的組合，
 *   那些就是 (a)：只補明細、不動餘額；其餘是 (b)：補明細並把金額加進餘額。
 *   組合不唯一就整個中止，不亂猜。
 *
 * 用法：
 *   node fix-missing-sale-tx.mjs            # dry-run
 *   node fix-missing-sale-tx.mjs --apply    # 實際寫入
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
const money = (n) => Math.round(Number(n || 0) * 100) / 100
/** sales.created_at 是台灣牆鐘（不帶時區），account_transactions.created_at 是真 UTC */
function wallClockToUtcIso(s) {
  const d = new Date(`${String(s).replace(' ', 'T').replace(/Z$/, '')}Z`)
  return new Date(d.getTime() - 8 * 3600 * 1000).toISOString()
}

/** 從 amounts 裡找出加總等於 target 的子集；找到剛好一種才回傳 */
function uniqueSubset(amounts, target) {
  const solutions = []
  const n = amounts.length
  if (n > 20) return { ambiguous: true, solutions: [] }  // 組合爆炸，交給人工
  for (let mask = 0; mask < (1 << n); mask++) {
    let sum = 0
    for (let i = 0; i < n; i++) if (mask & (1 << i)) sum += amounts[i]
    if (sum === target) solutions.push(mask)
    if (solutions.length > 1) break
  }
  return { ambiguous: solutions.length !== 1, mask: solutions[0] }
}

console.log(`=== 補回缺漏的銷售帳戶交易 ${apply ? '【實際寫入】' : '（dry-run，不寫入）'} ===`)
console.log(`環境檔：${envFile}\n資料庫：${env.NEXT_PUBLIC_SUPABASE_URL}\n`)

const accounts = await all(() => db.from('accounts').select('id, account_name, balance'))
const accById = new Map(accounts.map((a) => [a.id, a]))
const txns = await all(() => db.from('account_transactions').select('account_id, ref_id, ref_type, transaction_type, balance_before, balance_after'))
const sales = await all(() => db.from('sales').select('id, sale_no, sale_date, created_at, source, status, total, is_paid, account_id, payment_method'))

// 每個帳戶的餘額漂移
const deltaByAccount = new Map()
for (const t of txns) {
  deltaByAccount.set(t.account_id, (deltaByAccount.get(t.account_id) || 0) + (cents(t.balance_after) - cents(t.balance_before)))
}
// 已經有 sale 交易的銷售單
const hasSaleTx = new Set(txns.filter((t) => t.ref_type === 'sale' && t.transaction_type === 'sale').map((t) => t.ref_id))

const missing = sales.filter((s) =>
  s.is_paid && s.account_id && cents(s.total) > 0 &&
  s.status !== 'store_credit' && s.source !== 'live' && !hasSaleTx.has(s.id)
).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))

const noAccount = sales.filter((s) =>
  s.is_paid && !s.account_id && cents(s.total) > 0 && s.status !== 'store_credit' && !hasSaleTx.has(s.id)
)

if (noAccount.length > 0) {
  console.log(`--- 已收款但沒有指定帳戶的 ${noAccount.length} 筆（無法判斷錢進哪個帳戶，不處理）---`)
  for (const s of noAccount) console.log(`  ${s.sale_no} ${s.sale_date} ${s.source} total=${money(s.total)} 付款方式=${s.payment_method}`)
  console.log('')
}

if (missing.length === 0) { console.log('✅ 沒有缺漏的銷售帳戶交易。'); process.exit(0) }

const plans = []
let aborted = false
for (const account of accounts) {
  const mine = missing.filter((s) => s.account_id === account.id)
  if (mine.length === 0) continue
  const drift = cents(account.balance) - (deltaByAccount.get(account.id) || 0)

  console.log(`--- ${account.account_name} ---`)
  console.log(`  餘額 ${money(account.balance)}、明細累計 ${money((deltaByAccount.get(account.id) || 0) / 100)}、漂移 ${money(drift / 100)}`)
  console.log(`  缺交易的銷售單 ${mine.length} 筆：${mine.map((s) => `${s.sale_no}(${money(s.total)})`).join('、')}`)

  const { ambiguous, mask } = uniqueSubset(mine.map((s) => cents(s.total)), drift)
  if (ambiguous) {
    console.log(`  ❌ 找不到（或不只一種）金額加總等於漂移 ${money(drift / 100)} 的組合，這個帳戶不自動處理`)
    aborted = true
    continue
  }

  mine.forEach((s, i) => {
    const alreadyInBalance = !!(mask & (1 << i))
    plans.push({ s, account, alreadyInBalance })
    console.log(`    ${s.sale_no} ${money(s.total)} → ${alreadyInBalance ? '餘額已含，只補明細' : '補明細並加進餘額'}`)
  })
  console.log('')
}

if (plans.length === 0) { console.log('沒有可自動處理的項目。'); process.exit(aborted ? 1 : 0) }

if (!apply) { console.log('(dry-run，沒有寫入任何資料。要實際執行請加 --apply)'); process.exit(0) }

console.log('寫入中...')
// 同一帳戶依時間逐筆推進，balance_before / after 才連得起來
const runningBalance = new Map()
for (const { s, account, alreadyInBalance } of plans) {
  const current = runningBalance.has(account.id) ? runningBalance.get(account.id) : cents(account.balance)
  // 餘額已含這筆時，明細要記在「加進去之前 → 之後」；否則是「現在 → 現在＋金額」
  const before = alreadyInBalance ? current - cents(s.total) : current
  const after = before + cents(s.total)

  const { error: txErr } = await db.from('account_transactions').insert({
    account_id: account.id,
    transaction_type: 'sale',
    amount: money(s.total),
    balance_before: money(before / 100),
    balance_after: money(after / 100),
    ref_type: 'sale',
    ref_id: s.id,
    ref_no: s.sale_no,
    note: alreadyInBalance
      ? '補記帳戶交易：結帳時餘額已更新但審計日誌寫入失敗'
      : '補記帳戶交易：結帳時餘額與審計日誌都沒寫入',
    created_at: wallClockToUtcIso(s.created_at),
  })
  if (txErr) { console.error(`  ❌ ${s.sale_no} 寫入交易失敗：${txErr.message}`); continue }

  if (!alreadyInBalance) {
    const { error: balErr } = await db.from('accounts').update({ balance: money(after / 100), updated_at: new Date().toISOString() }).eq('id', account.id)
    if (balErr) { console.error(`  ❌ ${s.sale_no} 更新餘額失敗：${balErr.message}`); continue }
    runningBalance.set(account.id, after)
  }
  console.log(`  ✅ ${s.sale_no} ${money(s.total)}（${alreadyInBalance ? '只補明細' : `餘額 ${money(before / 100)} → ${money(after / 100)}`}）`)
}

console.log('\n驗證：')
const acc2 = await all(() => db.from('accounts').select('id, account_name, balance'))
const tx2 = await all(() => db.from('account_transactions').select('account_id, balance_before, balance_after'))
const d2 = new Map()
for (const t of tx2) d2.set(t.account_id, (d2.get(t.account_id) || 0) + (cents(t.balance_after) - cents(t.balance_before)))
let bad = 0
for (const a of acc2) {
  const diff = cents(a.balance) - (d2.get(a.id) || 0)
  if (diff !== 0) bad += 1
  console.log(`  ${diff === 0 ? '✅' : '⚠️ '} ${String(a.account_name).padEnd(12)} 餘額 ${String(money(a.balance)).padStart(10)}  明細累計 ${String(money((d2.get(a.id) || 0) / 100)).padStart(10)}  差 ${money(diff / 100)}`)
}
console.log(bad === 0 ? '\n✅ 所有帳戶的餘額都等於明細累計。' : `\n⚠️ 還有 ${bad} 個帳戶對不上。`)
