// Core types
export type Product = {
  id: string
  item_code: string
  barcode?: string | null
  name: string
  unit: string
  price: number
  cost: number
  stock: number
  avg_cost: number
  allow_negative: boolean
  is_active: boolean
  tags: string[]
  image_url?: string | null
  created_at?: string
  updated_at?: string
  is_points_base?: boolean       // 積分底數：賣出一個 = 客戶獲得 1 積分
  points_cost?: number | null    // 積分兌換所需積分數（null = 不可兌換）
}

export type Customer = {
  id: string
  customer_code: string
  customer_name: string
  phone?: string | null
  line_id?: string | null
  store_address?: string | null  // 門市地址
  delivery_address?: string | null  // 宅配地址
  payment_method?: string | null
  note?: string | null
  is_active: boolean
  store_credit: number  // 购物金余额（可为负）
  credit_limit: number  // 信用额度（最大欠款）
  loyalty_points: number  // 積分餘額
}

export type Vendor = {
  id: string
  vendor_code: string
  vendor_name: string
  contact_person?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  payment_terms?: string | null
  bank_account?: string | null
  note?: string | null
  is_active: boolean
}

export type SaleItem = {
  product_id: string
  quantity: number
  price: number
}

export type PaymentMethod =
  | 'cash'
  | 'card'
  | 'transfer_cathay'
  | 'transfer_cathay_biz'
  | 'transfer_fubon'
  | 'transfer_esun'
  | 'transfer_union'
  | 'transfer_linepay'
  | 'transfer_linebank'
  | 'transfer_post'
  | 'transfer_sunny'
  | 'transfer_ctbc'
  | 'cod'
  | 'pending'

export type SaleDraft = {
  customer_code?: string
  source: 'pos' | 'live' | 'manual'
  payment_method: PaymentMethod
  is_paid: boolean
  items: SaleItem[]
  note?: string
  discount_type?: 'none' | 'percent' | 'amount'
  discount_value?: number
}

export type PurchaseItem = {
  product_id: string
  quantity: number
  cost: number
}

export type PurchaseDraft = {
  vendor_code: string
  items: PurchaseItem[]
  note?: string
}

// Ichiban Kuji types
export type IchibanKujiPrize = {
  id?: string
  prize_tier: string
  product_id: string
  quantity: number
}

export type IchibanKuji = {
  id: string
  name: string
  total_draws: number
  avg_cost: number
  price: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type IchibanKujiDraft = {
  name: string
  price: number
  prizes: IchibanKujiPrize[]
}

// Customer balance log types
export type BalanceLogType = 'recharge' | 'deduct' | 'sale' | 'refund' | 'adjustment'

export type CustomerBalanceLog = {
  id: string
  customer_code: string
  amount: number
  balance_before: number
  balance_after: number
  type: BalanceLogType
  ref_type?: string | null
  ref_id?: string | null
  ref_no?: string | null
  note?: string | null
  created_by?: string | null
  created_at: string
  updated_at: string
}

export type BalanceAdjustmentDraft = {
  customer_code: string
  amount: number
  type: 'recharge' | 'deduct' | 'adjustment'
  note?: string
}

// API Response types
export type ApiResponse<T = unknown> = {
  ok: boolean
  data?: T
  error?: string
}
