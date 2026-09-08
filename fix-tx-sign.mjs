/**
 * 修正 account_transactions.amount 的正負號（唯讀 dry-run，--apply 才寫入）
 *
 * 慣例：流入記正數、流出記負數（判斷依據是 balance_after - balance_before）。
 * 資料庫端寫入的費用交易本來就是負數，但走 updateAccountBalance 的路徑舊版一律寫正數，
 * 所以「編輯過的費用」會變成正數，跟同類交易的寫法相反，加總 amount 的報表就會算錯。
 * 這支只改 amount 欄位，不動 balance_before / balance_after，也不動帳戶餘額。
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const apply = process.argv.includes('--apply')
const env={};for(const l of readFileSync('.env.local','utf8').split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith('#'))continue;const i=t.indexOf('=');if(i<0)continue;env[t.slice(0,i).trim()]=t.slice(i+1).trim().replace(/^["']|["']$/g,'')}
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY)
const PAGE=1000
async function all(b){const r=[];for(let f=0;;f+=PAGE){const{data,error}=await b().range(f,f+PAGE-1);if(error)throw new Error(error.message);r.push(...(data||[]));if(!data||data.length<PAGE)return r}}
const {data:accts}=await db.from('accounts').select('id,account_name')
const A=new Map(accts.map(a=>[a.id,a.account_name]))
const tx=await all(()=>db.from('account_transactions').select('id,account_id,transaction_type,ref_type,ref_no,amount,balance_before,balance_after,created_at,note'))
const bad=tx.filter(t=>{const d=Number(t.balance_after)-Number(t.balance_before);return Math.abs(d-Number(t.amount))>0.01})
console.log(`=== amount 正負號修正 ${apply?'【實際寫入】':'（dry-run）'} ===`)
console.log(`帳戶交易共 ${tx.length} 筆，amount 與餘額變化不一致的 ${bad.length} 筆：\n`)
for(const t of bad) console.log(`  ${String(t.created_at).slice(0,19)}  ${String(A.get(t.account_id)).padEnd(8)} ${String(t.transaction_type).padEnd(10)} ref=${t.ref_no||''}  amount=${t.amount} → ${Number(t.balance_after)-Number(t.balance_before)}   ${t.note||''}`)
if(bad.length===0){console.log('✅ 全部一致。');process.exit(0)}
if(!apply){console.log('\n(dry-run，加 --apply 才寫入)');process.exit(0)}
for(const t of bad){
  const v=Number(t.balance_after)-Number(t.balance_before)
  const {error}=await db.from('account_transactions').update({amount:v}).eq('id',t.id)
  console.log(error?`  ❌ ${t.id}: ${error.message}`:`  ✅ ${t.ref_no||t.id} amount ${t.amount} → ${v}`)
}
const after=await all(()=>db.from('account_transactions').select('amount,balance_before,balance_after'))
const still=after.filter(t=>Math.abs((Number(t.balance_after)-Number(t.balance_before))-Number(t.amount))>0.01)
console.log(`\n驗證：仍不一致 ${still.length} 筆`)
