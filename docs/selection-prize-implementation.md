# 一番賞複選獎（Selection Prize）完整實作參考

## 概念

自製一番賞的某些獎項（如 A賞）支援「N 選 1」——客人抽到後從多個商品選項中挑一個。
- 成本計算：所有選項的**平均成本** × 數量
- 選項會**消耗**（選過就從池中移除）
- POS 結帳時跳出**選擇介面**

附加功能：**廢套復活**——廢套結算後可反轉費用、重新啟用。

---

## 1. DB Migration

```sql
-- 一番賞複選獎選項表
-- 每列 = 一個可選商品選項。例：A賞有 5 個商品選項 → 5 列
-- prize.quantity 控制可抽幾次，選項池是候選，quantity <= 選項數
CREATE TABLE ichiban_kuji_prize_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prize_id UUID NOT NULL REFERENCES ichiban_kuji_prizes(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  is_consumed BOOLEAN NOT NULL DEFAULT false,
  consumed_sale_item_id UUID REFERENCES sale_items(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_prize_options_prize_id ON ichiban_kuji_prize_options(prize_id);
```

**判斷方式**：prize 有 options 列 → 複選獎。不改 `ichiban_kuji_prizes` 表結構。

---

## 2. Zod Schema 變更

### `lib/schemas.ts`

```ts
// 一番賞賞項 schema — 新增 selection_product_ids
export const ichibanKujiPrizeSchema = z.object({
  prize_tier: z.string().min(1, 'Prize tier is required'),
  product_id: z.string().uuid('Invalid product ID').optional().nullable(),
  prize_name: z.string().optional().nullable(),
  quantity: z.number().int().positive('Quantity must be positive'),
  selection_product_ids: z.array(z.string().uuid()).optional().nullable(), // ← 新增
})

// 銷售 item schema — 新增 selection_option_id
// 在 saleDraftSchema.items 裡加入：
selection_option_id: z.string().uuid().optional(), // 複選獎：選中的選項ID
```

---

## 3. API — 建立一番賞 (POST /api/ichiban-kuji)

### 3.1 SELECT 查詢加入 options

```ts
// GET 查詢時 join options
ichiban_kuji_prize_options (
  id,
  product_id,
  is_consumed,
  products (
    id,
    name,
    item_code,
    cost
  )
)
```

### 3.2 成本計算：蒐集 productIds 含複選獎

```ts
// 蒐集所有 product IDs（含複選獎選項）
const productIds = draft.prizes.map(p => p.product_id).filter(Boolean) as string[]
for (const prize of draft.prizes) {
  if (prize.selection_product_ids && prize.selection_product_ids.length > 0) {
    productIds.push(...prize.selection_product_ids)
  }
}

// 查詢商品成本
const { data: productsData } = await (supabaseServer.from('products') as any)
  .select('id, cost')
  .in('id', [...new Set(productIds)])
const productCostMap = new Map(productsData?.map((p: any) => [p.id, p.cost || 0]) || [])

// 計算成本
for (const prize of draft.prizes) {
  if (prize.selection_product_ids && prize.selection_product_ids.length > 0) {
    // 複選獎：平均選項成本 × 數量
    const optionCosts = prize.selection_product_ids.map(pid => productCostMap.get(pid) || 0)
    const avgOptionCost = optionCosts.reduce((a, b) => a + b, 0) / optionCosts.length
    totalDraws += prize.quantity
    totalCost += avgOptionCost * prize.quantity
  } else {
    // 普通獎
    const cost = productCostMap.get(prize.product_id) || 0
    totalDraws += prize.quantity
    totalCost += cost * prize.quantity
  }
}
```

### 3.3 Prize insert：複選獎 product_id = null

```ts
const prizeInserts = draft.prizes.map(prize => {
  const isSelection = !isOfficial && prize.selection_product_ids && prize.selection_product_ids.length > 0
  return {
    kuji_id: kuji.id,
    prize_tier: prize.prize_tier,
    prize_name: prize.prize_name || null,
    product_id: isOfficial ? null : (isSelection ? null : prize.product_id),
    quantity: prize.quantity,
    remaining: prize.quantity,
  }
})

// .select('id, prize_tier') 拿回 id 以便後續插入 options
const { data: insertedPrizes } = await (supabaseServer.from('ichiban_kuji_prizes') as any)
  .insert(prizeInserts)
  .select('id, prize_tier')
```

### 3.4 插入 prize options

```ts
const optionInserts: any[] = []
for (let i = 0; i < draft.prizes.length; i++) {
  const prize = draft.prizes[i]
  if (!isOfficial && prize.selection_product_ids && prize.selection_product_ids.length > 0) {
    const insertedPrize = insertedPrizes[i]
    for (const productId of prize.selection_product_ids) {
      optionInserts.push({
        prize_id: insertedPrize.id,
        product_id: productId,
      })
    }
  }
}

if (optionInserts.length > 0) {
  await (supabaseServer.from('ichiban_kuji_prize_options') as any)
    .insert(optionInserts)
}
```

---

## 4. API — 更新一番賞 (PUT /api/ichiban-kuji/[id])

### 4.1 GET 查詢加入 consumed_sale_item_id

```ts
ichiban_kuji_prize_options (
  id,
  product_id,
  is_consumed,
  consumed_sale_item_id,  // ← 比 list 多這個
  products ( id, name, item_code, cost )
)
```

### 4.2 讀取舊的 options

```ts
const oldPrizeIds = oldPrizes?.map((p: any) => p.id) || []
let oldOptionsMap = new Map<string, any[]>()
if (oldPrizeIds.length > 0) {
  const { data: oldOptions } = await (supabaseServer
    .from('ichiban_kuji_prize_options') as any)
    .select('id, prize_id, product_id, is_consumed')
    .in('prize_id', oldPrizeIds)

  if (oldOptions) {
    for (const opt of oldOptions) {
      const arr = oldOptionsMap.get(opt.prize_id) || []
      arr.push(opt)
      oldOptionsMap.set(opt.prize_id, arr)
    }
  }
}
```

### 4.3 Key mapping：複選獎用 `_selection` 作 key

```ts
// 舊 prizes map
for (const prize of oldPrizes) {
  const hasOptions = (oldOptionsMap.get(prize.id) || []).length > 0
  const key = isOfficial
    ? prize.prize_tier
    : hasOptions
      ? `${prize.prize_tier}_selection`
      : `${prize.prize_tier}_${prize.product_id}`
  oldPrizesMap.set(key, prize)
}

// 新 prizes map
for (const prize of draft.prizes) {
  const isSelection = !isOfficial && prize.selection_product_ids && prize.selection_product_ids.length > 0
  const key = isOfficial
    ? prize.prize_tier
    : isSelection
      ? `${prize.prize_tier}_selection`
      : `${prize.prize_tier}_${prize.product_id}`
  newPrizesMap.set(key, prize)
}
```

### 4.4 更新 options：新增/刪除/保護已消耗

```ts
if (oldPrize && !isOfficial && newPrize.selection_product_ids && newPrize.selection_product_ids.length > 0) {
  const existingOptions = oldOptionsMap.get(oldPrize.id) || []
  const existingProductIds = new Set(existingOptions.map((o: any) => o.product_id))
  const newProductIds = new Set(newPrize.selection_product_ids as string[])

  // 新增不存在的選項
  const toAdd = [...newProductIds].filter(pid => !existingProductIds.has(pid))
  if (toAdd.length > 0) {
    await (supabaseServer.from('ichiban_kuji_prize_options') as any)
      .insert(toAdd.map(pid => ({ prize_id: oldPrize.id, product_id: pid })))
  }

  // 刪除不再需要且未消耗的選項
  const toRemove = existingOptions.filter(
    (o: any) => !newProductIds.has(o.product_id) && !o.is_consumed
  )
  if (toRemove.length > 0) {
    await (supabaseServer.from('ichiban_kuji_prize_options') as any)
      .delete()
      .in('id', toRemove.map((o: any) => o.id))
  }

  // 已消耗的選項不能刪除（log warning）
  const consumedButRemoved = existingOptions.filter(
    (o: any) => !newProductIds.has(o.product_id) && o.is_consumed
  )
  if (consumedButRemoved.length > 0) {
    console.warn(`Cannot remove consumed options`)
  }
}
```

### 4.5 新 prize 時也插入 options

```ts
// 不存在的 prize → INSERT
const isSelection = !isOfficial && newPrize.selection_product_ids && newPrize.selection_product_ids.length > 0
const { data: insertedPrize } = await (supabaseServer
  .from('ichiban_kuji_prizes') as any)
  .insert({
    kuji_id: id,
    prize_tier: newPrize.prize_tier,
    product_id: isSelection ? null : newPrize.product_id,
    quantity: newPrize.quantity,
    remaining: newPrize.quantity,
  })
  .select('id')
  .single()

// 插入複選獎選項
if (isSelection && insertedPrize) {
  await (supabaseServer.from('ichiban_kuji_prize_options') as any)
    .insert(newPrize.selection_product_ids.map((pid: string) => ({
      prize_id: insertedPrize.id,
      product_id: pid,
    })))
}
```

---

## 5. API — 銷售 (POST /api/sales)

### 5.1 驗證 selection_option_id

```ts
// 建立 optionMap 以便後續使用
const optionMap = new Map<string, any>()
for (const item of draft.items) {
  if (item.selection_option_id) {
    const { data: option, error: optErr } = await (supabaseServer
      .from('ichiban_kuji_prize_options') as any)
      .select('id, prize_id, product_id, is_consumed, products(id, name, item_code, cost)')
      .eq('id', item.selection_option_id)
      .single()

    if (optErr || !option) {
      return NextResponse.json({ ok: false, error: '找不到複選獎選項' }, { status: 400 })
    }
    if (option.is_consumed) {
      return NextResponse.json({ ok: false, error: '複選獎選項已被使用' }, { status: 400 })
    }
    optionMap.set(item.selection_option_id, option)
  }
}
```

### 5.2 建立 sale_item 時用 option 的 product

```ts
if (item.selection_option_id) {
  const option = optionMap.get(item.selection_option_id)
  const optProduct = option?.products
  // sale_item.product_id = 選項的 product_id
  // snapshot 包含 prize tier + option product name
}
```

### 5.3 標記 option 已消耗

```ts
if (item.selection_option_id && insertedItem) {
  await (supabaseServer.from('ichiban_kuji_prize_options') as any)
    .update({
      is_consumed: true,
      consumed_sale_item_id: insertedItem.id,
    })
    .eq('id', item.selection_option_id)
}
```

---

## 6. API — 銷貨更正 + 轉購物金（釋放 option）

### 6.1 銷貨更正 (correction/route.ts)

在刪除品項時（`new_quantity === 0`），釋放消耗的選項：

```ts
if (adjustment.new_quantity === 0) {
  // 釋放一番賞複選獎選項（如果有的話）
  await (supabaseServer.from('ichiban_kuji_prize_options') as any)
    .update({ is_consumed: false, consumed_sale_item_id: null })
    .eq('consumed_sale_item_id', adjustment.sale_item_id)

  // 刪除該品項
  await (supabaseServer.from('sale_items') as any)
    .delete()
    .eq('id', adjustment.sale_item_id)
}
```

### 6.2 轉購物金 (to-store-credit/route.ts)

在轉換前釋放選項：

```ts
// 釋放一番賞複選獎選項（如果有的話）
await (supabaseServer.from('ichiban_kuji_prize_options') as any)
  .update({ is_consumed: false, consumed_sale_item_id: null })
  .eq('consumed_sale_item_id', saleItemId)
```

---

## 7. API — 廢套結算 (close-set/route.ts)

### 7.1 查詢加入 options

```ts
ichiban_kuji_prizes (
  id, prize_tier, product_id, quantity, remaining,
  products ( id, name, item_code, cost ),
  ichiban_kuji_prize_options (
    id, product_id, is_consumed,
    products ( id, name, cost )
  )
)
```

### 7.2 複選獎成本 = 已消耗選項的實際成本加總

```ts
for (const prize of prizes) {
  const drawn = prize.quantity - prize.remaining
  const options = prize.ichiban_kuji_prize_options || []
  const isSelection = options.length > 0

  let drawnCost: number
  let unitCost: number

  if (isSelection) {
    // 複選獎：從已消耗選項的實際商品成本加總
    const consumedOptions = options.filter((o: any) => o.is_consumed)
    drawnCost = consumedOptions.reduce((sum: number, o: any) => sum + (o.products?.cost || 0), 0)
    unitCost = drawn > 0 ? Math.round(drawnCost / drawn) : 0
  } else {
    unitCost = prize.products?.cost || 0
    drawnCost = drawn * unitCost
  }

  totalDrawsSold += drawn
  actualCostOfDrawn += drawnCost
}
```

---

## 8. API — 廢套復活 (reactivate/route.ts) [完整檔案]

```ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { updateAccountBalance } from '@/lib/account-service'

// POST /api/ichiban-kuji/:id/reactivate
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params

    // 1. 讀取一番賞（必須是自製套 + 已停用）
    const { data: kuji } = await (supabaseServer.from('ichiban_kuji') as any)
      .select('*').eq('id', id).single()
    if (!kuji) return NextResponse.json({ ok: false, error: '找不到一番賞' }, { status: 404 })
    if (kuji.set_type !== 'custom') return NextResponse.json({ ok: false, error: '僅自製套可復活' }, { status: 400 })
    if (kuji.is_active) return NextResponse.json({ ok: false, error: '此一番賞已啟用中' }, { status: 400 })

    // 2. 找到廢套結算產生的費用記錄
    const notePrefix = `一番賞廢套結算：${kuji.name}`
    const { data: expenses } = await (supabaseServer.from('expenses') as any)
      .select('id, amount, account_id')
      .eq('category', '一番賞結損')
      .like('note', `${notePrefix}%`)
      .order('created_at', { ascending: false })
      .limit(1)

    const expense = expenses?.[0]

    if (expense) {
      // 3. 反轉帳戶餘額
      if (expense.account_id && expense.amount > 0) {
        await updateAccountBalance({
          supabase: supabaseServer,
          accountId: expense.account_id,
          amount: expense.amount,
          direction: 'increase',
          transactionType: 'adjustment',
          referenceId: expense.id.toString(),
          note: `一番賞復活回補：${kuji.name}`,
        })
      }

      // 4. 刪除費用記錄
      await (supabaseServer.from('expenses') as any).delete().eq('id', expense.id)
    }

    // 5. 重新啟用
    await (supabaseServer.from('ichiban_kuji') as any)
      .update({ is_active: true }).eq('id', id)

    return NextResponse.json({
      ok: true,
      data: {
        kuji_id: id,
        expense_reversed: !!expense,
        amount_reversed: expense?.amount || 0,
      }
    })
  } catch (error) {
    return NextResponse.json({ ok: false, error: '系統錯誤' }, { status: 500 })
  }
}
```

---

## 9. 前端 — 新增/編輯頁 (new/page.tsx + edit/page.tsx)

### 9.1 Prize 型別擴充

```ts
type Prize = {
  prize_tier: string
  product_id: string
  product?: Product | null
  prize_name?: string
  quantity: number
  is_selection: boolean          // ← 新增
  selection_products: Product[]  // ← 新增
}
```

### 9.2 State

```ts
const [selectionSearchInputs, setSelectionSearchInputs] = useState<{ [key: number]: string }>({})
const [selectionSearchResults, setSelectionSearchResults] = useState<{ [key: number]: Product[] }>({})
```

### 9.3 核心函式

```ts
// 切換複選模式
const toggleSelection = (index: number) => {
  const updated = [...prizes]
  updated[index] = {
    ...updated[index],
    is_selection: !updated[index].is_selection,
    product_id: !updated[index].is_selection ? '' : updated[index].product_id,
    product: !updated[index].is_selection ? null : updated[index].product,
    selection_products: !updated[index].is_selection ? updated[index].selection_products : [],
  }
  setPrizes(updated)
}

// 搜尋（排除已選）
const searchSelectionProduct = (index: number, keyword: string) => {
  const alreadySelected = new Set(prizes[index].selection_products.map(p => p.id))
  const results = products.filter(p =>
    !alreadySelected.has(p.id) && (
      p.barcode?.toLowerCase().includes(keyword.toLowerCase()) ||
      p.name.toLowerCase().includes(keyword.toLowerCase()) ||
      p.item_code.toLowerCase().includes(keyword.toLowerCase())
    )
  ).slice(0, 8)
  setSelectionSearchResults({ ...selectionSearchResults, [index]: results })
}

// 新增/移除選項
const addSelectionProduct = (index: number, product: Product) => {
  const updated = [...prizes]
  updated[index].selection_products = [...updated[index].selection_products, product]
  setPrizes(updated)
}

const removeSelectionProduct = (prizeIndex: number, productId: string) => {
  const updated = [...prizes]
  updated[prizeIndex].selection_products = updated[prizeIndex].selection_products.filter(p => p.id !== productId)
  setPrizes(updated)
}
```

### 9.4 成本計算

```ts
if (prize.is_selection && prize.selection_products.length > 0) {
  const avgOptionCost = prize.selection_products.reduce((sum, p) => sum + p.cost, 0) / prize.selection_products.length
  totalDraws += prize.quantity
  computedTotalCost += avgOptionCost * prize.quantity
}
```

### 9.5 驗證

```ts
if (!isOfficial && prize.is_selection && prize.selection_products.length === 0) {
  setError(`複選獎至少需要一個選項`)
}
if (!isOfficial && prize.is_selection && prize.selection_products.length < prize.quantity) {
  setError(`選項數量 (${prize.selection_products.length}) 必須 >= 賞項數量 (${prize.quantity})`)
}
```

### 9.6 送出 payload

```ts
prizes: prizes.map(p => ({
  prize_tier: p.prize_tier,
  prize_name: p.prize_name || null,
  product_id: isOfficial ? null : (p.is_selection ? null : p.product_id),
  quantity: p.quantity,
  selection_product_ids: !isOfficial && p.is_selection ? p.selection_products.map(sp => sp.id) : null,
})),
```

### 9.7 Edit 頁面額外：載入現有 options

```ts
const prizesData = kuji.ichiban_kuji_prizes.map((prize: any) => {
  const options = prize.ichiban_kuji_prize_options || []
  const isSelection = options.length > 0
  return {
    ...prize,
    is_selection: isSelection,
    selection_products: isSelection
      ? options.map((opt: any) => opt.products).filter(Boolean)
      : [],
  }
})
```

### 9.8 UI（自製套賞項卡片）

```tsx
{/* 賞項卡片 — 複選模式紫色邊框 */}
<div className={`rounded-lg border p-3 ${
  prize.is_selection ? 'border-violet-300 bg-violet-50/50' : 'border-gray-200'
}`}>

  {/* 複選 toggle */}
  <label className="flex items-center gap-1.5 cursor-pointer">
    <input type="checkbox" checked={prize.is_selection} onChange={() => toggleSelection(index)} />
    <span className="text-xs text-violet-700 font-medium">複選</span>
  </label>

  {/* 成本顯示 */}
  {prize.is_selection && prize.selection_products.length > 0 && (
    <span>平均成本 {formatCurrency(avgCost)} / 小計 {formatCurrency(avgCost * prize.quantity)}</span>
  )}

  {/* 單品搜尋（非複選） */}
  {!prize.is_selection && ( <搜尋商品 input /> )}

  {/* 複選模式 */}
  {prize.is_selection && (
    <div>
      {/* 已選商品 tags（可刪除） */}
      {prize.selection_products.map(sp => (
        <span className="bg-violet-100 rounded-full px-2.5 py-1 text-xs">
          {sp.name} (${sp.cost})
          <button onClick={() => removeSelectionProduct(index, sp.id)}>×</button>
        </span>
      ))}

      {/* 搜尋新增 */}
      <input placeholder="搜尋商品加入選項..." onChange={e => searchSelectionProduct(index, e.target.value)} />

      {/* 驗證提示 */}
      {prize.selection_products.length < prize.quantity && (
        <p className="text-red-500">選項數量必須 >= 賞項數量</p>
      )}

      <p>{prize.selection_products.length} 個選項，抽到時從中選 1</p>
    </div>
  )}
</div>
```

---

## 10. 前端 — 列表頁 (page.tsx)

### 10.1 型別

```ts
type PrizeOption = {
  id: string
  product_id: string
  is_consumed: boolean
  products: Product | null
}

type Prize = {
  // ...existing
  ichiban_kuji_prize_options?: PrizeOption[]
}
```

### 10.2 展開區顯示

```tsx
const options = prize.ichiban_kuji_prize_options || []
const isSelection = options.length > 0

{isSelection ? (
  <div className="flex flex-wrap gap-1">
    {options.map(opt => (
      <span className={opt.is_consumed ? 'bg-gray-200 line-through' : 'bg-violet-50 text-violet-700'}>
        {opt.products?.name || '?'}
      </span>
    ))}
  </div>
) : (
  prize.products?.name || prize.prize_name
)}
```

### 10.3 總成本計算

```ts
kuji.ichiban_kuji_prizes.reduce((sum, prize) => {
  const options = prize.ichiban_kuji_prize_options || []
  if (options.length > 0) {
    const avgCost = options.reduce((s, o) => s + (o.products?.cost || 0), 0) / options.length
    return sum + avgCost * prize.quantity
  }
  return sum + (prize.products?.cost || 0) * prize.quantity
}, 0)
```

### 10.4 復活按鈕（dropdown menu 裡）

```tsx
{/* 復活（僅自製套 + 已停用） */}
{kuji.set_type === 'custom' && !kuji.is_active && userRole === 'admin' && (
  <button
    onClick={async () => {
      if (!confirm(`確定要復活「${kuji.name}」嗎？\n\n將反轉廢套結算的費用記錄並重新啟用。`)) return
      const res = await fetch(`/api/ichiban-kuji/${kuji.id}/reactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.ok) {
        alert(`已復活${data.data.expense_reversed ? `，已回補費用 $${data.data.amount_reversed}` : ''}`)
        fetchKujis(page)
      } else {
        alert(data.error || '復活失敗')
      }
    }}
    className="text-green-600"
  >
    復活
  </button>
)}
```

---

## 11. 前端 — POS (pos/page.tsx + pos-live/page.tsx)

兩個 POS 頁面改法完全相同。

### 11.1 CartItem 擴充

```ts
type CartItem = SaleItem & {
  // ...existing
  selectionOptionId?: string  // 複選獎：選中的選項ID
}
```

### 11.2 State

```ts
const [selectionDialog, setSelectionDialog] = useState<{
  kuji: any
  prize: any
  options: any[]
} | null>(null)
```

### 11.3 addIchibanPrize — 偵測複選獎

```ts
const addIchibanPrize = (kuji: any, prize: any) => {
  if (prize.remaining <= 0) { alert('此賞別已售完'); return }

  // 複選獎：開啟選項彈窗
  const options = prize.ichiban_kuji_prize_options || []
  if (options.length > 0) {
    const cartOptionIds = new Set(cart.filter(i => i.selectionOptionId).map(i => i.selectionOptionId))
    const availableOptions = options.filter((o: any) => !o.is_consumed && !cartOptionIds.has(o.id))
    if (availableOptions.length === 0) { alert('此複選獎已無可用選項'); return }
    setSelectionDialog({ kuji, prize, options: availableOptions })
    return
  }

  // ...普通獎原有邏輯
}
```

### 11.4 handleSelectOption — 從彈窗選項建立 cart item

```ts
const handleSelectOption = (option: any) => {
  if (!selectionDialog) return
  const { kuji, prize } = selectionDialog
  const optProduct = option.products

  const product: Product = {
    id: optProduct?.id || option.product_id,
    item_code: optProduct?.item_code || prize.prize_tier,
    name: optProduct?.name || prize.prize_name || prize.prize_tier,
    barcode: optProduct?.barcode || null,
    price: kuji.price || 0,
    cost: optProduct?.cost || 0,
    unit: optProduct?.unit || '件',
    stock: optProduct?.stock || 0,
    tags: [],
    is_active: true,
    allow_negative: true,
  }

  setCart([...cart, {
    product_id: product.id,
    quantity: 1,
    price: kuji.price || 0,
    product,
    ichiban_kuji_id: kuji.id,
    ichiban_kuji_prize_id: prize.id,
    realProductId: optProduct?.id || option.product_id,
    selectionOptionId: option.id,  // ← 關鍵
  }])

  setSelectionDialog(null)
}
```

### 11.5 結帳 payload

```ts
items: cart.map(item => ({
  // ...existing
  selection_option_id: item.selectionOptionId,  // ← 傳給 API
}))
```

### 11.6 獎品按鈕視覺

```tsx
const options = prize.ichiban_kuji_prize_options || []
const isSelection = options.length > 0

<button className={isSelection ? 'bg-gradient-to-b from-violet-500 to-violet-700' : '原有樣式'}>
  <div>
    {prize.prize_tier}
    {isSelection && <span>{options.length}選1</span>}
  </div>
  <div>{isSelection ? '複選獎' : prize.products?.name}</div>
</button>
```

### 11.7 選項彈窗

```tsx
{selectionDialog && (
  <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60">
    <div className="max-w-md rounded-xl bg-white shadow-2xl">
      <div className="border-b px-5 py-4">
        <h3>{selectionDialog.prize.prize_tier} - 選擇獎品</h3>
        <p>請從以下選項中選擇一個</p>
      </div>
      <div className="p-4 space-y-2">
        {selectionDialog.options.map((option: any) => (
          <button
            key={option.id}
            onClick={() => handleSelectOption(option)}
            className="w-full rounded-lg border-2 border-violet-200 bg-violet-50 p-4 text-left hover:border-violet-500"
          >
            <div className="font-semibold">{option.products?.name || '未知商品'}</div>
            <div className="text-sm text-gray-500">{option.products?.item_code}</div>
          </button>
        ))}
      </div>
      <div className="border-t px-5 py-3 text-right">
        <button onClick={() => setSelectionDialog(null)}>取消</button>
      </div>
    </div>
  </div>
)}
```

---

## 資料流總結

```
建立/編輯 → selection_product_ids[] → API insert ichiban_kuji_prize_options
                                                    ↓
POS 點選複選獎 → 彈窗列出未消耗 options → 選一個 → cart.selectionOptionId
                                                    ↓
結帳 → API 驗證 option 未消耗 → sale_item.product_id = option.product_id
                              → option.is_consumed = true
                              → option.consumed_sale_item_id = sale_item.id
                                                    ↓
更正/轉購物金 → option.is_consumed = false（釋放回池）
                                                    ↓
廢套結算 → 複選獎 drawnCost = 已消耗 options 的實際成本加總
         → 復活 = 刪除費用 + 回補帳戶 + is_active = true
```
