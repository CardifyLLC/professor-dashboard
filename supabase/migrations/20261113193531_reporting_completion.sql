BEGIN;
-- Reporting was introduced after some orders had already been archived. Keep
-- those historical references so a later provider refund can still match.
DO $$ BEGIN
 IF to_regclass('public.deleted_orders_archive') IS NOT NULL THEN
  INSERT INTO public.reporting_order_facts(id,user_id,status,payment_status,total_amount_cents,currency,stripe_session_id,paypal_order_id,paypal_capture_id,wallet_prints_spent,required_prints,refunded_at,created_at,metadata,archived_at)
  SELECT a.order_id,(a.order_data->>'user_id')::uuid,a.status,a.payment_status,a.total_amount_cents,a.currency,a.stripe_session_id,
   a.order_data->>'paypal_order_id',a.order_data->>'paypal_capture_id',(a.order_data->>'wallet_prints_spent')::bigint,(a.order_data->>'required_prints')::bigint,
   (a.order_data->>'refunded_at')::timestamptz,a.order_created_at,
   coalesce((SELECT jsonb_object_agg(key,value) FROM jsonb_each(CASE WHEN jsonb_typeof(a.order_data->'metadata')='object' THEN a.order_data->'metadata' ELSE '{}'::jsonb END)
    WHERE key IN ('paid_at','tempOrderId','partnerId','affiliateReferralCode','payment_intent','stripe_payment_intent_id','paypal_capture_id')),'{}'::jsonb),a.archived_at
  FROM public.deleted_orders_archive a ON CONFLICT(id) DO NOTHING;
 END IF;
END $$;
CREATE TABLE public.reporting_reconciliation_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES public.reporting_order_facts(id),
 provider text NOT NULL CHECK(provider IN ('stripe','paypal','prints')),
 provider_reference text NOT NULL UNIQUE,
 event_kind text NOT NULL CHECK(event_kind IN ('sale','refund')),
 occurred_at timestamptz NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>=0),currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),
 verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reconciliation_evidence_order ON public.reporting_reconciliation_evidence(order_id);
ALTER TABLE public.reporting_reconciliation_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reporting_reconciliation_evidence FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.reporting_reconciliation_evidence TO service_role;

ALTER TABLE public.report_deliveries ADD COLUMN send_attempts integer NOT NULL DEFAULT 0 CHECK(send_attempts>=0), ADD COLUMN next_attempt_at timestamptz;
ALTER TABLE public.feedback_invitations ADD COLUMN provider_reference text,ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE public.growth_decision_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),idea_id uuid NOT NULL REFERENCES public.growth_ideas(id),
 version integer NOT NULL,status text NOT NULL,previous_status text NOT NULL,
 actor_id uuid NOT NULL,decided_at timestamptz NOT NULL,outcome text,UNIQUE(idea_id,version)
);
ALTER TABLE public.growth_decision_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.growth_decision_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.growth_decision_events TO service_role;
CREATE FUNCTION public.record_growth_decision() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  IF NOT ((OLD.status='pending' AND NEW.status IN ('approved','rejected')) OR (OLD.status='approved' AND NEW.status='completed'))
   OR NEW.version<>OLD.version+1 OR NEW.decided_by IS NULL OR NEW.decided_at IS NULL THEN RAISE EXCEPTION 'Invalid decision transition'; END IF;
  INSERT INTO public.growth_decision_events(idea_id,version,status,previous_status,actor_id,decided_at,outcome)
  VALUES(NEW.id,NEW.version,NEW.status,OLD.status,NEW.decided_by,NEW.decided_at,NEW.outcome);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.record_growth_decision() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER growth_decision_audit AFTER UPDATE ON public.growth_ideas FOR EACH ROW EXECUTE FUNCTION public.record_growth_decision();
CREATE OR REPLACE FUNCTION public.claim_feedback_send(p_invitation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i public.feedback_invitations%ROWTYPE;c public.feedback_campaigns%ROWTYPE;o public.orders%ROWTYPE;recipient text;
BEGIN
 SELECT * INTO i FROM public.feedback_invitations WHERE id=p_invitation;
 IF i.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO c FROM public.feedback_campaigns WHERE id=i.campaign_id FOR UPDATE;
 SELECT * INTO i FROM public.feedback_invitations WHERE id=p_invitation FOR UPDATE;
 IF NOT c.enabled OR c.paused OR i.status NOT IN ('pending','failed') OR i.expires_at<=now() OR i.send_attempts>=3
  OR (i.status='failed' AND i.updated_at>now()-interval '15 minutes') THEN RETURN NULL; END IF;
 SELECT * INTO o FROM public.orders WHERE id=i.order_id FOR UPDATE;
 SELECT email INTO recipient FROM public.profiles WHERE id=i.user_id;
 IF o.user_id IS DISTINCT FROM i.user_id OR o.payment_status IS DISTINCT FROM 'paid' OR o.refunded_at IS NOT NULL OR o.status='cancelled'
  OR NOT coalesce(o.status=ANY(c.qualifying_statuses),false) OR recipient IS NULL
  OR NOT EXISTS(SELECT 1 FROM public.marketing_subscribers WHERE lower(email)=lower(recipient) AND status='subscribed' AND consented_at IS NOT NULL AND nullif(trim(consent_text),'') IS NOT NULL) THEN
  UPDATE public.feedback_invitations SET status='suppressed',updated_at=now() WHERE id=i.id;RETURN NULL;
 END IF;
 IF ((SELECT coalesce(sum(send_attempts),0) FROM public.feedback_invitations WHERE campaign_id=c.id)+1)*c.email_unit_cost_minor>c.budget_email_minor THEN RETURN NULL; END IF;
 UPDATE public.feedback_invitations SET status='sending',send_attempts=send_attempts+1,updated_at=now() WHERE id=i.id;
 RETURN jsonb_build_object('id',i.id,'email',recipient,'subject',c.email_subject,'text',c.email_text,'expires_at',i.expires_at,'token_hash',i.token_hash);
END $$;
REVOKE ALL ON FUNCTION public.claim_feedback_send(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_feedback_send(uuid) TO service_role;
COMMIT;
