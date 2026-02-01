-- Migration: 修復進貨單小數點問題
-- 問題：quantity * cost 可能產生小數，應該使用 Math.round
-- 執行方式：在 Supabase SQL Editor 中執行此腳本

-- ============================================================
-- 步驟 1：修復 purchase_items 的 subtotal
-- ============================================================

-- 更新所有 purchase_items 的 subtotal 為整數
-- 如果 subtotal 是 NULL 或小數，重新計算為 ROUND(quantity * cost)
UPDATE public.purchase_items
SET subtotal = ROUND(quantity * cost)
WHERE subtotal IS NULL 
   OR subtotal != ROUND(subtotal);

-- ============================================================
-- 步驟 2：修復 purchases 的 total
-- ============================================================

-- 使用 purchase_items 的 subtotal 總和來更新 purchases.total
UPDATE public.purchases p
SET total = (
  SELECT COALESCE(SUM(ROUND(pi.subtotal)), 0)
  FROM public.purchase_items pi
  WHERE pi.purchase_id = p.id
)
WHERE EXISTS (
  SELECT 1 FROM public.purchase_items pi WHERE pi.purchase_id = p.id
);

-- ============================================================
-- 步驟 3：修復 partner_accounts (AP) 的 amount
-- ============================================================

-- 更新 AP 記錄的 amount 為整數
UPDATE public.partner_accounts pa
SET amount = ROUND(amount),
    balance = ROUND(balance)
WHERE direction = 'AP'
  AND (amount != ROUND(amount) OR balance != ROUND(balance));

-- ============================================================
-- 驗證結果
-- ============================================================

-- 檢查是否還有小數點的進貨單
SELECT id, purchase_no, total 
FROM public.purchases 
WHERE total != ROUND(total)
LIMIT 10;

-- 檢查是否還有小數點的進貨明細
SELECT id, quantity, cost, subtotal, ROUND(quantity * cost) as expected
FROM public.purchase_items 
WHERE subtotal != ROUND(subtotal) OR subtotal IS NULL
LIMIT 10;
