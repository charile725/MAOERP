import { z } from 'zod'

// Product schemas
export const productSchema = z.object({
  item_code: z.string().optional(),
  name: z.string().min(1, 'Name is required'),
  barcode: z.string().optional().nullable(),
  price: z.number().min(0, 'Price must be positive').default(0),
  cost: z.number().min(0, 'Cost must be positive').default(0),
  unit: z.string().default('件'),
  tags: z.array(z.string()).default([]),
  stock: z.number().min(0, 'Stock cannot be negative').default(0),
  allow_negative: z.boolean().default(true),
  is_active: z.boolean().default(true),
})

// Update schema excludes stock (managed via inventory operations only)
export const productUpdateSchema = productSchema
  .omit({ stock: true })
  .partial()

// Customer schemas
export const customerSchema = z.object({
  customer_code: z.string().optional(),
  customer_name: z.string().min(1, 'Customer name is required'),
  phone: z.string().optional().nullable(),
  line_id: z.string().optional().nullable(),
  store_address: z.string().optional().nullable(),  // 門市地址
  delivery_address: z.string().optional().nullable(),  // 宅配地址
  payment_method: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
  store_credit: z.number().default(0),  // 购物金余额
  credit_limit: z.number().min(0, 'Credit limit must be non-negative').default(0),  // 信用额度
})

// Vendor schemas
export const vendorSchema = z.object({
  vendor_code: z.string().optional(),
  vendor_name: z.string().min(1, 'Vendor name is required'),
  contact_person: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
  payment_terms: z.string().optional().nullable(),
  bank_account: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
})

// Sale schemas
// 統一定義所有付款方式 - 新增帳戶時記得在此處加入對應的 payment_method_code
export const paymentMethodEnum = z.enum([
  'cash',
  'card',
  'transfer_cathay',
  'transfer_cathay_biz',
  'transfer_fubon',
  'transfer_esun',
  'transfer_union',
  'transfer_linepay',
  'transfer_linebank',
  'transfer_post',
  'cod',
  'pending'
])

export const saleDraftSchema = z.object({
  customer_code: z.string().optional(),
  source: z.enum(['pos', 'live', 'manual']).default('pos'),
  payment_method: paymentMethodEnum.default('cash'),
  is_paid: z.boolean().default(false),
  note: z.string().optional(),
  discount_type: z.enum(['none', 'percent', 'amount']).default('none'),
  discount_value: z.number().min(0, 'Discount must be positive').default(0),
  // Multi-payment support
  payments: z.array(
    z.object({
      method: paymentMethodEnum,
      amount: z.number().positive('Amount must be positive'),
    })
  ).optional(),
  items: z.array(
    z.object({
      product_id: z.string().uuid().optional().nullable(), // nullable for official ichiban kuji prizes
      quantity: z.number().int().positive('Quantity must be positive'),
      price: z.number().min(0, 'Price must be positive'),
      ichiban_kuji_prize_id: z.string().uuid().optional(), // 如果是從一番賞售出
      ichiban_kuji_id: z.string().uuid().optional(), // 所屬一番賞ID
      isNotDelivered: z.boolean().optional(), // 是否未出貨（支援部分出貨）
    })
  ).min(1, 'At least one item is required'),
})

export const saleUpdateSchema = z.object({
  payment_method: paymentMethodEnum
})

// Purchase schemas
export const purchaseDraftSchema = z.object({
  vendor_code: z.string().min(1, 'Vendor is required'),
  is_paid: z.boolean().default(false),
  note: z.string().optional(),
  items: z.array(
    z.object({
      product_id: z.string().uuid(),
      quantity: z.number().int().positive('Quantity must be positive'),
      cost: z.number().min(0, 'Cost must be positive'),
      subtotal: z.number().min(0).optional(), // 用戶輸入的小計（優先使用）
    })
  ).min(1, 'At least one item is required'),
})

// Settlement schemas
export const settlementSchema = z.object({
  partner_type: z.enum(['customer', 'vendor']),
  partner_code: z.string().min(1, 'Partner code is required'),
  direction: z.enum(['receipt', 'payment']),
  method: z.string().optional(),  // 動態付款方式，對應帳戶的 payment_method_code
  amount: z.number().positive('Amount must be positive'),
  note: z.string().optional(),
  account_id: z.string().uuid().optional(),  // 新增：關聯的帳戶 ID（選用，可從 method 自動解析）
  allocations: z.array(
    z.object({
      partner_account_id: z.string().uuid(),
      amount: z.number().positive('Amount must be positive'),
    })
  ).min(1, 'At least one allocation is required'),
})

// Ichiban Kuji schemas
export const ichibanKujiPrizeSchema = z.object({
  prize_tier: z.string().min(1, 'Prize tier is required'),
  product_id: z.string().uuid('Invalid product ID').optional().nullable(),
  prize_name: z.string().optional().nullable(),
  quantity: z.number().int().positive('Quantity must be positive'),
})

export const ichibanKujiComboPriceSchema = z.object({
  draws: z.number().int().positive('Draws must be positive'),
  price: z.number().min(0, 'Price must be positive'),
})

export const ichibanKujiDraftSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  barcode: z.string().optional().nullable(),
  price: z.number().min(0, 'Price must be positive'),
  set_type: z.enum(['custom', 'official']).optional().default('custom'),
  total_cost: z.number().min(0).optional().default(0),
  prizes: z.array(ichibanKujiPrizeSchema).min(1, 'At least one prize is required'),
  combo_prices: z.array(ichibanKujiComboPriceSchema).optional().default([]),
  opening_combo_prices: z.array(ichibanKujiComboPriceSchema).optional().default([]),
})

// Account schemas
export const accountSchema = z.object({
  account_name: z.string().min(1, 'Account name is required'),
  account_type: z.enum(['cash', 'bank', 'petty_cash']),
  payment_method_code: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  sort_order: z.number().default(999),
  auto_mark_paid: z.boolean().default(false),
  balance: z.number().default(0),
  is_active: z.boolean().default(true),
})

export const accountUpdateSchema = accountSchema.partial()

// Expense schemas
export const expenseSchema = z.object({
  date: z.string().min(1, 'Date is required'), // ISO date string
  category: z.enum([
    '運費',
    '薪資支出',
    '租金支出',
    '文具用品',
    '旅費',
    '修繕費',
    '廣告費',
    '保險費',
    '交際費',
    '捐贈',
    '稅費',
    '伙食費',
    '職工福利',
    '傭金支出',
  ]),
  amount: z.number().int().positive('Amount must be positive'),
  account_id: z.string().uuid().optional().nullable(),
  note: z.string().optional(),
})

// Customer balance adjustment schemas
export const balanceAdjustmentSchema = z.object({
  customer_code: z.string().min(1, 'Customer code is required'),
  amount: z.number().refine((val) => val !== 0, 'Amount cannot be zero'),
  type: z.enum(['recharge', 'deduct', 'adjustment']),
  note: z.string().optional(),
})

// Sale correction schemas
export const saleCorrectionSchema = z.object({
  items: z.array(z.object({
    sale_item_id: z.string().uuid(),
    new_quantity: z.number().int().min(0), // 0 = 刪除該品項
    new_price: z.number().min(0).optional(),
  })),
  note: z.string().optional(),
})

// Sale to store credit schemas
export const saleToStoreCreditSchema = z.object({
  amount: z.number().positive().optional(), // 不指定則全額轉換
  refund_inventory: z.boolean().default(true), // 是否回補庫存
  note: z.string().optional(),
})

