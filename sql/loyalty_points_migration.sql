-- ============================================================
-- 積分系統 Migration
-- 執行方式：在 Supabase SQL Editor 貼上執行
-- ============================================================

-- 1. customers 新增 loyalty_points（積分餘額）
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS loyalty_points INTEGER NOT NULL DEFAULT 0;

-- 2. products 新增 is_points_base 和 points_cost
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_points_base BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS points_cost INTEGER DEFAULT NULL;

-- 3. sale_items 新增積分相關欄位
ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS is_points_redemption BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS points_earned INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS points_used INTEGER NOT NULL DEFAULT 0;

-- 4. 建立 customer_points_logs 積分紀錄表
CREATE TABLE IF NOT EXISTS customer_points_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code TEXT NOT NULL REFERENCES customers(customer_code) ON DELETE CASCADE,
  amount INTEGER NOT NULL,          -- 正數=獲得，負數=使用
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('earn', 'redeem', 'refund', 'adjustment')),
  ref_type TEXT,                    -- 'sale', 'sale_delete', 'correction', 'manual'
  ref_id TEXT,
  ref_no TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. 將「積分底數」商品標記為 is_points_base
UPDATE products
  SET is_points_base = true
  WHERE name = '積分底數';

-- 確認結果
SELECT id, name, is_points_base, points_cost
  FROM products
  WHERE is_points_base = true;
