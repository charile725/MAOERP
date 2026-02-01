-- Add business_date column to business_day_closings
-- This replaces the time-range-based closing with date-based closing

-- 1. Add the business_date column (nullable first for backfill)
ALTER TABLE business_day_closings
ADD COLUMN IF NOT EXISTS business_date DATE;

-- 2. Backfill existing records: extract date from closing_time (already stored in Taiwan time)
UPDATE business_day_closings
SET business_date = (closing_time::timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei')::date
WHERE business_date IS NULL;

-- 3. Deduplicate: keep only the latest closing per (source, business_date)
DELETE FROM business_day_closings
WHERE id NOT IN (
  SELECT DISTINCT ON (source, business_date) id
  FROM business_day_closings
  ORDER BY source, business_date, closing_time DESC
);

-- 4. Set NOT NULL constraint after backfill
ALTER TABLE business_day_closings
ALTER COLUMN business_date SET NOT NULL;

-- 5. Add unique constraint to prevent duplicate closings for same source + date
ALTER TABLE business_day_closings
ADD CONSTRAINT uq_business_day_closings_source_date UNIQUE (source, business_date);
