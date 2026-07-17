-- Atomic, auditable print grants for the professor dashboard.
CREATE OR REPLACE FUNCTION public.grant_prints_admin(
  p_user_id UUID,
  p_amount BIGINT,
  p_note TEXT DEFAULT NULL,
  p_granted_by TEXT DEFAULT 'professor-dashboard'
)
RETURNS TABLE (
  wallet_account_id UUID,
  resulting_balance BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_id UUID;
  v_balance BIGINT;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User is required.';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000 THEN
    RAISE EXCEPTION 'Print amount must be between 1 and 1,000,000.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;

  INSERT INTO public.wallet_accounts (user_id, account_code)
  VALUES (p_user_id, 'prints')
  ON CONFLICT (user_id, account_code) DO NOTHING;

  UPDATE public.wallet_accounts AS wallet
  SET
    balance = wallet.balance + p_amount,
    lifetime_credited = wallet.lifetime_credited + p_amount,
    updated_at = NOW()
  WHERE wallet.user_id = p_user_id
    AND wallet.account_code = 'prints'
  RETURNING wallet.id, wallet.balance
  INTO v_wallet_id, v_balance;

  INSERT INTO public.wallet_ledger_entries (
    wallet_account_id,
    user_id,
    entry_type,
    prints_delta,
    resulting_print_balance,
    note,
    metadata
  )
  VALUES (
    v_wallet_id,
    p_user_id,
    'manual_adjustment',
    p_amount,
    v_balance,
    COALESCE(NULLIF(TRIM(p_note), ''), 'Prints granted by admin'),
    jsonb_build_object(
      'source', 'admin_grant',
      'granted_by', COALESCE(NULLIF(TRIM(p_granted_by), ''), 'professor-dashboard')
    )
  );

  RETURN QUERY SELECT v_wallet_id, v_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_prints_admin(UUID, BIGINT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_prints_admin(UUID, BIGINT, TEXT, TEXT)
  TO service_role;
