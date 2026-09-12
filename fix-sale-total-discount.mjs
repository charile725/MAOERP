/**
 * 修正 sales.total 沒有扣到折扣的單
 *
 * 成因：資料庫有一個觸發器，只要 sale_items 被更動就重算 sales.subtotal / sales.total，
 * 但它算 total 時沒有扣 discount_amount，也沒有扣 store_credit_used。
 * 結果：任何「動到明細」的操作都會把折扣吃掉，total 被寫成未折扣的金額。
 *
 * 正確值：total = max(0, subtotal - discount_amount) - store_credit_used
 * （subtotal 本來就含整筆加價）
 *
 * 安全機制：已收款且非直播的單，會拿 account_transactions 的合計交叉驗證。
 * 算出來的值跟實際收到的錢對不上就跳過，不亂改。
 *
 * 用法：
 *   node fix-sale-total-discount.mjs            # dry-run
 *   node fix-sale-total-discount.mjs --apply    # 實際寫入
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
const eq = (a, b) => Math.abs(money(a) - money(b)) < 0.01

console.log(`=== sales.total 折扣修正 ${apply ? '【實際寫入】' : '（dry-run，不寫入）'} ===`)
console.log(`環境檔：${envFile}\n資料庫：${env.NEXT_PUBLIC_SUPABASE_URL}\n`)

const sales = await all(() => db.from('sales').select('id, sale_no, sale_date, source, subtotal, discount_amount, store_credit_used, total, is_paid, status'))
const txns = await all(() => db.from('account_transactions').select('ref_id, amount').eq('ref_type', 'sale').eq('transaction_type', 'sale'))
const txBySale = new Map()
for (const t of txns) txBySale.set(t.ref_id, (txBySale.get(t.ref_id) || 0) + Number(t.amount))

const targets = []
const skipped = []
for (const s of sales) {
  const expected = money(Math.max(0, Number(s.subtotal || 0) - Number(s.discount_amount || 0)) - Number(s.store_credit_used || 0))
  if (eq(expected, s.total)) continue

  // 已收款、非直播的單：帳戶交易合計就是實際收到的錢，拿來驗證算出來的 total
  const paidSum = txBySale.get(s.id)
  const checkable = s.is_paid && s.source !== 'live' && s.status !== 'store_credit' && paidSum !== undefined
  if (checkable && !eq(paidSum, expected)) {
    skipped.push({ s, expected, paidSum, reason: `算出 ${expected} 但實際收款 ${money(paidSum)}，對不上` })
    continue
  }
  targets.push({ s, expected, paidSum })
}

if (skipped.length > 0) {
  console.log(`--- 不自動處理的 ${skipped.length} 張（需人工確認）---`)
  for (const { s, reason } of skipped) console.log(`  ${s.sale_no} ${s.sale_date} total=${money(s.total)}：${reason}`)
  console.log('')
}

if (targets.length === 0) { console.log('✅ 沒有需要修正的單。'); process.exit(0) }

console.log(`要修正 ${targets.length} 張：\n`)
console.log('單號'.padEnd(9) + '日期'.padEnd(13) + '小計'.padStart(9) + '折扣'.padStart(9) + '購物金'.padStart(8) + '目前total'.padStart(11) + '應為'.padStart(10) + '  收款驗證')
console.log('-'.repeat(82))
for (const { s, expected, paidSum } of targets) {
  console.log(
    String(s.sale_no).padEnd(9) + String(s.sale_date).padEnd(13) +
    String(money(s.subtotal)).padStart(9) + String(money(s.discount_amount)).padStart(9) +
    String(money(s.store_credit_used)).padStart(8) + String(money(s.total)).padStart(11) +
    String(expected).padStart(10) +
    (paidSum === undefined ? '  （無收款紀錄）' : `  實收 ${money(paidSum)} ✓`)
  )
}

if (!apply) { console.log('\n(dry-run，沒有寫入任何資料。要實際執行請加 --apply)'); process.exit(0) }

console.log('\n寫入中...')
let ok = 0
for (const { s, expected } of targets) {
  const { error } = await db.from('sales').update({ total: expected }).eq('id', s.id)
  if (error) { console.error(`  ❌ ${s.sale_no}：${error.message}`); continue }
  ok += 1
  console.log(`  ✅ ${s.sale_no}  ${money(s.total)} → ${expected}`)
}

console.log(`\n完成 ${ok} 張。驗證：`)
const after = await all(() => db.from('sales').select('id, sale_no, subtotal, discount_amount, store_credit_used, total'))
const still = after.filter((s) => !eq(Math.max(0, Number(s.subtotal || 0) - Number(s.discount_amount || 0)) - Number(s.store_credit_used || 0), s.total))
console.log(`  仍不符的單：${still.length} 張`)
for (const s of still.slice(0, 10)) console.log(`    ${s.sale_no} subtotal=${s.subtotal} 折扣=${s.discount_amount} total=${s.total}`)
if (still.length === 0) console.log('  ✅ 全部 total 都等於「小計 - 折扣 - 購物金」了。')
