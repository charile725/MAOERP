-- Add last prize columns to ichiban_kuji table
-- Last prize: awarded when the final draw is made, does not count towards total draws but adds to cost

ALTER TABLE ichiban_kuji
ADD COLUMN IF NOT EXISTS last_prize_name TEXT,
ADD COLUMN IF NOT EXISTS last_prize_product_id UUID REFERENCES products(id);

-- Add comment for documentation
COMMENT ON COLUMN ichiban_kuji.last_prize_name IS 'Name of the last prize (for official sets)';
COMMENT ON COLUMN ichiban_kuji.last_prize_product_id IS 'Product ID for last prize (for custom sets)';
