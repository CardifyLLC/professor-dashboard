-- Two attempted alert emails per recipient in any rolling 24 hours.
-- Reservations and unknown provider outcomes consume capacity conservatively.
CREATE TABLE public.operation_alert_attempts (
  delivery_id uuid NOT NULL REFERENCES public.report_deliveries(id),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  recipient text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (delivery_id, attempt_number)
);
CREATE INDEX operation_alert_attempts_recipient_time
  ON public.operation_alert_attempts (recipient, attempted_at DESC);
ALTER TABLE public.operation_alert_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operation_alert_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.operation_alert_attempts TO service_role;

-- Include existing attempts so deployment does not reset today's allowance.
INSERT INTO public.operation_alert_attempts (delivery_id, attempt_number, recipient, attempted_at)
SELECT d.id, n, lower(trim(d.recipient)), d.updated_at
FROM public.report_deliveries d
CROSS JOIN LATERAL generate_series(1, greatest(d.send_attempts, 1)) AS n
WHERE d.delivery_key LIKE 'alert:%' AND d.status IN ('sent','sending','uncertain','failed');

CREATE FUNCTION public.enforce_operation_alert_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_recipient text := lower(trim(NEW.recipient)); v_now timestamptz;
BEGIN
  IF NEW.delivery_key NOT LIKE 'alert:%' OR NEW.status <> 'sending' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'sending' AND OLD.send_attempts = NEW.send_attempts THEN RETURN NEW; END IF;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('operation-alert:' || v_recipient, 0));
  v_now := clock_timestamp();
  IF (SELECT count(*) FROM public.operation_alert_attempts
      WHERE recipient = v_recipient AND attempted_at > v_now - interval '24 hours') >= 2 THEN
    RAISE EXCEPTION 'Operation alert limit reached: two attempts per recipient in 24 hours';
  END IF;
  INSERT INTO public.operation_alert_attempts (delivery_id, attempt_number, recipient, attempted_at)
  VALUES (NEW.id, NEW.send_attempts, v_recipient, v_now);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_operation_alert_limit() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enforce_operation_alert_limit
AFTER INSERT OR UPDATE OF status, send_attempts ON public.report_deliveries
FOR EACH ROW EXECUTE FUNCTION public.enforce_operation_alert_limit();

-- Only canonical, currently open critical incidents may be sent by these RPCs.
CREATE FUNCTION public.operation_alert_items(p_items jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id), '[]'::jsonb)
  FROM public.operation_exceptions e
  WHERE e.status <> 'resolved'
    AND e.source_key ~ '^(pdf|health|source|refund):'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) i
                WHERE i->>'id' = e.id::text AND i->>'version' = e.version::text);
$$;
REVOKE ALL ON FUNCTION public.operation_alert_items(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operation_alert_items(jsonb) TO service_role;

CREATE FUNCTION public.claim_operation_alert(p_recipient text, p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_recipient text := lower(trim(p_recipient)); v_items jsonb; v_key text;
  v_row public.report_deliveries%ROWTYPE; v_now timestamptz;
BEGIN
  IF v_recipient IS NULL OR v_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR length(v_recipient) > 254 OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid alert request';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('operation-alert:' || v_recipient, 0));
  v_now := clock_timestamp();
  SELECT coalesce(jsonb_agg(i ORDER BY i->>'id'), '[]'::jsonb) INTO v_items
  FROM jsonb_array_elements(public.operation_alert_items(p_items)) i
  WHERE NOT EXISTS (
    SELECT 1 FROM public.report_deliveries d, jsonb_array_elements(d.report->'exceptions') old_item
    WHERE lower(trim(d.recipient)) = v_recipient AND d.delivery_key LIKE 'alert:%'
      AND d.status IN ('sending','sent','uncertain')
      AND old_item->>'id' = i->>'id' AND old_item->>'version' = i->>'version'
  );
  IF jsonb_array_length(v_items) = 0 THEN RETURN jsonb_build_object('status','unchanged'); END IF;
  IF (SELECT count(*) FROM public.operation_alert_attempts
      WHERE recipient = v_recipient AND attempted_at > v_now - interval '24 hours') >= 2 THEN
    RETURN jsonb_build_object('status','daily_limit','exceptions',v_items);
  END IF;
  SELECT 'alert:critical:' || md5(string_agg((i->>'id') || ':' || (i->>'version'), ',' ORDER BY i->>'id')) || ':' || v_recipient
    INTO v_key FROM jsonb_array_elements(v_items) i;
  INSERT INTO public.report_deliveries (delivery_key,recipient,report)
    VALUES (v_key,v_recipient,jsonb_build_object('exceptions',v_items)) ON CONFLICT (delivery_key) DO NOTHING;
  SELECT * INTO v_row FROM public.report_deliveries WHERE delivery_key = v_key FOR UPDATE;
  IF v_row.status NOT IN ('pending','failed') THEN RETURN jsonb_build_object('status',v_row.status); END IF;
  IF v_row.send_attempts >= 3 THEN RETURN jsonb_build_object('status','retry_limit'); END IF;
  IF v_row.next_attempt_at > v_now THEN RETURN jsonb_build_object('status','retry_deferred'); END IF;
  UPDATE public.report_deliveries SET status='sending',send_attempts=send_attempts+1,updated_at=v_now,next_attempt_at=NULL
    WHERE id=v_row.id RETURNING * INTO v_row;
  RETURN jsonb_build_object('status','claimed','id',v_row.id,'report',v_row.report);
END $$;
REVOKE ALL ON FUNCTION public.claim_operation_alert(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_operation_alert(text,jsonb) TO service_role;

-- Overflow notifications use the existing GitHub webhook secret, never email.
CREATE TABLE public.operation_alert_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE,
  report jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','uncertain')),
  send_attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.operation_alert_webhooks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operation_alert_webhooks FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON public.operation_alert_webhooks TO service_role;

CREATE FUNCTION public.claim_operation_alert_webhook(p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_items jsonb; v_fingerprint text; v_row public.operation_alert_webhooks%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid alert items'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('operation-alert-webhook',0));
  SELECT coalesce(jsonb_agg(i ORDER BY i->>'id'), '[]'::jsonb) INTO v_items
  FROM jsonb_array_elements(public.operation_alert_items(p_items)) i
  WHERE NOT EXISTS (
    SELECT 1 FROM public.operation_alert_webhooks d, jsonb_array_elements(d.report->'exceptions') old_item
    WHERE d.status IN ('sending','sent','uncertain')
      AND old_item->>'id' = i->>'id' AND old_item->>'version' = i->>'version'
  );
  IF jsonb_array_length(v_items)=0 THEN RETURN jsonb_build_object('status','unchanged'); END IF;
  SELECT md5(string_agg((i->>'id') || ':' || (i->>'version'), ',' ORDER BY i->>'id'))
    INTO v_fingerprint FROM jsonb_array_elements(v_items) i;
  INSERT INTO public.operation_alert_webhooks(fingerprint,report)
    VALUES(v_fingerprint,jsonb_build_object('exceptions',v_items)) ON CONFLICT(fingerprint) DO NOTHING;
  SELECT * INTO v_row FROM public.operation_alert_webhooks WHERE fingerprint=v_fingerprint FOR UPDATE;
  IF v_row.send_attempts>=3 THEN RETURN jsonb_build_object('status','retry_limit'); END IF;
  IF v_row.next_attempt_at>now() THEN RETURN jsonb_build_object('status','retry_deferred'); END IF;
  UPDATE public.operation_alert_webhooks SET status='sending',send_attempts=send_attempts+1,updated_at=now(),next_attempt_at=NULL
    WHERE id=v_row.id RETURNING * INTO v_row;
  RETURN jsonb_build_object('status','claimed','id',v_row.id,'count',jsonb_array_length(v_items));
END $$;
REVOKE ALL ON FUNCTION public.claim_operation_alert_webhook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_operation_alert_webhook(jsonb) TO service_role;

-- Allow scheduling jitter without falsely flagging the new cadence as stale.
UPDATE public.operation_health SET max_age_minutes=120 WHERE id='report-scheduler';
UPDATE public.operation_health SET max_age_minutes=90 WHERE id IN ('operations-monitor','dashboard','storefront');
