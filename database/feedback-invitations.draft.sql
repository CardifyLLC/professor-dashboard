BEGIN;
CREATE FUNCTION public.prepare_feedback_invitation(p_campaign uuid,p_order uuid,p_invitation uuid,p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.feedback_campaigns%ROWTYPE; o public.orders%ROWTYPE; existing public.feedback_invitations%ROWTYPE;
  recipient text; trigger_at timestamptz; invitation_count bigint; user_count bigint; prior_order boolean;
BEGIN
  SELECT * INTO c FROM public.feedback_campaigns WHERE id=p_campaign FOR UPDATE;
  IF c.id IS NULL OR NOT c.enabled OR c.paused THEN RAISE EXCEPTION 'Campaign disabled'; END IF;
  SELECT * INTO existing FROM public.feedback_invitations WHERE campaign_id=p_campaign AND order_id=p_order;
  IF existing.id IS NOT NULL THEN RETURN jsonb_build_object('id',existing.id,'already_prepared',true); END IF;
  SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
  IF o.id IS NULL OR o.user_id IS NULL OR o.payment_status IS DISTINCT FROM 'paid' OR o.refunded_at IS NOT NULL
    OR NOT coalesce(o.status=ANY(c.qualifying_statuses),false) OR o.status='cancelled' THEN RAISE EXCEPTION 'Order not eligible'; END IF;
  trigger_at := coalesce(to_jsonb(o)->>c.timing_trigger,to_jsonb(o)->'metadata'->>c.timing_trigger)::timestamptz;
  IF trigger_at IS NULL OR trigger_at>now()-make_interval(days=>c.delay_days) THEN RAISE EXCEPTION 'Timing trigger not met'; END IF;
  SELECT email INTO recipient FROM public.profiles WHERE id=o.user_id;
  IF recipient IS NULL OR NOT EXISTS(SELECT 1 FROM public.marketing_subscribers WHERE lower(email)=lower(recipient) AND status='subscribed' AND consented_at IS NOT NULL AND nullif(trim(consent_text),'') IS NOT NULL) THEN RAISE EXCEPTION 'Recipient suppressed or without consent'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.orders WHERE user_id=o.user_id AND id<>o.id AND payment_status='paid' AND created_at<o.created_at) INTO prior_order;
  IF c.audience NOT IN ('all_consented_customers','first_order_customers','repeat_customers')
    OR (c.audience='first_order_customers' AND prior_order) OR (c.audience='repeat_customers' AND NOT prior_order) THEN RAISE EXCEPTION 'Audience not eligible'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(o.user_id::text,0));
  IF EXISTS(SELECT 1 FROM public.feedback_invitations WHERE user_id=o.user_id AND created_at>now()-make_interval(days=>c.invitation_frequency_days)) THEN RAISE EXCEPTION 'Invitation frequency limit'; END IF;
  SELECT count(*),count(*) FILTER(WHERE user_id=o.user_id) INTO invitation_count,user_count FROM public.feedback_invitations WHERE campaign_id=c.id;
  -- Reserve the maximum reward and one send cost for every invitation, including failures.
  IF invitation_count>=c.max_invitations OR (invitation_count+1)*5>c.budget_prints
    OR (invitation_count+1)*c.email_unit_cost_minor>c.budget_email_minor OR user_count>=c.reward_limit_per_customer THEN RAISE EXCEPTION 'Campaign limit reached'; END IF;
  INSERT INTO public.feedback_invitations(id,campaign_id,order_id,user_id,token_hash,questionnaire,expires_at)
    VALUES(p_invitation,c.id,o.id,o.user_id,p_token_hash,c.questionnaire,now()+make_interval(days=>c.expires_after_days));
  RETURN jsonb_build_object('id',p_invitation,'already_prepared',false);
END $$;
REVOKE ALL ON FUNCTION public.prepare_feedback_invitation(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_feedback_invitation(uuid,uuid,uuid,text) TO service_role;

CREATE FUNCTION public.claim_feedback_send(p_invitation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i public.feedback_invitations%ROWTYPE; c public.feedback_campaigns%ROWTYPE; o public.orders%ROWTYPE; recipient text;
BEGIN
  SELECT * INTO i FROM public.feedback_invitations WHERE id=p_invitation;
  IF i.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.feedback_campaigns WHERE id=i.campaign_id FOR UPDATE;
  SELECT * INTO i FROM public.feedback_invitations WHERE id=p_invitation FOR UPDATE;
  IF NOT c.enabled OR c.paused OR i.status NOT IN ('pending','failed') OR i.expires_at<=now() THEN RETURN NULL; END IF;
  SELECT * INTO o FROM public.orders WHERE id=i.order_id FOR UPDATE;
  SELECT email INTO recipient FROM public.profiles WHERE id=i.user_id;
  -- Recheck consent and suppression immediately before the caller sends.
  IF o.payment_status IS DISTINCT FROM 'paid' OR o.refunded_at IS NOT NULL OR o.status='cancelled'
    OR NOT coalesce(o.status=ANY(c.qualifying_statuses),false) OR recipient IS NULL
    OR NOT EXISTS(SELECT 1 FROM public.marketing_subscribers WHERE lower(email)=lower(recipient) AND status='subscribed' AND consented_at IS NOT NULL AND nullif(trim(consent_text),'') IS NOT NULL) THEN
    UPDATE public.feedback_invitations SET status='suppressed' WHERE id=i.id; RETURN NULL;
  END IF;
  IF ((SELECT coalesce(sum(send_attempts),0) FROM public.feedback_invitations WHERE campaign_id=c.id)+1)*c.email_unit_cost_minor>c.budget_email_minor THEN RETURN NULL; END IF;
  UPDATE public.feedback_invitations SET status='sending',send_attempts=send_attempts+1 WHERE id=i.id;
  RETURN jsonb_build_object('id',i.id,'email',recipient,'subject',c.email_subject,'text',c.email_text,'expires_at',i.expires_at,'token_hash',i.token_hash);
END $$;
REVOKE ALL ON FUNCTION public.claim_feedback_send(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_feedback_send(uuid) TO service_role;
COMMIT;
