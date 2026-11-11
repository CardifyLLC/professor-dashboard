\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.orders(id,user_id,status,payment_status) VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','completed','paid');
UPDATE public.feedback_campaigns SET enabled=true,paused=false,timing_trigger='created_at',delay_days=7,qualifying_statuses=ARRAY['completed'],invitation_frequency_days=30,reward_limit_per_customer=1,expires_after_days=14,audience='all_consented_customers',email_subject='sandbox',email_text='sandbox',questionnaire='[{"id":"quality","label":"How was it?"}]',max_invitations=1,budget_prints=5,budget_email_minor=0,email_unit_cost_minor=0,currency='USD',approved_by='00000000-0000-0000-0000-000000000003',approved_at=now();
INSERT INTO public.feedback_invitations(campaign_id,order_id,user_id,token_hash,questionnaire,expires_at,status)
 SELECT id,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',repeat('a',64),questionnaire,now()-interval '1 day','sent' FROM public.feedback_campaigns;
CREATE FUNCTION pg_temp.expect_feedback_denied() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN
  PERFORM public.complete_feedback(repeat('a',64),'00000000-0000-0000-0000-000000000002','{"quality":"good"}');
  RAISE EXCEPTION 'TEST FAILED: ineligible credit accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.feedback_claims) OR EXISTS(SELECT 1 FROM public.wallet_ledger_entries) THEN RAISE EXCEPTION 'Failed credit left partial records'; END IF;
END $$;
SELECT pg_temp.expect_feedback_denied();
UPDATE public.feedback_invitations SET expires_at=now()+interval '1 day';
UPDATE public.orders SET status='cancelled';
SELECT pg_temp.expect_feedback_denied();
UPDATE public.orders SET status='completed',refunded_at=now();
SELECT pg_temp.expect_feedback_denied();
UPDATE public.orders SET refunded_at=null,payment_status='pending';
SELECT pg_temp.expect_feedback_denied();
UPDATE public.orders SET payment_status='paid';
INSERT INTO public.wallet_accounts(user_id,account_code,status) VALUES('00000000-0000-0000-0000-000000000002','prints','suspended');
SELECT pg_temp.expect_feedback_denied();
UPDATE public.wallet_accounts SET status='active';
-- Force a late failure after the wallet update; the entire credit must roll back.
CREATE FUNCTION pg_temp.fail_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic ledger failure'; END $$;
CREATE TRIGGER sandbox_fail_ledger BEFORE INSERT ON public.wallet_ledger_entries FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_ledger();
SELECT pg_temp.expect_feedback_denied();
DO $$ BEGIN IF (SELECT balance FROM public.wallet_accounts LIMIT 1)<>0 THEN RAISE EXCEPTION 'Wallet credit escaped rollback'; END IF; END $$;
DROP TRIGGER sandbox_fail_ledger ON public.wallet_ledger_entries;
SET LOCAL ROLE service_role;
SELECT public.complete_feedback(repeat('a',64),'00000000-0000-0000-0000-000000000002','{"quality":"good"}');
SELECT public.complete_feedback(repeat('a',64),'00000000-0000-0000-0000-000000000002','{"quality":"good"}');
DO $$ BEGIN
 IF (SELECT count(*) FROM public.feedback_claims c JOIN public.wallet_ledger_entries l ON l.id=c.ledger_id WHERE l.prints_delta=5 AND l.external_reference='feedback:'||c.invitation_id)<>1 THEN RAISE EXCEPTION 'Claim/ledger reconciliation failed'; END IF;
 IF (SELECT balance FROM public.wallet_accounts LIMIT 1)<>5 THEN RAISE EXCEPTION 'Retry credited wrong amount'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
