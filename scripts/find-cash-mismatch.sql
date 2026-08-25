-- =====================================================
-- 現金交易明細與銷貨記錄不匹配檢查
-- =====================================================

-- =====================================================
-- 查詢 1: 銷貨記錄 payment_method 不是 cash，但出現在現金交易明細中
-- （這是主要要找的異常情況）
-- =====================================================

WITH cash_account AS (
  SELECT id, account_name
  FROM accounts
  WHERE payment_method_code = 'cash' OR account_type = 'cash'
  LIMIT 1
)

SELECT
  '異常: 非現金銷貨出現在現金明細' AS "問題類型",
  s.sale_no AS "銷貨單號",
  s.payment_method AS "銷貨付款方式",
  a.account_name AS "交易明細帳戶",
  at.amount AS "交易金額",
  s.total AS "銷貨總額",
  s.sale_date AS "銷貨日期",
  s.is_paid AS "已付款",
  s.status AS "狀態",
  at.created_at AS "交易時間",
  at.note AS "交易備註"
FROM account_transactions at
JOIN cash_account ca ON at.account_id = ca.id
JOIN accounts a ON at.account_id = a.id
JOIN sales s ON at.ref_id::uuid = s.id
WHERE at.ref_type = 'sale'
  AND at.transaction_type = 'sale'
  AND s.payment_method != 'cash'
ORDER BY s.sale_date DESC, s.sale_no DESC;


-- =====================================================
-- 查詢 2: 統計摘要 - 各付款方式在現金明細中的出現次數
-- =====================================================

WITH cash_account AS (
  SELECT id FROM accounts
  WHERE payment_method_code = 'cash' OR account_type = 'cash'
  LIMIT 1
)

SELECT
  s.payment_method AS "銷貨付款方式",
  COUNT(*) AS "出現在現金明細的筆數",
  SUM(at.amount) AS "總金額"
FROM account_transactions at
JOIN cash_account ca ON at.account_id = ca.id
JOIN sales s ON at.ref_id::uuid = s.id
WHERE at.ref_type = 'sale'
  AND at.transaction_type = 'sale'
GROUP BY s.payment_method
ORDER BY COUNT(*) DESC;


-- =====================================================
-- 查詢 3: 交叉比對 - 銷貨的 account_id 與實際記帳帳戶不符
-- （銷貨單上記錄的帳戶 vs 實際交易明細的帳戶）
-- =====================================================

SELECT
  '帳戶不符' AS "問題類型",
  s.sale_no AS "銷貨單號",
  s.payment_method AS "付款方式",
  a_sale.account_name AS "銷貨單帳戶",
  a_trans.account_name AS "實際記帳帳戶",
  at.amount AS "交易金額",
  s.total AS "銷貨總額",
  s.sale_date AS "銷貨日期"
FROM account_transactions at
JOIN sales s ON at.ref_id::uuid = s.id AND at.ref_type = 'sale'
JOIN accounts a_trans ON at.account_id = a_trans.id
LEFT JOIN accounts a_sale ON s.account_id = a_sale.id
WHERE at.transaction_type = 'sale'
  AND (s.account_id IS NULL OR at.account_id != s.account_id)
ORDER BY s.sale_date DESC;


-- =====================================================
-- 查詢 4: 付款方式與記帳帳戶的映射關係檢查
-- =====================================================

SELECT
  s.payment_method AS "付款方式",
  a.account_name AS "記帳帳戶",
  a.payment_method_code AS "帳戶對應付款方式",
  CASE
    WHEN s.payment_method = a.payment_method_code THEN '✓ 正確'
    ELSE '✗ 不符'
  END AS "是否匹配",
  COUNT(*) AS "筆數",
  SUM(at.amount) AS "總金額"
FROM account_transactions at
JOIN sales s ON at.ref_id::uuid = s.id AND at.ref_type = 'sale'
JOIN accounts a ON at.account_id = a.id
WHERE at.transaction_type = 'sale'
GROUP BY s.payment_method, a.account_name, a.payment_method_code
ORDER BY
  CASE WHEN s.payment_method = a.payment_method_code THEN 1 ELSE 0 END,
  COUNT(*) DESC;
