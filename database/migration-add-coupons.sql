-- Create one-time coupon support
CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  discount_percent INTEGER NOT NULL DEFAULT 10 CHECK (discount_percent > 0 AND discount_percent <= 100),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reserved', 'used', 'void')),
  created_for TEXT,
  note TEXT,
  created_by TEXT,
  used_by_email TEXT,
  used_by_order_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  used_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_status ON coupons(status);
CREATE INDEX IF NOT EXISTS idx_coupons_created_at ON coupons(created_at DESC);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES coupons(id),
  ADD COLUMN IF NOT EXISTS coupon_code TEXT,
  ADD COLUMN IF NOT EXISTS discount_amount_cents INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_orders_coupon_code ON orders(coupon_code);

CREATE OR REPLACE FUNCTION reserve_one_time_coupon(
  p_code TEXT,
  p_email TEXT,
  p_order_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  code TEXT,
  discount_percent INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE coupons AS c
  SET
    status = 'reserved',
    used_by_email = NULLIF(TRIM(p_email), ''),
    used_by_order_id = NULLIF(TRIM(p_order_id), '')
  WHERE UPPER(c.code) = UPPER(TRIM(p_code))
    AND c.status = 'active'
  RETURNING c.id, c.code, c.discount_percent;
END;
$$;

CREATE OR REPLACE FUNCTION release_coupon_claim(
  p_code TEXT,
  p_order_id TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE coupons AS c
  SET
    status = 'active',
    used_at = NULL,
    used_by_email = NULL,
    used_by_order_id = NULL
  WHERE UPPER(c.code) = UPPER(TRIM(p_code))
    AND c.status = 'reserved'
    AND (
      NULLIF(TRIM(p_order_id), '') IS NULL
      OR c.used_by_order_id = NULLIF(TRIM(p_order_id), '')
    );
END;
$$;

CREATE OR REPLACE FUNCTION finalize_reserved_coupon(
  p_code TEXT,
  p_order_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  code TEXT,
  discount_percent INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE coupons AS c
  SET
    status = 'used',
    used_at = NOW()
  WHERE UPPER(c.code) = UPPER(TRIM(p_code))
    AND c.status = 'reserved'
    AND (
      NULLIF(TRIM(p_order_id), '') IS NULL
      OR c.used_by_order_id = NULLIF(TRIM(p_order_id), '')
    )
  RETURNING c.id, c.code, c.discount_percent;
END;
$$;
