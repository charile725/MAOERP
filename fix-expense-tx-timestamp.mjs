/**
 * 修正費用帳戶交易的時間（差 8 小時、會出現在未來）
 *
 * 成因（2026-10-30 查清楚，跟原本猜的「觸發器寫台灣牆上時間」不一樣）：
 *   account_transactions.created_at 是 timestamptz，但它的資料庫預設值是
 *   `now() + '08:00:00'::interval` —— 等於把「現在 + 8 小時」當成一個真實時刻存進去。
 *   程式自己寫入時會帶 getTaiwanTime()（真 UTC），所以是對的；
 *   但費用那批是資料庫端寫的、沒有帶 created_at，就吃到這個預設值，
 *   每一筆都比真實時間晚 8 小時（剛記的費用會顯示在未來）。
 *
 * 判斷哪些要修：費用的 expenses.created_at 是台灣牆上時間（timestamp 無時區），
 * 觸發器同一瞬間寫入，所以「吃到壞預設值」的那批 tx.created_at 這個時刻
 * 會剛好等於 expenses.created_at 的字面值。正確值 = 該字面值 − 8 小時。
 *
 * 另外 accounts.created_at 也是同一個壞預設值，但沒有可以對照的來源，
 * 而且畫面上不顯示，所以只改預設值（見 sql/fix_db_defaults_and_triggers.sql），不動資料。
 *
 * 用法：
 *   node fix-expense-tx-timestamp.mjs            # dry-run
 *   node fix-expense-tx-timestamp.mjs --apply    # 實際寫入
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
const EIGHT_HOURS = 8 * 3600 * 1000

async function all(build) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < PAGE) return rows
  }
}
// 有時區標記就照標記解析；沒有的（timestamp 無時區）照字面當成 UTC 解析
const instant = (v) => new Date(String(v) + (/(?:Z|[+-]\d{2}:?\d{2})$/.test(String(v)) ? '' : 'Z')).getTime()
const show = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')

console.log(`=== 費用帳戶交易時間修正 ${apply ? '【實際寫入】' : '（dry-run，不寫入）'} ===`)
console.log(`環境檔：${envFile}\n資料庫：${env.NEXT_PUBLIC_SUPABASE_URL}\n`)

const txs = await all(() =>
  db.from('account_transactions').select('id, ref_id, amount, account_id, created_at').eq('ref_type', 'expense')
)
const expenses = await all(() => db.from('expenses').select('id, date, amount, created_at'))
const expById = new Map(expenses.map((e) => [String(e.id), e]))
const accounts = await all(() => db.from('accounts').select('id, account_name'))
const accName = new Map(accounts.map((a) => [a.id, a.account_name]))

const toFix = []
const alreadyOk = []
const noSource = []
for (const tx of txs) {
  const e = expById.get(String(tx.ref_id))
  if (!e) { noSource.push(tx); continue }
  const wall = instant(e.created_at)          // 字面值（= 真實時間 + 8 小時）
  const correct = wall - EIGHT_HOURS          // 真實時刻
  const current = instant(tx.created_at)
  if (Math.abs(current - wall) <= 120 * 1000) toFix.push({ tx, e, correct, current })
  else alreadyOk.push({ tx, e, correct, current })
}

console.log(`費用帳戶交易共 ${txs.length} 筆`)
console.log(`  吃到壞預設值、晚 8 小時：${toFix.length} 筆`)
console.log(`  時間已經正確（程式寫入的）：${alreadyOk.length} 筆`)
if (noSource.length > 0) console.log(`  ⚠️  找不到對應費用，略過：${noSource.length} 筆`)

if (toFix.length === 0) {
  console.log('\n✅ 沒有需要修正的紀錄。')
  process.exit(0)
}

console.log('\n要改的前 10 筆：')
for (const f of toFix.slice(0, 10)) {
  console.log(
    `  ${String(accName.get(f.tx.account_id) || '?').padEnd(10)} ${String(f.tx.amount).padStart(7)}  ` +
    `${show(f.current)} → ${show(f.correct)}  (費用日期 ${String(f.e.date).slice(0, 10)})`
  )
}
if (toFix.length > 10) console.log(`  ...另外 ${toFix.length - 10} 筆`)

const future = toFix.filter((f) => f.current > Date.now())
console.log(`\n其中 ${future.length} 筆目前還落在未來時間。`)

if (!apply) {
  console.log('\n(dry-run，沒有寫入任何資料。要實際執行請加 --apply)')
  process.exit(0)
}

console.log('\n寫入中...')
let ok = 0
for (const f of toFix) {
  const { error } = await db
    .from('account_transactions')
    .update({ created_at: new Date(f.correct).toISOString() })
    .eq('id', f.tx.id)
  if (error) { console.error(`  ❌ ${f.tx.id}：${error.message}`); continue }
  ok += 1
}
console.log(`  ✅ 修正 ${ok} / ${toFix.length} 筆`)

console.log('\n驗證：')
const after = await all(() =>
  db.from('account_transactions').select('id, ref_id, created_at').eq('ref_type', 'expense')
)
let stillWrong = 0
let stillFuture = 0
for (const tx of after) {
  const e = expById.get(String(tx.ref_id))
  const current = instant(tx.created_at)
  if (e && Math.abs(current - instant(e.created_at)) <= 120 * 1000) stillWrong += 1
  if (current > Date.now()) stillFuture += 1
}
console.log(`  還是晚 8 小時的：${stillWrong} 筆`)
console.log(`  還落在未來的：${stillFuture} 筆`)
if (stillWrong === 0 && stillFuture === 0) console.log('  ✅ 修正完成。')
console.log('\n⚠️  資料庫預設值還是壞的，新進來的費用會再出現同樣問題。')
console.log('   請在 Supabase SQL Editor 跑 sql/fix_db_defaults_and_triggers.sql。')
