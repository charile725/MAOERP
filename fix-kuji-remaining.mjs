/**
 * 修正一番賞賞項的剩餘抽數（remaining）被重複加回的問題
 *
 * 成因：刪除銷售單時，舊版在「第 4 步」就把一番賞 remaining 加回去，
 * 但後面刪 sale_items / sales 還可能失敗（複選獎選項 FK、銷貨更正紀錄 FK）。
 * 一失敗就回錯誤、使用者重按，第 4 步又加一次 —— 重按幾次就多還幾倍。
 * 程式面已改成「銷售單真的刪掉之後才回補」，這支負責修資料。
 *
 * 正確值：remaining = quantity − Σ(現存 sale_items.quantity，指向這個賞項)
 *
 * 只修「剩餘比應有的多」的賞項（多還）。
 * 「剩餘比應有的少」可能是銷貨更正把抽數更正掉了——紙籤實際已經被抽走，
 * 不回補才是對的——所以只列出來，不自動修。
 *
 * 用法：
 *   node fix-kuji-remaining.mjs            # dry-run
 *   node fix-kuji-remaining.mjs --apply    # 實際寫入
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

console.log(`=== 一番賞剩餘抽數修正 ${apply ? '【實際寫入】' : '（dry-run，不寫入）'} ===`)
console.log(`環境檔：${envFile}\n資料庫：${env.NEXT_PUBLIC_SUPABASE_URL}\n`)

const kujis = await all(() => db.from('ichiban_kuji').select('id, name, is_active, total_draws'))
const kujiById = new Map(kujis.map((k) => [k.id, k]))
const prizes = await all(() => db.from('ichiban_kuji_prizes').select('id, kuji_id, prize_tier, prize_name, quantity, remaining'))
const saleItems = await all(() => db.from('sale_items').select('ichiban_kuji_prize_id, quantity').not('ichiban_kuji_prize_id', 'is', null))

const soldByPrize = new Map()
for (const s of saleItems) {
  soldByPrize.set(s.ichiban_kuji_prize_id, (soldByPrize.get(s.ichiban_kuji_prize_id) || 0) + Number(s.quantity))
}

const over = []
const under = []
for (const p of prizes) {
  const sold = soldByPrize.get(p.id) || 0
  const expected = Math.max(0, Number(p.quantity) - sold)
  const diff = Number(p.remaining) - expected
  if (diff > 0) over.push({ p, sold, expected, diff })
  else if (diff < 0) under.push({ p, sold, expected, diff })
}

function printGroup(list) {
  const byKuji = new Map()
  for (const x of list) {
    if (!byKuji.has(x.p.kuji_id)) byKuji.set(x.p.kuji_id, [])
    byKuji.get(x.p.kuji_id).push(x)
  }
  for (const [kujiId, rows] of byKuji) {
    const k = kujiById.get(kujiId)
    const before = rows.reduce((a, x) => a + Number(x.p.remaining), 0)
    const after = rows.reduce((a, x) => a + x.expected, 0)
    console.log(`  【${k?.name || kujiId}】${k?.is_active ? '啟用' : '停用'}`)
    for (const x of rows) {
      console.log(`     [${x.p.prize_tier}] 總數 ${x.p.quantity}、現存銷售 ${x.sold} → 剩餘 ${x.p.remaining} 應為 ${x.expected}（${x.diff > 0 ? '多' : '少'} ${Math.abs(x.diff)}）`)
    }
    console.log(`     這些賞項合計剩餘 ${before} → ${after}`)
  }
}

if (under.length > 0) {
  console.log(`--- 剩餘比應有的少（${under.length} 筆，只列出不修，可能是銷貨更正）---`)
  printGroup(under)
  console.log('')
}

if (over.length === 0) { console.log('✅ 沒有被重複加回的賞項。'); process.exit(0) }

console.log(`--- 剩餘比應有的多（${over.length} 筆，要修）---`)
printGroup(over)

if (!apply) { console.log('\n(dry-run，沒有寫入任何資料。要實際執行請加 --apply)'); process.exit(0) }

console.log('\n寫入中...')
let ok = 0
for (const x of over) {
  const { error } = await db.from('ichiban_kuji_prizes').update({ remaining: x.expected }).eq('id', x.p.id)
  if (error) { console.error(`  ❌ ${x.p.id}：${error.message}`); continue }
  ok += 1
}
console.log(`  ✅ 修正 ${ok} / ${over.length} 筆`)

console.log('\n驗證：')
const prizes2 = await all(() => db.from('ichiban_kuji_prizes').select('id, quantity, remaining'))
let stillOver = 0
let overQty = 0
for (const p of prizes2) {
  const expected = Math.max(0, Number(p.quantity) - (soldByPrize.get(p.id) || 0))
  if (Number(p.remaining) > expected) stillOver += 1
  if (Number(p.remaining) > Number(p.quantity)) overQty += 1
}
console.log(`  剩餘比應有的多：${stillOver} 筆`)
console.log(`  剩餘比總數還大：${overQty} 筆`)
if (stillOver === 0 && overQty === 0) console.log('  ✅ 修正完成。')
