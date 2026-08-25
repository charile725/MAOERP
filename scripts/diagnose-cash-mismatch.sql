-- =====================================================
-- 診斷查詢：確認資料結構
-- =====================================================

-- 1. 查看所有帳戶，確認現金帳戶的識別方式
SELECT id, account_name, account_type, payment_method_code
FROM accounts
WHERE is_active = true
ORDER BY sort_order;


-- 2. 查看現金帳戶的交易明細（最近 20 筆）
SELECT
  at.id,
  a.account_name,
  at.transaction_type,
  at.ref_type,
  at.ref_id,
  at.ref_no,
  at.amount,
  at.note,
  at.created_at
FROM account_transactions at
JOIN accounts a ON at.account_id = a.id
WHERE a.payment_method_code = 'cash' OR a.account_type = 'cash'
ORDER BY at.created_at DESC
LIMIT 20;


-- 3. 查看現金帳戶中 ref_type = 'sale' 的交易，並顯示對應銷貨單的付款方式
SELECT
  at.ref_no AS "交易單號",
  at.ref_type,
  at.ref_id,
  s.sale_no AS "銷貨單號",
  s.payment_method AS "銷貨付款方式",
  at.amount AS "交易金額",
  s.total AS "銷貨總額",
  at.created_at
FROM account_transactions at
JOIN accounts a ON at.account_id = a.id
LEFT JOIN sales s ON at.ref_id::uuid = s.id
WHERE (a.payment_method_code = 'cash' OR a.account_type = 'cash')
  AND at.ref_type = 'sale'
ORDER BY at.created_at DESC
LIMIT 30;


-- 4. 查看所有 ref_type 的種類
SELECT DISTINCT ref_type, transaction_type, COUNT(*)
FROM account_transactions
GROUP BY ref_type, transaction_type
ORDER BY COUNT(*) DESC;


-- 5. 直接查：現金帳戶的銷售交易中，對應銷貨單的付款方式分布
SELECT
  s.payment_method AS "銷貨付款方式",
  COUNT(*) AS "筆數",
  SUM(at.amount) AS "總金額"
FROM account_transactions at
JOIN accounts a ON at.account_id = a.id
JOIN sales s ON at.ref_id::uuid = s.id
WHERE (a.payment_method_code = 'cash' OR a.account_type = 'cash')
  AND at.transaction_type = 'sale'
GROUP BY s.payment_method
ORDER BY COUNT(*) DESC;
