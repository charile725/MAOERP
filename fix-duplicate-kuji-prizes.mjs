/**
 * 清除一番賞重複的賞項，並重算抽數與成本
 *
 * 成因：`PUT /api/ichiban-kuji/[id]`（編輯一番賞）在比對新舊賞項之前，
 * 會先讀一次現有賞項，但那次讀取沒有檢查錯誤。讀失敗時 data 是 null，
 * 比對表變成空的，於是每一個賞項都被判定成「新的」而整批 INSERT ——
 * 整套賞項瞬間變成兩份。程式面已修（讀失敗就中止），這支負責清資料。
 *
 * 重複還會把成本灌大：抽數與總成本是照賞項加總算的，兩份賞項 → 每抽成本變兩倍。
 *
 * 清除規則（同一套組內，(prize_tier, product_id, 複選獎選項組合) 相同視為同一個賞項）：
 *   - 保留建立時間最早的那一筆（原始的，銷售紀錄也指向它）
 *   - 多出來的，只有「沒有任何銷售紀錄」而且「remaining == quantity（完全沒被抽過）」才刪
 *   - 有銷售紀錄或被抽過的一律保留，列出來讓人工判斷
 * 清完之後依照剩下的賞項重算 total_draws / total_cost / avg_cost（用目前的商品成本，
 * 跟編輯一番賞時同一套算法）。
 *
 * 用法：
 *   node fix-duplicate-kuji-prizes.mjs            # dry-run
 *   node fix-duplicate-kuji-prizes.mjs --apply    # 實際寫入
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

console.log(`=== 一番賞重複賞項清除 ${apply ? '【實際寫入】' : '（dry-run，不寫入）'} ===`)
console.log(`環境檔：${envFile}\n資料庫：${env.NEXT_PUBLIC_SUPABASE_URL}\n`)

const kujis = await all(() => db.from('ichiban_kuji').select('id, name, set_type, total_draws, total_cost, avg_cost, last_prize_product_id, is_active'))
const prizes = await all(() => db.from('ichiban_kuji_prizes').select('id, kuji_id, prize_tier, prize_name, product_id, quantity, remaining, created_at'))
const options = await all(() => db.from('ichiban_kuji_prize_options').select('id, prize_id, product_id'))
const saleItems = await all(() => db.from('sale_items').select('ichiban_kuji_prize_id').not('ichiban_kuji_prize_id', 'is', null))
const soldPrizeIds = new Set(saleItems.map((s) => s.ichiban_kuji_prize_id))

const optionsByPrize = new Map()
for (const o of options) {
  if (!optionsByPrize.has(o.prize_id)) optionsByPrize.set(o.prize_id, [])
  optionsByPrize.get(o.prize_id).push(o.product_id)
}
const prizesByKuji = new Map()
for (const p of prizes) {
  if (!prizesByKuji.has(p.kuji_id)) prizesByKuji.set(p.kuji_id, [])
  prizesByKuji.get(p.kuji_id).push(p)
}

/** 同一個賞項的識別：賞別 + 商品（複選獎則用排序後的選項組合） */
function signature(p) {
  const opts = (optionsByPrize.get(p.id) || []).slice().sort()
  return opts.length > 0
    ? `${p.prize_tier}|selection:${opts.join(',')}`
    : `${p.prize_tier}|${p.product_id || ''}|${p.prize_name || ''}`
}

const plans = []
for (const k of kujis) {
  const list = (prizesByKuji.get(k.id) || []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  const groups = new Map()
  for (const p of list) {
    const sig = signature(p)
    if (!groups.has(sig)) groups.set(sig, [])
    groups.get(sig).push(p)
  }
  const dupGroups = [...groups.entries()].filter(([, v]) => v.length > 1)
  if (dupGroups.length === 0) continue

  const toDelete = []
  const kept = []
  for (const [sig, group] of groups) {
    // 保留最早那筆
    kept.push(group[0])
    for (const extra of group.slice(1)) {
      const sold = soldPrizeIds.has(extra.id)
      const drawn = Number(extra.remaining) !== Number(extra.quantity)
      if (sold || drawn) {
        kept.push(extra)
        console.log(`  ⚠️  【${k.name}】${sig.slice(0, 40)} 的重複筆有${sold ? '銷售紀錄' : '抽過的痕跡'}，保留不刪：${extra.id}`)
      } else {
        toDelete.push(extra)
      }
    }
  }
  if (toDelete.length > 0) plans.push({ k, kept, toDelete, dupGroups: dupGroups.length })
}

if (plans.length === 0) { console.log('✅ 沒有重複的賞項。'); process.exit(0) }

// 依保留下來的賞項重算抽數與成本（跟編輯一番賞同一套算法）
const allProductIds = [...new Set(prizes.map((p) => p.product_id).filter(Boolean).concat(options.map((o) => o.product_id)).concat(kujis.map((k) => k.last_prize_product_id).filter(Boolean)))]
const products = allProductIds.length ? await all(() => db.from('products').select('id, cost').in('id', allProductIds)) : []
const costOf = new Map(products.map((p) => [p.id, Number(p.cost) || 0]))

function recompute(k, keptPrizes) {
  if (k.set_type === 'official') {
    return { totalDraws: keptPrizes.reduce((s, p) => s + Number(p.quantity), 0), totalCost: Number(k.total_cost) || 0 }
  }
  let totalDraws = 0
  let totalCost = 0
  for (const p of keptPrizes) {
    const opts = optionsByPrize.get(p.id) || []
    if (opts.length > 0) {
      const avg = opts.reduce((s, pid) => s + (costOf.get(pid) || 0), 0) / opts.length
      totalDraws += Number(p.quantity)
      totalCost += avg * Number(p.quantity)
    } else {
      totalDraws += Number(p.quantity)
      totalCost += (costOf.get(p.product_id) || 0) * Number(p.quantity)
    }
  }
  if (k.last_prize_product_id) totalCost += costOf.get(k.last_prize_product_id) || 0
  return { totalDraws, totalCost }
}

console.log(`\n${plans.length} 套有重複賞項：\n`)
for (const plan of plans) {
  const { k, kept, toDelete } = plan
  const { totalDraws, totalCost } = recompute(k, kept)
  const avgCost = totalDraws > 0 ? totalCost / totalDraws : 0
  plan.totals = { totalDraws, totalCost: money(totalCost), avgCost: money(avgCost) }
  console.log(`【${k.name}】${k.is_active ? '啟用' : '停用'}`)
  console.log(`  賞項 ${kept.length + toDelete.length} 筆 → 要刪 ${toDelete.length} 筆重複，保留 ${kept.length} 筆`)
  console.log(`  抽數   ${k.total_draws} → ${totalDraws}`)
  console.log(`  總成本 ${money(k.total_cost)} → ${money(totalCost)}`)
  console.log(`  每抽成本 ${money(k.avg_cost)} → ${money(avgCost)}`)
}

if (!apply) { console.log('\n(dry-run，沒有寫入任何資料。要實際執行請加 --apply)'); process.exit(0) }

console.log('\n寫入中...')
for (const plan of plans) {
  const { k, toDelete, totals } = plan
  const ids = toDelete.map((p) => p.id)
  const { error: delErr } = await db.from('ichiban_kuji_prizes').delete().in('id', ids)
  if (delErr) { console.error(`  ❌ 【${k.name}】刪除重複賞項失敗：${delErr.message}`); continue }

  const { error: updErr } = await db.from('ichiban_kuji').update({
    total_draws: totals.totalDraws,
    total_cost: totals.totalCost,
    avg_cost: totals.avgCost,
  }).eq('id', k.id)
  if (updErr) { console.error(`  ⚠️  【${k.name}】重複賞項已刪，但抽數／成本更新失敗：${updErr.message}`); continue }

  console.log(`  ✅ 【${k.name}】刪除 ${ids.length} 筆重複，抽數=${totals.totalDraws} 每抽成本=${totals.avgCost}`)
}

console.log('\n驗證：')
const prizes2 = await all(() => db.from('ichiban_kuji_prizes').select('id, kuji_id, prize_tier, product_id, prize_name'))
const options2 = await all(() => db.from('ichiban_kuji_prize_options').select('prize_id, product_id'))
const optMap2 = new Map()
for (const o of options2) {
  if (!optMap2.has(o.prize_id)) optMap2.set(o.prize_id, [])
  optMap2.get(o.prize_id).push(o.product_id)
}
let remaining = 0
const byKuji2 = new Map()
for (const p of prizes2) {
  if (!byKuji2.has(p.kuji_id)) byKuji2.set(p.kuji_id, [])
  byKuji2.get(p.kuji_id).push(p)
}
for (const [, list] of byKuji2) {
  const seen = new Set()
  for (const p of list) {
    const opts = (optMap2.get(p.id) || []).slice().sort()
    const sig = opts.length > 0 ? `${p.prize_tier}|selection:${opts.join(',')}` : `${p.prize_tier}|${p.product_id || ''}|${p.prize_name || ''}`
    if (seen.has(sig)) remaining += 1
    seen.add(sig)
  }
}
console.log(`  仍有重複的賞項：${remaining} 筆`)
if (remaining === 0) console.log('  ✅ 沒有重複賞項了。')
