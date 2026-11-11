-- Apply after reporting-workflows.draft.sql and feedback-invitations.draft.sql.
BEGIN;
CREATE TABLE public.checkout_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE,
 session_id uuid, provider text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.journey_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL UNIQUE,
 session_id uuid, attempt_id uuid REFERENCES public.checkout_attempts(id), order_id uuid,
 stage text NOT NULL CHECK(stage IN ('visit','design_start','import_complete','preview','checkout_start','payment_confirmed','payment_failed','checkout_abandoned')),
 source text NOT NULL CHECK(source IN ('client','server')), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(stage NOT IN ('checkout_start','payment_confirmed') OR (source='server' AND attempt_id IS NOT NULL AND order_id IS NOT NULL))
);
CREATE UNIQUE INDEX journey_session_stage ON public.journey_events(session_id,stage) WHERE attempt_id IS NULL;
CREATE UNIQUE INDEX journey_attempt_stage ON public.journey_events(attempt_id,stage) WHERE attempt_id IS NOT NULL;
CREATE INDEX journey_created ON public.journey_events(created_at);
CREATE TABLE public.reporting_order_facts (
 id uuid PRIMARY KEY,user_id uuid,status text,payment_status text,total_amount_cents bigint,currency text,
 stripe_session_id text,paypal_order_id text,paypal_capture_id text,wallet_prints_spent bigint,required_prints bigint,
 refunded_at timestamptz,created_at timestamptz,metadata jsonb NOT NULL DEFAULT '{}',archived_at timestamptz
);
CREATE TABLE public.reporting_ledger_facts (
 id uuid PRIMARY KEY,entry_type text,prints_delta bigint,related_order_id uuid,external_reference text,created_at timestamptz,metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE public.operation_health (
 id text PRIMARY KEY,status text NOT NULL CHECK(status IN ('ok','failed')),checked_at timestamptz NOT NULL DEFAULT now(),
 max_age_minutes integer NOT NULL CHECK(max_age_minutes>0),owner text NOT NULL,detail text NOT NULL
);
CREATE TABLE public.report_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),delivery_key text NOT NULL UNIQUE,recipient text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','uncertain')),
 report jsonb NOT NULL,provider_reference text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.operation_exceptions ADD COLUMN source_key text UNIQUE;
CREATE FUNCTION public.open_operation_exception(p_key text,p_order uuid,p_issue text,p_owner text,p_next text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ DECLARE result public.operation_exceptions%ROWTYPE; BEGIN
 INSERT INTO public.operation_exceptions(source_key,order_id,issue,owner,next_action) VALUES(p_key,p_order,p_issue,p_owner,p_next)
 ON CONFLICT(source_key) DO NOTHING;
 SELECT * INTO result FROM public.operation_exceptions WHERE source_key=p_key FOR UPDATE;
 IF result.status='resolved' THEN
  UPDATE public.operation_exceptions SET status='open',resolved_at=NULL,resolution=NULL,created_at=now(),version=version+1 WHERE id=result.id RETURNING * INTO result;
 END IF;
 RETURN to_jsonb(result);
END $$;
REVOKE ALL ON FUNCTION public.open_operation_exception(text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.open_operation_exception(text,uuid,text,text,text) TO service_role;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['checkout_attempts','journey_events','reporting_order_facts','reporting_ledger_facts','operation_health','report_deliveries'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',t);
 END LOOP;
END $$;

CREATE FUNCTION public.record_client_journey(p_event_id uuid,p_session_id uuid,p_stage text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN
 IF p_stage NOT IN ('visit','design_start','import_complete','preview','payment_failed','checkout_abandoned') OR p_session_id IS NULL OR p_event_id IS NULL THEN RAISE EXCEPTION 'Invalid client stage'; END IF;
 INSERT INTO public.journey_events(event_id,session_id,stage,source) VALUES(p_event_id,p_session_id,p_stage,'client') ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.record_client_journey(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_client_journey(uuid,uuid,text) TO service_role;

CREATE FUNCTION public.snapshot_reporting_order() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; m jsonb; sid uuid; attempt uuid; provider text; trusted boolean;
BEGIN
 r=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO m FROM jsonb_each(CASE WHEN jsonb_typeof(r->'metadata')='object' THEN r->'metadata' ELSE '{}'::jsonb END) WHERE key IN ('paid_at','tempOrderId','checkout_attempt_id','analytics_session_id','partnerId','affiliateReferralCode','payment_intent','stripe_payment_intent_id','paypal_capture_id');
 INSERT INTO public.reporting_order_facts(id,user_id,status,payment_status,total_amount_cents,currency,stripe_session_id,paypal_order_id,paypal_capture_id,wallet_prints_spent,required_prints,refunded_at,created_at,metadata,archived_at)
 VALUES((r->>'id')::uuid,(r->>'user_id')::uuid,r->>'status',r->>'payment_status',(r->>'total_amount_cents')::bigint,r->>'currency',r->>'stripe_session_id',r->>'paypal_order_id',r->>'paypal_capture_id',(r->>'wallet_prints_spent')::bigint,(r->>'required_prints')::bigint,(r->>'refunded_at')::timestamptz,(r->>'created_at')::timestamptz,m,CASE WHEN TG_OP='DELETE' THEN now() ELSE NULL END)
 ON CONFLICT(id) DO UPDATE SET status=excluded.status,payment_status=excluded.payment_status,total_amount_cents=excluded.total_amount_cents,currency=excluded.currency,stripe_session_id=excluded.stripe_session_id,paypal_order_id=excluded.paypal_order_id,paypal_capture_id=excluded.paypal_capture_id,wallet_prints_spent=excluded.wallet_prints_spent,required_prints=excluded.required_prints,refunded_at=excluded.refunded_at,metadata=excluded.metadata || CASE WHEN reporting_order_facts.metadata ? 'paid_at' THEN jsonb_build_object('paid_at',reporting_order_facts.metadata->'paid_at') ELSE '{}'::jsonb END,archived_at=excluded.archived_at;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 -- Only server-created attempts are accepted, never a client supplied attempt ID.
 IF coalesce(m->>'checkout_attempt_id','') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN RETURN NEW; END IF;
 trusted=current_setting('role',true) IN ('service_role','postgres') OR session_user IN ('postgres','reporting_test');
 IF NOT trusted THEN RETURN NEW; END IF;
 attempt=(m->>'checkout_attempt_id')::uuid;
 IF coalesce(m->>'analytics_session_id','') ~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN sid=(m->>'analytics_session_id')::uuid; END IF;
 provider=coalesce(r->>'payment_provider',r->>'payment_source','unknown');
 INSERT INTO public.checkout_attempts(id,order_id,session_id,provider) VALUES(attempt,NEW.id,sid,provider) ON CONFLICT(order_id) DO NOTHING;
 SELECT id,session_id INTO attempt,sid FROM public.checkout_attempts WHERE order_id=NEW.id;
 INSERT INTO public.journey_events(event_id,session_id,attempt_id,order_id,stage,source) VALUES(gen_random_uuid(),sid,attempt,NEW.id,'checkout_start','server') ON CONFLICT DO NOTHING;
 IF NEW.payment_status='paid' AND coalesce((r->>'wallet_prints_spent')::bigint,0)>=coalesce((r->>'required_prints')::bigint,0)
  AND (coalesce((r->>'total_amount_cents')::bigint,0)>0 OR coalesce((r->>'wallet_prints_spent')::bigint,0)>0) THEN
  INSERT INTO public.journey_events(event_id,session_id,attempt_id,order_id,stage,source) VALUES(gen_random_uuid(),sid,attempt,NEW.id,'payment_confirmed','server') ON CONFLICT DO NOTHING;
  UPDATE public.reporting_order_facts SET metadata=jsonb_set(metadata,'{paid_at}',to_jsonb(coalesce(metadata->>'paid_at',(SELECT created_at::text FROM public.journey_events WHERE attempt_id=attempt AND stage='payment_confirmed')))) WHERE id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.snapshot_reporting_order() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER reporting_order_snapshot AFTER INSERT OR UPDATE OR DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.snapshot_reporting_order();
CREATE FUNCTION public.snapshot_reporting_ledger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; m jsonb; BEGIN
 r=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO m FROM jsonb_each(CASE WHEN jsonb_typeof(r->'metadata')='object' THEN r->'metadata' ELSE '{}'::jsonb END) WHERE key IN ('source','invitation_id','amount_cents','amount_paid_cents','currency','immediate_prints','locked_prints','package_id');
 INSERT INTO public.reporting_ledger_facts(id,entry_type,prints_delta,related_order_id,external_reference,created_at,metadata)
 VALUES((r->>'id')::uuid,r->>'entry_type',(r->>'prints_delta')::bigint,(r->>'related_order_id')::uuid,r->>'external_reference',(r->>'created_at')::timestamptz,m)
 ON CONFLICT(id) DO NOTHING;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.snapshot_reporting_ledger() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER reporting_ledger_snapshot AFTER INSERT OR DELETE ON public.wallet_ledger_entries FOR EACH ROW EXECUTE FUNCTION public.snapshot_reporting_ledger();
-- Seed retained records without changing business state or inventing historical journey events.
INSERT INTO public.reporting_order_facts(id,user_id,status,payment_status,total_amount_cents,currency,stripe_session_id,paypal_order_id,paypal_capture_id,wallet_prints_spent,required_prints,refunded_at,created_at,metadata)
 SELECT id,user_id,status,payment_status,total_amount_cents,currency,stripe_session_id,to_jsonb(o)->>'paypal_order_id',to_jsonb(o)->>'paypal_capture_id',(to_jsonb(o)->>'wallet_prints_spent')::bigint,(to_jsonb(o)->>'required_prints')::bigint,(to_jsonb(o)->>'refunded_at')::timestamptz,created_at,coalesce((SELECT jsonb_object_agg(key,value) FROM jsonb_each(CASE WHEN jsonb_typeof(o.metadata)='object' THEN o.metadata ELSE '{}'::jsonb END) WHERE key IN ('paid_at','tempOrderId','partnerId','affiliateReferralCode','payment_intent','stripe_payment_intent_id','paypal_capture_id')),'{}') FROM public.orders o;
INSERT INTO public.reporting_ledger_facts SELECT id,entry_type,prints_delta,related_order_id,external_reference,created_at,coalesce((SELECT jsonb_object_agg(key,value) FROM jsonb_each(CASE WHEN jsonb_typeof(l.metadata)='object' THEN l.metadata ELSE '{}'::jsonb END) WHERE key IN ('source','invitation_id','amount_cents','amount_paid_cents','currency','immediate_prints','locked_prints','package_id')),'{}') FROM public.wallet_ledger_entries l;
COMMIT;
