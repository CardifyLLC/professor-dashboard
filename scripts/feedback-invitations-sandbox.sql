\set ON_ERROR_STOP on
CREATE TABLE public.profiles(id uuid PRIMARY KEY,email text);
CREATE TABLE public.marketing_subscribers(email text PRIMARY KEY,status text,consented_at timestamptz,consent_text text);
GRANT SELECT ON public.profiles,public.marketing_subscribers TO service_role;
\ir ../database/feedback-invitations.draft.sql
BEGIN;
INSERT INTO public.profiles VALUES('00000000-0000-0000-0000-000000000002','sandbox@example.invalid');
INSERT INTO public.marketing_subscribers VALUES('sandbox@example.invalid','unsubscribed',now(),'sandbox fixture');
INSERT INTO public.orders(id,user_id,status,payment_status,created_at) VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','completed','paid',now()-interval '8 days');
UPDATE public.feedback_campaigns SET enabled=true,paused=false,timing_trigger='created_at',delay_days=7,qualifying_statuses=ARRAY['completed'],invitation_frequency_days=30,reward_limit_per_customer=1,expires_after_days=14,audience='all_consented_customers',email_subject='sandbox',email_text='sandbox',questionnaire='[{"id":"quality","label":"How was it?"}]',max_invitations=1,budget_prints=5,budget_email_minor=0,email_unit_cost_minor=0,currency='USD',approved_by='00000000-0000-0000-0000-000000000003',approved_at=now();
DO $$ BEGIN
  BEGIN PERFORM public.prepare_feedback_invitation((SELECT id FROM public.feedback_campaigns LIMIT 1),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004',repeat('a',64)); RAISE EXCEPTION 'TEST FAILED unsubscribed recipient';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF; END;
END $$;
UPDATE public.marketing_subscribers SET status='subscribed';
SET LOCAL ROLE service_role;
SELECT public.prepare_feedback_invitation((SELECT id FROM public.feedback_campaigns LIMIT 1),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004',repeat('a',64));
SELECT public.prepare_feedback_invitation((SELECT id FROM public.feedback_campaigns LIMIT 1),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005',repeat('b',64));
RESET ROLE;
UPDATE public.marketing_subscribers SET status='unsubscribed';
SET LOCAL ROLE service_role;
DO $$ BEGIN
  IF public.claim_feedback_send('00000000-0000-0000-0000-000000000004') IS NOT NULL THEN RAISE EXCEPTION 'Unsubscribe before sending ignored'; END IF;
  IF (SELECT count(*) FROM public.feedback_invitations)<>1 THEN RAISE EXCEPTION 'Duplicate invitation'; END IF;
  IF (SELECT status FROM public.feedback_invitations LIMIT 1)<>'suppressed' THEN RAISE EXCEPTION 'Suppression not recorded'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
