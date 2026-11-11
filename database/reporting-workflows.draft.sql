-- Reviewable schema; apply to sandbox first. No campaign is enabled by this file.
BEGIN;
CREATE TABLE public.growth_ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  segment text NOT NULL, trigger_description text NOT NULL, suggested_action text NOT NULL,
  evidence text NOT NULL, expected_benefit text NOT NULL, cost text NOT NULL,
  risks text NOT NULL, owner text NOT NULL, success_measure text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','completed')),
  created_by uuid NOT NULL, decided_by uuid, decided_at timestamptz,
  outcome text, created_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1
);
CREATE TABLE public.operation_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid,
  issue text NOT NULL, owner text NOT NULL, next_action text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved')),
  resolution text, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
  version integer NOT NULL DEFAULT 1
);
CREATE TABLE public.feedback_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL DEFAULT 'Feedback for 5 PRINTS',
  enabled boolean NOT NULL DEFAULT false, paused boolean NOT NULL DEFAULT true,
  timing_trigger text CHECK (timing_trigger IN ('created_at','paid_at','shipped_at','completed_at')),
  delay_days integer CHECK (delay_days BETWEEN 1 AND 365),
  qualifying_statuses text[], invitation_frequency_days integer CHECK (invitation_frequency_days > 0),
  reward_limit_per_customer integer CHECK (reward_limit_per_customer > 0),
  expires_after_days integer CHECK (expires_after_days > 0),
  audience text, email_subject text, email_text text, questionnaire jsonb,
  max_invitations integer CHECK (max_invitations > 0), budget_prints bigint CHECK (budget_prints >= 5),
  budget_email_minor bigint CHECK (budget_email_minor >= 0), email_unit_cost_minor bigint CHECK (email_unit_cost_minor >= 0),
  currency text CHECK (currency ~ '^[A-Z]{3}$'), reward_prints integer NOT NULL DEFAULT 5 CHECK (reward_prints = 5),
  approved_by uuid, approved_at timestamptz, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT enabled OR coalesce((approved_by IS NOT NULL AND approved_at IS NOT NULL AND delay_days IS NOT NULL AND timing_trigger IS NOT NULL
    AND cardinality(qualifying_statuses)>0 AND invitation_frequency_days IS NOT NULL
    AND reward_limit_per_customer IS NOT NULL AND expires_after_days IS NOT NULL
    AND length(trim(audience))>0 AND length(trim(email_subject))>0 AND length(trim(email_text))>0
    AND jsonb_typeof(questionnaire)='array' AND jsonb_array_length(questionnaire)>0
    AND max_invitations IS NOT NULL AND budget_prints IS NOT NULL AND budget_email_minor IS NOT NULL
    AND email_unit_cost_minor IS NOT NULL AND currency IS NOT NULL),false))
);
INSERT INTO public.feedback_campaigns DEFAULT VALUES;
CREATE TABLE public.feedback_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES public.feedback_campaigns(id),
  order_id uuid NOT NULL, user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  questionnaire jsonb NOT NULL, expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','suppressed','completed','uncertain')),
  sent_at timestamptz, send_attempts integer NOT NULL DEFAULT 0 CHECK(send_attempts>=0), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id,order_id)
);
CREATE TABLE public.feedback_claims (
  invitation_id uuid PRIMARY KEY REFERENCES public.feedback_invitations(id),
  user_id uuid NOT NULL, response jsonb NOT NULL,
  ledger_id uuid NOT NULL UNIQUE REFERENCES public.wallet_ledger_entries(id),
  prints integer NOT NULL CHECK (prints=5), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.refund_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL,
  request_key text NOT NULL UNIQUE, payment_intent text NOT NULL, amount_minor bigint CHECK (amount_minor>0),
  template_key text NOT NULL, status text NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared','submitted','succeeded','pending','failed','needs_reconciliation')),
  provider_reference text, provider_result jsonb, admin_note text, notification_reference text, notification_status text NOT NULL DEFAULT 'pending'
    CHECK (notification_status IN ('pending','sending','sent','failed','uncertain','skipped')),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX refund_one_unresolved_per_order ON public.refund_operations(order_id)
  WHERE status IN ('prepared','submitted','pending','needs_reconciliation');

-- Service-only tables. Browser access goes through freshly authenticated admin endpoints.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['growth_ideas','operation_exceptions','feedback_campaigns','feedback_invitations','feedback_claims','refund_operations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',t);
  END LOOP;
END $$;

-- No client-supplied amount. One transaction owns response, claim, wallet and ledger.
CREATE FUNCTION public.complete_feedback(p_token_hash text,p_user_id uuid,p_response jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE inv public.feedback_invitations%ROWTYPE; campaign public.feedback_campaigns%ROWTYPE;
  ord public.orders%ROWTYPE; existing public.feedback_claims%ROWTYPE; question jsonb;
  wallet uuid; balance_after bigint; ledger uuid; awarded bigint; customer_claims bigint;
BEGIN
  SELECT * INTO inv FROM public.feedback_invitations WHERE token_hash=p_token_hash;
  IF inv.id IS NULL OR inv.user_id IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
  -- Campaign lock serializes budget checks and claim creation across all invitations.
  SELECT * INTO campaign FROM public.feedback_campaigns WHERE id=inv.campaign_id FOR UPDATE;
  SELECT * INTO inv FROM public.feedback_invitations WHERE id=inv.id FOR UPDATE;
  SELECT * INTO existing FROM public.feedback_claims WHERE invitation_id=inv.id;
  IF existing.invitation_id IS NOT NULL THEN
    RETURN jsonb_build_object('completed',true,'prints',existing.prints,'already_processed',true);
  END IF;
  IF NOT campaign.enabled OR campaign.paused OR inv.status<>'sent' OR inv.expires_at<=now() THEN RAISE EXCEPTION 'Invitation unavailable'; END IF;
  SELECT * INTO ord FROM public.orders WHERE id=inv.order_id FOR UPDATE;
  IF ord.user_id IS DISTINCT FROM p_user_id OR ord.status='cancelled' OR ord.payment_status IS DISTINCT FROM 'paid'
    OR ord.refunded_at IS NOT NULL OR NOT coalesce(ord.status=ANY(campaign.qualifying_statuses),false)
    THEN RAISE EXCEPTION 'Order is not eligible'; END IF;
  IF jsonb_typeof(p_response)<>'object' OR octet_length(p_response::text)>20000 OR jsonb_typeof(inv.questionnaire)<>'array'
    OR jsonb_array_length(inv.questionnaire)=0 THEN RAISE EXCEPTION 'Incomplete response'; END IF;
  FOR question IN SELECT value FROM jsonb_array_elements(inv.questionnaire) LOOP
    IF NOT (question ? 'id') OR jsonb_typeof(p_response->(question->>'id')) IS DISTINCT FROM 'string'
      OR length(trim(p_response->>(question->>'id'))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Incomplete response'; END IF;
  END LOOP;
  SELECT coalesce(sum(c.prints),0),count(*) FILTER (WHERE c.user_id=p_user_id) INTO awarded,customer_claims
    FROM public.feedback_claims c JOIN public.feedback_invitations i ON i.id=c.invitation_id WHERE i.campaign_id=campaign.id;
  IF awarded+5>campaign.budget_prints OR customer_claims>=campaign.reward_limit_per_customer THEN RAISE EXCEPTION 'Reward limit reached'; END IF;
  INSERT INTO public.wallet_accounts(user_id,account_code) VALUES(p_user_id,'prints') ON CONFLICT(user_id,account_code) DO NOTHING;
  UPDATE public.wallet_accounts SET balance=balance+5,lifetime_credited=lifetime_credited+5,updated_at=now()
    WHERE user_id=p_user_id AND account_code='prints' AND status='active' RETURNING id,balance INTO wallet,balance_after;
  IF wallet IS NULL THEN RAISE EXCEPTION 'Wallet unavailable'; END IF;
  INSERT INTO public.wallet_ledger_entries(wallet_account_id,user_id,entry_type,prints_delta,resulting_print_balance,related_order_id,external_reference,note,metadata)
    VALUES(wallet,p_user_id,'manual_adjustment',5,balance_after,inv.order_id,'feedback:'||inv.id,'Verified feedback reward',jsonb_build_object('source','feedback','invitation_id',inv.id)) RETURNING id INTO ledger;
  INSERT INTO public.feedback_claims(invitation_id,user_id,response,ledger_id,prints) VALUES(inv.id,p_user_id,p_response,ledger,5);
  UPDATE public.feedback_invitations SET status='completed' WHERE id=inv.id;
  RETURN jsonb_build_object('completed',true,'prints',5,'already_processed',false);
END $$;
REVOKE ALL ON FUNCTION public.complete_feedback(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_feedback(text,uuid,jsonb) TO service_role;
COMMIT;
