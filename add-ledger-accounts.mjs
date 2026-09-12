/**
 * 新增「官方賴記帳」「IG記帳」兩個收款帳戶
 *
 * 這兩個是自己的收款帳戶（結帳當下就算收到錢，金額累積在帳戶餘額裡），
 * 之後對帳時用帳戶頁的「資金轉帳」把錢轉到真正的銀行。
 *
 * 為什麼不用帳戶頁的「新增帳戶」直接建：
 *   - 那個表單不給填 payment_method_code，會照中文名自動產生（會是中文代碼）
 *   - auto_mark_paid 舊版表單沒有開放，預設 false，手機版 POS 會把單子當成未收款
 * 這支用固定的英數代碼建，POS／日結／現金流才串得起來。
 *
 * 冪等：同名或同代碼已存在就跳過。
 *
 * 用法：
 *   node add-ledger-accounts.mjs            # dry-run
 *   node add-ledger-accounts.mjs --apply    # 實際寫入
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

const WANTED = [
  { account_name: '官方賴記帳', payment_method_code: 'line_oa_ledger', sort_order: 5 },
  { account_name: 'IG記帳', payment_method_code: 'ig_ledger', sort_order: 6 },
]

console.log(`=== 新增記帳收款帳戶 ${apply ? '【實際寫入】' : '（dry-run，不寫入）'} ===`)
console.log(`環境檔：${envFile}\n資料庫：${url}\n`)

const { data: existing, error: exErr } = await db.from('accounts').select('id, account_name, payment_method_code, sort_order')
if (exErr) { console.error(`讀取 accounts 失敗：${exErr.message}`); process.exit(1) }

console.log(`目前 ${existing.length} 個帳戶：${existing.map((a) => `${a.account_name}(${a.payment_method_code})`).join('、')}\n`)

const byName = new Set(existing.map((a) => a.account_name))
const byCode = new Set(existing.map((a) => a.payment_method_code))

const toCreate = []
for (const w of WANTED) {
  if (byName.has(w.account_name)) { console.log(`  ⏭  ${w.account_name}：帳戶名稱已存在，跳過`); continue }
  if (byCode.has(w.payment_method_code)) { console.log(`  ⏭  ${w.account_name}：代碼 ${w.payment_method_code} 已被使用，跳過`); continue }
  toCreate.push({
    account_name: w.account_name,
    account_type: 'bank',
    payment_method_code: w.payment_method_code,
    display_name: w.account_name,
    sort_order: w.sort_order,
    auto_mark_paid: true,   // 結帳當下就算已收款
    balance: 0,             // 餘額只能靠交易產生，建立時一律 0
    is_active: true,
  })
}

if (toCreate.length === 0) { console.log('\n✅ 沒有需要新增的帳戶。'); process.exit(0) }

console.log(`\n要新增 ${toCreate.length} 個帳戶：`)
for (const a of toCreate) {
  console.log(`  ${a.account_name}  代碼=${a.payment_method_code}  類型=${a.account_type}  排序=${a.sort_order}  結帳自動已收款=是  初始餘額=0`)
}

if (!apply) { console.log('\n(dry-run，沒有寫入任何資料。要實際執行請加 --apply)'); process.exit(0) }

console.log('\n寫入中...')
for (const a of toCreate) {
  const { data, error } = await db.from('accounts').insert(a).select().single()
  if (error) { console.error(`  ❌ ${a.account_name}：${error.message}`); continue }
  console.log(`  ✅ ${data.account_name}  id=${data.id}`)
}

console.log('\n驗證：')
const { data: after } = await db.from('accounts').select('account_name, payment_method_code, account_type, balance, auto_mark_paid, is_active, sort_order').order('sort_order')
console.log('帳戶'.padEnd(14) + '代碼'.padEnd(18) + '類型'.padEnd(10) + '餘額'.padStart(10) + '  自動已收款  啟用')
console.log('-'.repeat(72))
for (const a of after) {
  console.log(String(a.account_name).padEnd(14) + String(a.payment_method_code).padEnd(18) + String(a.account_type).padEnd(10) +
    String(a.balance).padStart(10) + `      ${a.auto_mark_paid ? 'Y' : 'N'}        ${a.is_active ? 'Y' : 'N'}`)
}
console.log('\n✅ 完成。')
