# 官方賞邏輯整理

## 1. 資料庫 Migration

```sql
-- 新增欄位到 ichiban_kuji 表
ALTER TABLE ichiban_kuji ADD COLUMN IF NOT EXISTS set_type TEXT DEFAULT 'custom';
ALTER TABLE ichiban_kuji ADD COLUMN IF NOT EXISTS total_cost NUMERIC DEFAULT 0;
ALTER TABLE ichiban_kuji ADD COLUMN IF NOT EXISTS vendor_code TEXT;       -- 關聯廠商
ALTER TABLE ichiban_kuji ADD COLUMN IF NOT EXISTS is_received BOOLEAN DEFAULT true;  -- 收貨狀態

-- 獎品表：product_id 改為可為空（官方套不連結商品）
ALTER TABLE ichiban_kuji_prizes ALTER COLUMN product_id DROP NOT NULL;

-- 獎品表：新增 prize_name 欄位（官方套用純文字名稱）
ALTER TABLE ichiban_kuji_prizes ADD COLUMN IF NOT EXISTS prize_name TEXT;

-- 銷售/出貨明細表：product_id 也要改為可空（官方套獎品無商品）
ALTER TABLE sale_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE delivery_items ALTER COLUMN product_id DROP NOT NULL;
```

---

## 2. Zod Schema

```typescript
// lib/schemas.ts

export const ichibanKujiPrizeSchema = z.object({
  prize_tier: z.string().min(1, 'Prize tier is required'),
  product_id: z.string().uuid('Invalid product ID').optional().nullable(), // 官方套可為空
  prize_name: z.string().optional().nullable(), // 官方套用純文字
  quantity: z.number().int().positive('Quantity must be positive'),
})

export const ichibanKujiDraftSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  barcode: z.string().optional().nullable(),
  price: z.number().min(0, 'Price must be positive'),
  set_type: z.enum(['custom', 'official']).optional().default('custom'),
  total_cost: z.number().min(0).optional().default(0),  // 官方套整套成本
  vendor_code: z.string().optional().nullable(),         // 官方套廠商
  prizes: z.array(ichibanKujiPrizeSchema).min(1, 'At least one prize is required'),
  combo_prices: z.array(ichibanKujiComboPriceSchema).optional().default([]),
})
```

---

## 3. API 邏輯

### POST /api/ichiban-kuji (建立)

```typescript
const draft = validation.data
const isOfficial = draft.set_type === 'official'

// 官方套必須選擇廠商
if (isOfficial && !draft.vendor_code) {
  return NextResponse.json(
    { ok: false, error: '官方套必須選擇廠商' },
    { status: 400 }
  )
}

// 計算成本
let totalDraws = 0
let totalCost = 0

if (isOfficial) {
  // 官方套：成本來自使用者輸入
  totalDraws = draft.prizes.reduce((sum, p) => sum + p.quantity, 0)
  totalCost = draft.total_cost || 0
} else {
  // 自製套：成本從各商品計算
  const productIds = draft.prizes.map(p => p.product_id).filter(Boolean)
  const { data: products } = await supabase
    .from('products')
    .select('id, cost')
    .in('id', productIds)

  const productCostMap = new Map(products?.map(p => [p.id, p.cost]) || [])

  for (const prize of draft.prizes) {
    const cost = productCostMap.get(prize.product_id) || 0
    totalDraws += prize.quantity
    totalCost += cost * prize.quantity
  }
}

const avgCost = totalDraws > 0 ? totalCost / totalDraws : 0

// 建立一番賞
const insertData: any = {
  name: draft.name,
  barcode: draft.barcode || null,
  price: draft.price,
  total_draws: totalDraws,
  avg_cost: avgCost,
  set_type: draft.set_type || 'custom',
  total_cost: totalCost,
  combo_prices: draft.combo_prices || [],
}

// 官方套：設定廠商、未收貨、未啟用
if (isOfficial) {
  insertData.vendor_code = draft.vendor_code
  insertData.is_received = false
  insertData.is_active = false
}

const { data: kuji } = await supabase
  .from('ichiban_kuji')
  .insert(insertData)
  .select()
  .single()

// 建立獎品
const prizeInserts = draft.prizes.map(prize => ({
  kuji_id: kuji.id,
  prize_tier: prize.prize_tier,
  prize_name: prize.prize_name || null,        // 官方套用純文字
  product_id: isOfficial ? null : prize.product_id,  // 官方套不連結商品
  quantity: prize.quantity,
  remaining: prize.quantity,
}))

await supabase.from('ichiban_kuji_prizes').insert(prizeInserts)

// 官方套：建立應付帳款（AP）
if (isOfficial && draft.vendor_code && totalCost > 0) {
  await supabase.from('partner_accounts').insert({
    partner_type: 'vendor',
    partner_code: draft.vendor_code,
    direction: 'AP',
    ref_type: 'ichiban_kuji',
    ref_id: kuji.id,
    amount: totalCost,
    received_paid: 0,
    due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    status: 'unpaid',
  })
}
```

### PATCH /api/ichiban-kuji/:id (啟用/收貨)

```typescript
// 處理啟用/停用
if (typeof body.is_active === 'boolean') {
  // 啟用時檢查：官方套未收貨不給啟用
  if (body.is_active && kuji.is_received === false) {
    return NextResponse.json(
      { ok: false, error: '尚未收貨，無法啟用' },
      { status: 400 }
    )
  }
  updateData.is_active = body.is_active
}

// 處理收貨確認
if (typeof body.is_received === 'boolean') {
  updateData.is_received = body.is_received
}
```

---

## 4. 前端邏輯

### 類型定義

```typescript
type SetType = 'custom' | 'official'

type IchibanKuji = {
  id: string
  name: string
  total_draws: number
  avg_cost: number
  price?: number
  is_active: boolean
  is_received?: boolean           // 官方套收貨狀態
  vendor_code?: string | null     // 官方套廠商
  set_type?: 'custom' | 'official'
  total_cost?: number             // 官方套整套成本
  // ...
}
```

### 新增頁面 (new/page.tsx)

```tsx
const isOfficial = setType === 'official'

// 切換類型時重置
const handleSetTypeChange = (newType: SetType) => {
  setSetType(newType)
  setPrizes([])
  setTotalCost('')
  setVendorCode('')
}

// 計算統計
const calculateStats = () => {
  let totalDraws = 0
  let computedTotalCost = 0

  if (isOfficial) {
    totalDraws = prizes.reduce((sum, p) => sum + p.quantity, 0)
    computedTotalCost = parseFloat(totalCost) || 0
  } else {
    prizes.forEach(prize => {
      if (prize.product) {
        totalDraws += prize.quantity
        computedTotalCost += prize.product.cost * prize.quantity
      }
    })
  }

  const avgCost = totalDraws > 0 ? computedTotalCost / totalDraws : 0
  return { totalDraws, totalCost: computedTotalCost, avgCost }
}

// 提交驗證
if (isOfficial) {
  if (!totalCost || isNaN(parseFloat(totalCost)) || parseFloat(totalCost) < 0) {
    setError('請輸入正確的整套成本')
    return
  }
  if (!vendorCode) {
    setError('官方套必須選擇廠商')
    return
  }
}

// 獎品驗證：自製套需要選商品，官方套不需要
if (!isOfficial && !prize.product_id) {
  setError(`第 ${i + 1} 個賞項：請選擇商品`)
  return
}
```

### UI 切換按鈕

```tsx
{/* 套組類型切換 */}
<div className="flex gap-2">
  <button
    type="button"
    onClick={() => handleSetTypeChange('custom')}
    className={setType === 'custom' ? 'bg-blue-600 text-white' : 'bg-gray-200'}
  >
    自製套
  </button>
  <button
    type="button"
    onClick={() => handleSetTypeChange('official')}
    className={setType === 'official' ? 'bg-orange-600 text-white' : 'bg-gray-200'}
  >
    官方套
  </button>
</div>

{/* 官方套額外欄位 */}
{isOfficial && (
  <div className="grid grid-cols-2 gap-4">
    <div>
      <label>整套成本 *</label>
      <input
        type="number"
        value={totalCost}
        onChange={(e) => setTotalCost(e.target.value)}
      />
    </div>
    <div>
      <label>廠商 *</label>
      <select value={vendorCode} onChange={(e) => setVendorCode(e.target.value)}>
        <option value="">-- 選擇廠商 --</option>
        {vendors.map((v) => (
          <option key={v.vendor_code} value={v.vendor_code}>
            {v.vendor_name}
          </option>
        ))}
      </select>
    </div>
  </div>
)}
```

### 獎品表格（官方套 vs 自製套）

```tsx
{isOfficial ? (
  /* 官方套：只需賞別、名稱、數量 */
  <table>
    <thead>
      <tr>
        <th>賞別 *</th>
        <th>商品名稱</th>
        <th>數量 *</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      {prizes.map((prize, index) => (
        <tr key={index}>
          <td>
            <input value={prize.prize_tier} onChange={...} placeholder="A賞" />
          </td>
          <td>
            <input value={prize.prize_name || ''} onChange={...} placeholder="角色公仔" />
          </td>
          <td>
            <input type="number" value={prize.quantity} onChange={...} />
          </td>
          <td>
            <button onClick={() => removePrize(index)}>✕</button>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
) : (
  /* 自製套：需要選擇商品，顯示成本 */
  <table>
    <thead>
      <tr>
        <th>賞別 *</th>
        <th>商品 *</th>
        <th>數量 *</th>
        <th>單位成本</th>
        <th>小計</th>
        <th>操作</th>
      </tr>
    </thead>
    {/* ... 商品搜尋選擇邏輯 */}
  </table>
)}
```

### 列表頁狀態顯示

```tsx
{/* 類型標籤 */}
{kuji.set_type === 'official' ? (
  <span className="bg-orange-100 text-orange-800">官方</span>
) : (
  <span className="bg-blue-100 text-blue-800">自製</span>
)}

{/* 收貨狀態（僅官方套顯示） */}
{kuji.set_type === 'official' && (
  <span className={kuji.is_received === false ? 'bg-yellow-100' : 'bg-teal-100'}>
    {kuji.is_received === false ? '未收貨' : '已收貨'}
  </span>
)}

{/* 啟用按鈕：官方套未收貨時禁用 */}
<button
  onClick={() => handleToggleActive(kuji)}
  disabled={kuji.set_type === 'official' && kuji.is_received === false && !kuji.is_active}
  title={kuji.set_type === 'official' && kuji.is_received === false ? '尚未收貨，無法啟用' : ''}
>
  {kuji.is_active ? '停用' : '啟用'}
</button>

{/* 收貨按鈕（僅官方套未收貨時顯示） */}
{kuji.set_type === 'official' && kuji.is_received === false && (
  <button onClick={() => handleMarkReceived(kuji)}>
    標記收貨
  </button>
)}
```

---

## 5. 官方套 vs 自製套 差異總結

| 項目 | 自製套 (custom) | 官方套 (official) |
|------|----------------|------------------|
| 獎品商品 | 必須連結 product | 不連結，用 prize_name |
| 成本計算 | 從各商品成本加總 | 手動輸入整套成本 |
| 廠商 | 不需要 | 必須選擇 |
| 收貨狀態 | 無 | is_received (預設 false) |
| 初始狀態 | is_active = true | is_active = false |
| 啟用條件 | 無限制 | 必須先標記收貨 |
| 應付帳款 | 無 | 自動建立 AP |
| product_id | 必填 | null |

---

## 6. 如果不需要 AP (應付帳款)

如果目標網站沒有應付帳款系統，移除這段：

```typescript
// 移除這段
if (isOfficial && draft.vendor_code && totalCost > 0) {
  await supabase.from('partner_accounts').insert({...})
}
```

也可以移除 `vendor_code` 欄位，簡化為只有 `set_type`、`total_cost`、`is_received`。
