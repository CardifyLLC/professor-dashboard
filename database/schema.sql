-- Database schema for TCGPlaytest
-- Run this in Supabase SQL editor for a fresh database.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  default_shipping_address JSONB NOT NULL DEFAULT '{}'::jsonb,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON profiles(created_at DESC);

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    avatar_url,
    metadata
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'name',
      NULLIF(TRIM(CONCAT(
        COALESCE(NEW.raw_user_meta_data ->> 'first_name', ''),
        ' ',
        COALESCE(NEW.raw_user_meta_data ->> 'last_name', '')
      )), '')
    ),
    COALESCE(
      NEW.raw_user_meta_data ->> 'avatar_url',
      NEW.raw_user_meta_data ->> 'picture'
    ),
    jsonb_build_object(
      'provider', NEW.raw_app_meta_data ->> 'provider',
      'providers', COALESCE(NEW.raw_app_meta_data -> 'providers', '[]'::jsonb)
    )
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
    metadata = profiles.metadata || EXCLUDED.metadata;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

CREATE TABLE IF NOT EXISTS wallet_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL DEFAULT 'prints',
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  reserved_balance BIGINT NOT NULL DEFAULT 0 CHECK (reserved_balance >= 0),
  lifetime_credited BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_credited >= 0),
  lifetime_debited BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_debited >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked', 'closed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, account_code)
);

CREATE INDEX IF NOT EXISTS idx_wallet_accounts_user_id ON wallet_accounts(user_id);

CREATE OR REPLACE FUNCTION public.ensure_default_wallet_for_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.wallet_accounts (user_id, account_code)
  VALUES (NEW.id, 'prints')
  ON CONFLICT (user_id, account_code) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created_default_wallet ON profiles;
CREATE TRIGGER on_profile_created_default_wallet
  AFTER INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_default_wallet_for_profile();

CREATE TABLE IF NOT EXISTS designs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled Design',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ordered', 'archived')),
  deck_count INTEGER NOT NULL DEFAULT 0 CHECK (deck_count >= 0),
  card_quantity INTEGER NOT NULL DEFAULT 0 CHECK (card_quantity >= 0),
  required_prints BIGINT NOT NULL DEFAULT 0 CHECK (required_prints >= 0),
  current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  card_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  global_back JSONB NOT NULL DEFAULT '{}'::jsonb,
  uploaded_xml_filename TEXT,
  uploaded_xml_content TEXT,
  preview_image_url TEXT,
  last_saved_at TIMESTAMP WITH TIME ZONE,
  last_opened_at TIMESTAMP WITH TIME ZONE,
  archived_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_designs_user_id ON designs(user_id);
CREATE INDEX IF NOT EXISTS idx_designs_user_status ON designs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_designs_updated_at ON designs(updated_at DESC);

CREATE TABLE IF NOT EXISTS print_pricing_rules (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('base_card', 'finish_modifier')),
  finish_code TEXT NOT NULL,
  print_delta BIGINT NOT NULL DEFAULT 0 CHECK (print_delta >= 0),
  cash_surcharge_cents INTEGER NOT NULL DEFAULT 0 CHECK (cash_surcharge_cents >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_print_pricing_rules_rule_type ON print_pricing_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_print_pricing_rules_finish_code ON print_pricing_rules(finish_code);

INSERT INTO print_pricing_rules (code, name, rule_type, finish_code, print_delta, cash_surcharge_cents, metadata)
VALUES
  ('base-standard', 'Base Card', 'base_card', 'standard', 1, 0, '{"included_effects": []}'::jsonb),
  ('finish-rainbow', 'Rainbow Foil', 'finish_modifier', 'rainbow', 1, 250, '{}'::jsonb),
  ('finish-gloss', 'Piano Gloss', 'finish_modifier', 'gloss', 1, 250, '{}'::jsonb),
  ('finish-silver', 'Spot Silver', 'finish_modifier', 'silver', 2, 350, '{}'::jsonb),
  ('finish-silver-rainbow', 'Spot Silver + Rainbow Foil', 'finish_modifier', 'silver-rainbow', 3, 600, '{}'::jsonb),
  ('finish-silver-gloss', 'Spot Silver + Piano Gloss', 'finish_modifier', 'silver-gloss', 3, 600, '{}'::jsonb)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  rule_type = EXCLUDED.rule_type,
  finish_code = EXCLUDED.finish_code,
  print_delta = EXCLUDED.print_delta,
  cash_surcharge_cents = EXCLUDED.cash_surcharge_cents,
  metadata = EXCLUDED.metadata;

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

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id TEXT UNIQUE NOT NULL,
  share_id TEXT UNIQUE NOT NULL DEFAULT lower(encode(gen_random_bytes(8), 'hex')),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  design_id UUID REFERENCES designs(id) ON DELETE SET NULL,
  customer_email TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  shipping_address JSONB NOT NULL,
  billing_address JSONB,
  total_amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  quantity INTEGER NOT NULL,
  price_per_card DECIMAL(10, 2) NOT NULL,
  shipping_cost_cents INTEGER NOT NULL,
  shipping_country TEXT NOT NULL,
  coupon_id UUID REFERENCES coupons(id),
  coupon_code TEXT,
  discount_amount_cents INTEGER NOT NULL DEFAULT 0,
  required_prints BIGINT NOT NULL DEFAULT 0,
  payment_source TEXT NOT NULL DEFAULT 'stripe' CHECK (payment_source IN ('stripe', 'wallet', 'mixed', 'manual')),
  wallet_prints_spent BIGINT NOT NULL DEFAULT 0,
  card_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  card_images_base64 JSONB NOT NULL DEFAULT '[]'::jsonb,
  card_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  front_image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  back_image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  mask_image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  uploaded_xml_filename TEXT,
  uploaded_xml_content TEXT,
  image_storage_path TEXT,
  pricing_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'processing', 'shipped', 'completed', 'cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_stripe_session_id ON orders(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_orders_share_id ON orders(share_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_design_id ON orders(design_id);
CREATE INDEX IF NOT EXISTS idx_orders_coupon_code ON orders(coupon_code);

CREATE TABLE IF NOT EXISTS wallet_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_account_id UUID NOT NULL REFERENCES wallet_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (
    entry_type IN (
      'purchase',
      'manual_adjustment',
      'order_debit',
      'order_credit',
      'refund',
      'promo',
      'bonus',
      'expiration',
      'reversal'
    )
  ),
  prints_delta BIGINT NOT NULL CHECK (prints_delta <> 0),
  resulting_print_balance BIGINT,
  related_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  related_design_id UUID REFERENCES designs(id) ON DELETE SET NULL,
  external_reference TEXT,
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_entries_wallet_account_id ON wallet_ledger_entries(wallet_account_id);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_entries_user_id ON wallet_ledger_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_entries_related_order_id ON wallet_ledger_entries(related_order_id);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_entries_created_at ON wallet_ledger_entries(created_at DESC);

DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_wallet_accounts_updated_at ON wallet_accounts;
CREATE TRIGGER update_wallet_accounts_updated_at
  BEFORE UPDATE ON wallet_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_designs_updated_at ON designs;
CREATE TRIGGER update_designs_updated_at
  BEFORE UPDATE ON designs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_print_pricing_rules_updated_at ON print_pricing_rules;
CREATE TRIGGER update_print_pricing_rules_updated_at
  BEFORE UPDATE ON print_pricing_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_at ON webhook_events(processed_at DESC);

CREATE TABLE IF NOT EXISTS image_rate_limits (
  client_key TEXT PRIMARY KEY,
  window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  image_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_image_rate_limits_window_start ON image_rate_limits(window_start DESC);

CREATE OR REPLACE FUNCTION consume_image_quota(
  p_client_key TEXT,
  p_requested_images INTEGER,
  p_max_images INTEGER DEFAULT 10000,
  p_window_seconds INTEGER DEFAULT 3600
)
RETURNS TABLE (
  allowed BOOLEAN,
  remaining_images INTEGER,
  retry_after_seconds INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMP WITH TIME ZONE := NOW();
  v_window_start TIMESTAMP WITH TIME ZONE := v_now - make_interval(secs => p_window_seconds);
  v_record image_rate_limits%ROWTYPE;
  v_next_count INTEGER;
BEGIN
  IF p_requested_images <= 0 THEN
    RETURN QUERY SELECT TRUE, p_max_images, p_window_seconds;
    RETURN;
  END IF;

  INSERT INTO image_rate_limits (client_key, window_start, image_count, updated_at)
  VALUES (p_client_key, v_now, 0, v_now)
  ON CONFLICT (client_key) DO NOTHING;

  SELECT *
  INTO v_record
  FROM image_rate_limits
  WHERE client_key = p_client_key
  FOR UPDATE;

  IF v_record.window_start < v_window_start THEN
    v_record.window_start := v_now;
    v_record.image_count := 0;
  END IF;

  v_next_count := v_record.image_count + p_requested_images;

  IF v_next_count > p_max_images THEN
    RETURN QUERY
    SELECT
      FALSE,
      GREATEST(0, p_max_images - v_record.image_count),
      GREATEST(1, p_window_seconds - FLOOR(EXTRACT(EPOCH FROM (v_now - v_record.window_start)))::INTEGER);
    RETURN;
  END IF;

  UPDATE image_rate_limits
  SET
    window_start = v_record.window_start,
    image_count = v_next_count,
    updated_at = v_now
  WHERE client_key = p_client_key;

  RETURN QUERY
  SELECT
    TRUE,
    GREATEST(0, p_max_images - v_next_count),
    GREATEST(1, p_window_seconds - FLOOR(EXTRACT(EPOCH FROM (v_now - v_record.window_start)))::INTEGER);
END;
$$;

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

CREATE OR REPLACE FUNCTION consume_prints_for_order(
  p_user_id UUID,
  p_required_prints BIGINT,
  p_order_id UUID DEFAULT NULL,
  p_design_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  resulting_print_balance BIGINT,
  error_code TEXT,
  error_message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet wallet_accounts%ROWTYPE;
  v_new_balance BIGINT;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::BIGINT, 'missing_user', 'User is required.';
    RETURN;
  END IF;

  IF p_required_prints IS NULL OR p_required_prints <= 0 THEN
    RETURN QUERY SELECT TRUE, NULL::BIGINT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  SELECT *
  INTO v_wallet
  FROM wallet_accounts
  WHERE user_id = p_user_id
    AND account_code = 'prints'
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::BIGINT, 'wallet_not_found', 'Prints wallet not found.';
    RETURN;
  END IF;

  IF v_wallet.balance < p_required_prints THEN
    RETURN QUERY
    SELECT
      FALSE,
      v_wallet.balance,
      'insufficient_prints',
      format('Insufficient prints. Available: %s, required: %s.', v_wallet.balance, p_required_prints);
    RETURN;
  END IF;

  v_new_balance := v_wallet.balance - p_required_prints;

  UPDATE wallet_accounts
  SET
    balance = v_new_balance,
    lifetime_debited = lifetime_debited + p_required_prints,
    updated_at = NOW()
  WHERE id = v_wallet.id;

  INSERT INTO wallet_ledger_entries (
    wallet_account_id,
    user_id,
    entry_type,
    prints_delta,
    resulting_print_balance,
    related_order_id,
    related_design_id,
    note,
    metadata
  )
  VALUES (
    v_wallet.id,
    p_user_id,
    'order_debit',
    -p_required_prints,
    v_new_balance,
    p_order_id,
    p_design_id,
    COALESCE(p_note, 'Prints applied to order'),
    jsonb_build_object(
      'source', 'consume_prints_for_order',
      'required_prints', p_required_prints
    )
  );

  RETURN QUERY SELECT TRUE, v_new_balance, NULL::TEXT, NULL::TEXT;
END;
$$;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_ledger_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_own ON profiles;
CREATE POLICY profiles_select_own
  ON profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS profiles_update_own ON profiles;
CREATE POLICY profiles_update_own
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS designs_select_own ON designs;
CREATE POLICY designs_select_own
  ON designs FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS designs_insert_own ON designs;
CREATE POLICY designs_insert_own
  ON designs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS designs_update_own ON designs;
CREATE POLICY designs_update_own
  ON designs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS designs_delete_own ON designs;
CREATE POLICY designs_delete_own
  ON designs FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS wallet_accounts_select_own ON wallet_accounts;
CREATE POLICY wallet_accounts_select_own
  ON wallet_accounts FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS wallet_ledger_entries_select_own ON wallet_ledger_entries;
CREATE POLICY wallet_ledger_entries_select_own
  ON wallet_ledger_entries FOR SELECT
  USING (auth.uid() = user_id);
