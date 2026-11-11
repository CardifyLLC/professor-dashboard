\set ON_ERROR_STOP on
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF; END $$;
GRANT USAGE ON SCHEMA public TO service_role,anon,authenticated;
CREATE TABLE public.orders(id uuid PRIMARY KEY, user_id uuid, status text, payment_status text, refunded_at timestamptz,created_at timestamptz DEFAULT now(),metadata jsonb DEFAULT '{}');
CREATE TABLE public.wallet_accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,account_code text,balance bigint DEFAULT 0,lifetime_credited bigint DEFAULT 0,status text DEFAULT 'active',updated_at timestamptz,UNIQUE(user_id,account_code));
CREATE TABLE public.wallet_ledger_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),wallet_account_id uuid,user_id uuid,entry_type text,prints_delta bigint,resulting_print_balance bigint,related_order_id uuid,external_reference text,note text,metadata jsonb);
GRANT SELECT,INSERT,UPDATE ON public.orders,public.wallet_accounts,public.wallet_ledger_entries TO service_role;
\ir ../database/reporting-workflows.draft.sql
BEGIN;
DO $$ BEGIN
  BEGIN UPDATE public.feedback_campaigns SET enabled=true; RAISE EXCEPTION 'TEST FAILED: incomplete configuration enabled';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
INSERT INTO public.orders(id,user_id,status,payment_status,refunded_at) VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','completed','paid',null);
UPDATE public.feedback_campaigns SET enabled=true,paused=false,timing_trigger='created_at',delay_days=7,qualifying_statuses=ARRAY['completed'],invitation_frequency_days=30,reward_limit_per_customer=1,expires_after_days=14,audience='sandbox only',email_subject='sandbox',email_text='sandbox',questionnaire='[{"id":"quality","label":"How was it?"}]',max_invitations=1,budget_prints=5,budget_email_minor=0,email_unit_cost_minor=0,currency='USD',approved_by='00000000-0000-0000-0000-000000000003',approved_at=now();
INSERT INTO public.feedback_invitations(campaign_id,order_id,user_id,token_hash,questionnaire,expires_at,status)
  SELECT id,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',repeat('a',64),questionnaire,now()+interval '1 day','sent' FROM public.feedback_campaigns;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN PERFORM public.complete_feedback(repeat('b',64),'00000000-0000-0000-0000-000000000002','{"quality":"good"}'); RAISE EXCEPTION 'TEST FAILED forged token';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.complete_feedback(repeat('a',64),'00000000-0000-0000-0000-000000000003','{"quality":"good"}'); RAISE EXCEPTION 'TEST FAILED wrong customer';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.complete_feedback(repeat('a',64),'00000000-0000-0000-0000-000000000002','{}'); RAISE EXCEPTION 'TEST FAILED incomplete response';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF; END;
END $$;
SELECT public.complete_feedback(repeat('a',64),'00000000-0000-0000-0000-000000000002','{"quality":"good"}');
SELECT public.complete_feedback(repeat('a',64),'00000000-0000-0000-0000-000000000002','{"quality":"good"}');
DO $$ BEGIN
  IF (SELECT sum(prints_delta) FROM public.wallet_ledger_entries)<>5 OR (SELECT count(*) FROM public.feedback_claims)<>1 THEN RAISE EXCEPTION 'Double reward'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF has_function_privilege('anon','public.complete_feedback(text,uuid,jsonb)','execute') OR has_function_privilege('authenticated','public.complete_feedback(text,uuid,jsonb)','execute') THEN RAISE EXCEPTION 'Public reward access'; END IF;
  IF has_table_privilege('authenticated','public.feedback_claims','insert') THEN RAISE EXCEPTION 'Public claim write'; END IF;
END $$;
ROLLBACK;
