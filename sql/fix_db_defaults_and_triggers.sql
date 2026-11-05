-- ============================================================================
-- 資料庫端的兩個問題（2026-10-30 查證）
--
-- 這支要在 Supabase SQL Editor 執行（程式只有 PostgREST 權限，改不到 DDL）。
-- 整支可以重複執行，跑第二次不會有副作用。
--
-- 【第 1 段】timestamptz 欄位的預設值被寫成 now() + 8 小時 —— 真錯，會存到未來
--
--   account_transactions.created_at  default (now() + '08:00:00'::interval)
--   accounts.created_at              default (now() + '08:00:00'::interval)
--
--   這兩個欄位的型別是 timestamptz（存的是「時刻」），加 8 小時等於把時刻往後挪 8 小時。
--   程式自己寫入時會帶 getTaiwanTime()（真 UTC）所以是對的；
--   但費用的帳戶交易是資料庫端寫的、沒帶 created_at，就吃到這個預設值，
--   每一筆都比真實時間晚 8 小時，剛記的費用會顯示在未來。
--   （71 筆歷史資料已用 node fix-expense-tx-timestamp.mjs --apply 改正。）
--
--   注意：customers / deliveries 的 created_at 也是 now() + 8 小時，但那兩個是
--   timestamp（無時區）欄位，加 8 小時正好等於存台灣牆上時間 —— 那是本專案的慣例，
--   不要跟著改，改了畫面會反而差 8 小時。只有 timestamptz 欄位才是錯的。
--
-- 【第 2 段】動到 sale_items 就把 sales 金額重算掉的觸發器（潛在地雷，不急）
--
--   只要 insert/update/delete sale_items，就會把 sales.subtotal / sales.total
--   重算成明細加總，而且不扣 discount_amount、不扣 store_credit_used、
--   也不保留整筆加價 —— 有折扣的單 total 會被寫成未折扣的金額。
--
--   程式這邊每條路徑都已經擋好了（更正單、轉購物金都會在改完明細後把金額寫回去），
--   目前全站 1372 張單的金額都自洽。真正會中招的是「直接改 sale_items 的腳本」，
--   所以這段是把地雷拔掉，不是修現有錯誤。
--
--   這段會先把觸發器與函式的定義備份到 _dropped_trigger_backup，再移除觸發器；
--   要還原就從那張表把 trigger_def 拿出來重跑。
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 執行前：先看現在長什麼樣（跑完看 Messages / NOTICE）
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  RAISE NOTICE '=== timestamptz 欄位預設值 ===';
  FOR r IN
    SELECT c.table_name, c.column_name, c.column_default
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.data_type = 'timestamp with time zone'
      AND c.column_default LIKE '%08:00:00%'
    ORDER BY c.table_name, c.column_name
  LOOP
    RAISE NOTICE '  %.% = %', r.table_name, r.column_name, r.column_default;
  END LOOP;

  RAISE NOTICE '=== sale_items 上的觸發器 ===';
  FOR r IN
    SELECT tg.tgname, pg_get_triggerdef(tg.oid) AS tgdef
    FROM pg_trigger tg
    JOIN pg_class cl ON cl.oid = tg.tgrelid
    WHERE cl.relname = 'sale_items' AND NOT tg.tgisinternal
  LOOP
    RAISE NOTICE '  % :: %', r.tgname, r.tgdef;
  END LOOP;
END $$;


-- ---------------------------------------------------------------------------
-- 第 1 段：把兩個 timestamptz 的預設值改回 now()
-- ---------------------------------------------------------------------------
ALTER TABLE public.account_transactions ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.accounts             ALTER COLUMN created_at SET DEFAULT now();


-- ---------------------------------------------------------------------------
-- 第 2 段：移除會重算 sales 金額的 sale_items 觸發器（先備份定義）
--
-- 只會動「函式內容同時出現 update sales 和 subtotal/total」的觸發器，
-- sale_items 上其他用途的觸發器（庫存、積分等）不會被碰到。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._dropped_trigger_backup (
  id           bigserial PRIMARY KEY,
  dropped_at   timestamptz NOT NULL DEFAULT now(),
  table_name   text NOT NULL,
  trigger_name text NOT NULL,
  trigger_def  text NOT NULL,
  function_def text
);

DO $$
DECLARE
  t       record;
  dropped int := 0;
  kept    int := 0;
BEGIN
  FOR t IN
    SELECT tg.tgname           AS trigger_name,
           cl.relname          AS table_name,
           pg_get_triggerdef(tg.oid) AS trigger_def,
           pg_get_functiondef(pr.oid) AS function_def
    FROM pg_trigger tg
    JOIN pg_class cl ON cl.oid = tg.tgrelid
    JOIN pg_proc  pr ON pr.oid = tg.tgfoid
    WHERE cl.relname = 'sale_items'
      AND NOT tg.tgisinternal
  LOOP
    IF t.function_def ~* 'update[[:space:]]+(public\.)?sales'
       AND t.function_def ~* '(subtotal|total)'
    THEN
      INSERT INTO public._dropped_trigger_backup (table_name, trigger_name, trigger_def, function_def)
      VALUES (t.table_name, t.trigger_name, t.trigger_def, t.function_def);

      EXECUTE format('DROP TRIGGER %I ON public.%I', t.trigger_name, t.table_name);
      dropped := dropped + 1;
      RAISE NOTICE '已移除 %（定義已備份到 _dropped_trigger_backup）', t.trigger_name;
    ELSE
      kept := kept + 1;
      RAISE NOTICE '保留 %（不是重算金額的那支）', t.trigger_name;
    END IF;
  END LOOP;

  RAISE NOTICE '移除 % 支、保留 % 支', dropped, kept;
END $$;


-- ---------------------------------------------------------------------------
-- 執行後：確認
-- ---------------------------------------------------------------------------
SELECT table_name, column_name, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND data_type = 'timestamp with time zone'
  AND column_default LIKE '%08:00:00%';
-- ↑ 應該回傳 0 筆

SELECT tg.tgname, pg_get_triggerdef(tg.oid) AS trigger_def
FROM pg_trigger tg
JOIN pg_class cl ON cl.oid = tg.tgrelid
WHERE cl.relname = 'sale_items' AND NOT tg.tgisinternal;
-- ↑ 應該只剩非金額用途的觸發器

SELECT dropped_at, table_name, trigger_name FROM public._dropped_trigger_backup ORDER BY id;
-- ↑ 被移除的觸發器備份（要還原就把 trigger_def 撈出來重跑）
