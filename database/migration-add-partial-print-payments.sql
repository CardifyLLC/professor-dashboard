-- Atomically applies as many PRINTS as available and returns the unpaid remainder.
-- The checkout server should charge the remaining amount through Stripe.
CREATE OR REPLACE FUNCTION public.consume_available_prints_for_order(
  p_user_id UUID,
  p_required_prints BIGINT,
  p_order_id UUID DEFAULT NULL,
  p_design_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  prints_applied BIGINT,
  remaining_prints BIGINT,
  resulting_print_balance BIGINT,
  error_code TEXT,
  error_message TEXT
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallet_accounts%ROWTYPE;
  v_applied BIGINT;
  v_new_balance BIGINT;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::BIGINT, p_required_prints, NULL::BIGINT, 'missing_user', 'User is required.';
    RETURN;
  END IF;
  IF p_required_prints IS NULL OR p_required_prints <= 0 THEN
    RETURN QUERY SELECT FALSE, 0::BIGINT, p_required_prints, NULL::BIGINT, 'invalid_amount', 'Required PRINTS must be greater than zero.';
    RETURN;
  END IF;

  IF p_order_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_order_id::TEXT, 0));
  END IF;

  IF p_order_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.wallet_ledger_entries
    WHERE related_order_id = p_order_id
      AND entry_type = 'order_debit'
  ) THEN
    RETURN QUERY SELECT FALSE, 0::BIGINT, p_required_prints, NULL::BIGINT, 'already_applied', 'PRINTS were already applied to this order.';
    RETURN;
  END IF;

  SELECT *
  INTO v_wallet
  FROM public.wallet_accounts
  WHERE user_id = p_user_id
    AND account_code = 'prints'
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT TRUE, 0::BIGINT, p_required_prints, 0::BIGINT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  v_applied := LEAST(v_wallet.balance, p_required_prints);
  v_new_balance := v_wallet.balance - v_applied;

  IF v_applied > 0 THEN
    UPDATE public.wallet_accounts
    SET
      balance = v_new_balance,
      lifetime_debited = lifetime_debited + v_applied,
      updated_at = NOW()
    WHERE id = v_wallet.id;

    INSERT INTO public.wallet_ledger_entries (
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
      -v_applied,
      v_new_balance,
      p_order_id,
      p_design_id,
      COALESCE(NULLIF(TRIM(p_note), ''), 'Partial PRINTS payment'),
      jsonb_build_object(
        'source', 'consume_available_prints_for_order',
        'required_prints', p_required_prints,
        'prints_applied', v_applied,
        'remaining_prints', p_required_prints - v_applied
      )
    );
  END IF;

  RETURN QUERY SELECT
    TRUE,
    v_applied,
    p_required_prints - v_applied,
    v_new_balance,
    NULL::TEXT,
    NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_available_prints_for_order(UUID, BIGINT, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_available_prints_for_order(UUID, BIGINT, UUID, UUID, TEXT)
  TO service_role;

-- Returns PRINTS if the remaining card payment fails. Safe to call repeatedly.
CREATE OR REPLACE FUNCTION public.reverse_partial_prints_for_order(
  p_user_id UUID,
  p_order_id UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  prints_returned BIGINT,
  resulting_print_balance BIGINT,
  error_code TEXT,
  error_message TEXT
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallet_accounts%ROWTYPE;
  v_returned BIGINT;
  v_new_balance BIGINT;
BEGIN
  IF p_user_id IS NULL OR p_order_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::BIGINT, NULL::BIGINT, 'missing_input', 'User and order are required.';
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_order_id::TEXT, 0));
  IF EXISTS (
    SELECT 1 FROM public.wallet_ledger_entries
    WHERE user_id = p_user_id
      AND related_order_id = p_order_id
      AND entry_type = 'order_credit'
  ) THEN
    SELECT balance INTO v_new_balance
    FROM public.wallet_accounts
    WHERE user_id = p_user_id AND account_code = 'prints';
    RETURN QUERY SELECT TRUE, 0::BIGINT, v_new_balance, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(-prints_delta), 0)
  INTO v_returned
  FROM public.wallet_ledger_entries
  WHERE user_id = p_user_id
    AND related_order_id = p_order_id
    AND entry_type = 'order_debit'
    AND prints_delta < 0;

  IF v_returned <= 0 THEN
    RETURN QUERY SELECT FALSE, 0::BIGINT, NULL::BIGINT, 'debit_not_found', 'No PRINTS debit exists for this order.';
    RETURN;
  END IF;

  SELECT * INTO v_wallet
  FROM public.wallet_accounts
  WHERE user_id = p_user_id AND account_code = 'prints'
  FOR UPDATE;

  v_new_balance := v_wallet.balance + v_returned;
  UPDATE public.wallet_accounts
  SET
    balance = v_new_balance,
    lifetime_credited = lifetime_credited + v_returned,
    updated_at = NOW()
  WHERE id = v_wallet.id;

  INSERT INTO public.wallet_ledger_entries (
    wallet_account_id, user_id, entry_type, prints_delta,
    resulting_print_balance, related_order_id, note, metadata
  )
  VALUES (
    v_wallet.id, p_user_id, 'order_credit', v_returned,
    v_new_balance, p_order_id,
    COALESCE(NULLIF(TRIM(p_note), ''), 'Partial payment reversed'),
    jsonb_build_object('source', 'reverse_partial_prints_for_order')
  );

  RETURN QUERY SELECT TRUE, v_returned, v_new_balance, NULL::TEXT, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_partial_prints_for_order(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_partial_prints_for_order(UUID, UUID, TEXT)
  TO service_role;
