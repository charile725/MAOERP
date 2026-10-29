/**
 * 日結快照重算
 *
 * 問題：日結是「按下去那一刻」的快照，之後刪單／更正單都不會回頭改它。
 * 2026-09-04 的 pos 日結就這樣卡住：快照寫 13 筆／27,210（現金 9,920），
 * 但當天有 5 張單（S0081 S0083 S0085 S0089 S0094）事後被刪掉，
 * 現在實際只剩 23,870（現金 6,580）—— 報表跟帳戶明細永遠差 3,340。
 *
 * 這支依照 POST /api/business-day-closing 的同一套邏輯，用現在的資料重算
 * 每一天的 pos 日結，對不上的就更新。
 *   - 取單條件：sale_date = 營業日、source = 'pos'、status = 'confirmed'、total > 0
 *   - 分帳來源：account_transactions（transaction_type='sale'）→ AR 收款分配
 *     → 最後才 fallback 到 sales.account_id，跟線上邏輯一致
 *
 * live 的日結是手動輸入營業額（manual_revenue），不能從銷售單重算，一律跳過。
 *
 * 覆蓋前會把原始快照整筆存成 JSON 檔備份。
 *
 * 用法：
 *   node fix-closing-snapshot.mjs                 # dry-run
 *   node fix-closing-snapshot.mjs --apply         # 實際寫入
 *   node fix-closing-snapshot.mjs --date=2026-09-04 --apply   # 只處理某一天
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const onlyDate = (args.find((a) => a.startsWith('--date=')) || '').slice(7) || null
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
function chunks(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// 跟 app/api/business-day-closing/route.ts 的 paymentBucket 一模一樣
function paymentBucket(method) {
  if (method === 'cash') return 'cash'
  if (method === 'card') return 'card'
  if (method === 'cod') return 'cod'
  if (!method || method === 'pending') return null
  return 'transfer'
}

console.log(`=== 日結快照重算 ${apply ? '【實際寫入】' : '（dry-run，不寫入）'} ===`)
console.log(`環境檔：${envFile}\n資料庫：${env.NEXT_PUBLIC_SUPABASE_URL}\n`)

const closings = await all(() => db.from('business_day_closings').select('*').eq('source', 'pos').order('business_date'))
const targets = onlyDate ? closings.filter((c) => c.business_date === onlyDate) : closings
if (targets.length === 0) {
  console.log(onlyDate ? `找不到 ${onlyDate} 的 pos 日結。` : '沒有 pos 日結記錄。')
  process.exit(0)
}
console.log(`要檢查 ${targets.length} 天的 pos 日結\n`)

const accounts = await all(() => db.from('accounts').select('id, account_name'))
const accName = new Map(accounts.map((a) => [a.id, a.account_name]))

async function recompute(businessDate) {
  const sales = await all(() =>
    db
      .from('sales')
      .select('id, total, payment_method, account_id, is_paid')
      .eq('sale_date', businessDate)
      .eq('source', 'pos')
      .eq('status', 'confirmed')
      .gt('total', 0)
  )

  const stats = {
    sales_count: sales.length,
    total_sales: 0, total_cash: 0, total_card: 0, total_transfer: 0, total_cod: 0,
    paid_count: 0, paid_sales: 0, paid_cash: 0, paid_card: 0, paid_transfer: 0, paid_cod: 0,
    unpaid_count: 0, unpaid_sales: 0, unpaid_cash: 0, unpaid_card: 0, unpaid_transfer: 0, unpaid_cod: 0,
    sales_by_account: {},
  }

  for (const sale of sales) {
    stats.total_sales += Number(sale.total)
    const b = paymentBucket(sale.payment_method)
    if (b) stats[`total_${b}`] += Number(sale.total)
    if (sale.is_paid) {
      stats.paid_count += 1
      stats.paid_sales += Number(sale.total)
      if (b) stats[`paid_${b}`] += Number(sale.total)
    } else {
      stats.unpaid_count += 1
      stats.unpaid_sales += Number(sale.total)
      if (b) stats[`unpaid_${b}`] += Number(sale.total)
    }
  }

  const saleIds = sales.map((s) => s.id)
  const covered = new Set()
  if (saleIds.length > 0) {
    const txns = []
    for (const ids of chunks(saleIds, 150)) {
      txns.push(...(await all(() =>
        db.from('account_transactions').select('account_id, amount, ref_id')
          .in('ref_id', ids).eq('transaction_type', 'sale').eq('ref_type', 'sale')
      )))
    }
    for (const t of txns) {
      if (!t.account_id || !t.ref_id) continue
      stats.sales_by_account[t.account_id] = (stats.sales_by_account[t.account_id] || 0) + Number(t.amount)
      covered.add(t.ref_id)
    }

    // AR 收款：銷售掛應收 → 收款單分配 → 收款進了哪個帳戶
    const arAccounts = []
    for (const ids of chunks(saleIds, 150)) {
      arAccounts.push(...(await all(() =>
        db.from('partner_accounts').select('id').in('ref_id', ids).eq('ref_type', 'sale').eq('direction', 'AR')
      )))
    }
    const paIds = arAccounts.map((a) => a.id)
    if (paIds.length > 0) {
      const allocations = []
      for (const ids of chunks(paIds, 150)) {
        allocations.push(...(await all(() =>
          db.from('settlement_allocations').select('settlement_id, amount').in('partner_account_id', ids)
        )))
      }
      const settlementIds = [...new Set(allocations.map((a) => a.settlement_id))]
      if (settlementIds.length > 0) {
        const receiptTxns = []
        for (const ids of chunks(settlementIds, 150)) {
          receiptTxns.push(...(await all(() =>
            db.from('account_transactions').select('ref_id, account_id')
              .in('ref_id', ids).eq('transaction_type', 'customer_payment')
          )))
        }
        const settlementAccount = new Map(receiptTxns.map((t) => [t.ref_id, t.account_id]))
        for (const alloc of allocations) {
          const accountId = settlementAccount.get(alloc.settlement_id)
          if (accountId && alloc.amount) {
            stats.sales_by_account[accountId] = (stats.sales_by_account[accountId] || 0) + Number(alloc.amount)
          }
        }
      }
    }
  }

  // fallback：已收款、有帳戶，但帳戶明細裡沒有對應交易
  for (const sale of sales) {
    if (sale.is_paid && sale.account_id && !covered.has(sale.id)) {
      stats.sales_by_account[sale.account_id] = (stats.sales_by_account[sale.account_id] || 0) + Number(sale.total)
    }
  }

  const tracked = Object.values(stats.sales_by_account).reduce((s, v) => s + v, 0)
  const gap = Math.round((stats.paid_sales - tracked) * 100) / 100
  if (gap > 0.01) stats.sales_by_account['__untracked__'] = gap

  return stats
}

const FIELDS = [
  'sales_count', 'total_sales', 'total_cash', 'total_card', 'total_transfer', 'total_cod',
  'paid_count', 'paid_sales', 'paid_cash', 'paid_card', 'paid_transfer', 'paid_cod',
  'unpaid_count', 'unpaid_sales', 'unpaid_cash', 'unpaid_card', 'unpaid_transfer', 'unpaid_cod',
]

const drifted = []
for (const c of targets) {
  const fresh = await recompute(c.business_date)
  const diffs = []
  for (const f of FIELDS) {
    const before = Number(c[f] || 0)
    const after = Number(fresh[f] || 0)
    if (before !== after) diffs.push({ f, before, after })
  }
  // 分帳要逐個帳戶比數字 —— 比 JSON 字串會因為鍵的順序不同就誤判成有差異
  const before = c.sales_by_account || {}
  const after = fresh.sales_by_account || {}
  const accKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  const accDiffs = accKeys
    .map((k) => ({ k, before: Number(before[k] || 0), after: Number(after[k] || 0) }))
    .filter((d) => d.before !== d.after)
  if (diffs.length > 0 || accDiffs.length > 0) drifted.push({ c, fresh, diffs, accDiffs })
}

if (drifted.length === 0) {
  console.log('✅ 所有 pos 日結快照都跟現在的銷售資料一致。')
  process.exit(0)
}

console.log(`--- ${drifted.length} 天的快照跟現況不符 ---\n`)
for (const { c, diffs, accDiffs } of drifted) {
  console.log(`【${c.business_date}】日結時間 ${String(c.closing_time).slice(0, 16).replace('T', ' ')}`)
  for (const d of diffs) console.log(`   ${d.f.padEnd(16)} ${String(d.before).padStart(8)} → ${String(d.after).padStart(8)}  (${d.after - d.before > 0 ? '+' : ''}${d.after - d.before})`)
  for (const d of accDiffs) console.log(`   分帳 ${String(accName.get(d.k) || d.k).padEnd(12)} ${String(d.before).padStart(8)} → ${String(d.after).padStart(8)}`)
  console.log('')
}

if (!apply) {
  console.log('(dry-run，沒有寫入任何資料。要實際執行請加 --apply)')
  process.exit(0)
}

const backupPath = `closing-snapshot-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
writeFileSync(backupPath, JSON.stringify(drifted.map((d) => d.c), null, 2), 'utf8')
console.log(`原始快照已備份：${backupPath}\n`)

console.log('寫入中...')
let ok = 0
for (const { c, fresh } of drifted) {
  const payload = {}
  for (const f of FIELDS) payload[f] = fresh[f]
  payload.sales_by_account = fresh.sales_by_account
  const { error } = await db.from('business_day_closings').update(payload).eq('id', c.id)
  if (error) { console.error(`  ❌ ${c.business_date}：${error.message}`); continue }
  ok += 1
  console.log(`  ✅ ${c.business_date} 已更新`)
}
console.log(`\n  更新 ${ok} / ${drifted.length} 天`)
console.log('再跑一次這支應該會顯示全部一致。')
