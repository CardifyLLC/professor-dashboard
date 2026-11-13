BEGIN;
CREATE TABLE public.report_delivery_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), delivery_id uuid NOT NULL REFERENCES public.report_deliveries(id),
 actor_id uuid NOT NULL, previous_status text NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('accepted','not_accepted')),
 provider_reference text NOT NULL, note text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.report_delivery_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_delivery_reviews FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.report_delivery_reviews TO service_role;
CREATE FUNCTION public.review_report_delivery(p_delivery uuid,p_actor uuid,p_outcome text,p_reference text,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE d public.report_deliveries%ROWTYPE; target text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.dashboard_admins WHERE user_id=p_actor AND enabled) THEN RAISE EXCEPTION 'Enabled administrator required'; END IF;
 IF p_outcome IS NULL OR p_outcome NOT IN ('accepted','not_accepted') OR coalesce(length(trim(p_reference)),0) NOT BETWEEN 1 AND 500
  OR coalesce(length(trim(p_note)),0) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'Record provider evidence and review note'; END IF;
 SELECT * INTO d FROM public.report_deliveries WHERE id=p_delivery FOR UPDATE;
 IF d.id IS NULL OR NOT (d.status='uncertain' OR (d.status='sending' AND d.updated_at<now()-interval '30 minutes')) THEN RAISE EXCEPTION 'Report is not awaiting delivery review'; END IF;
 target=CASE WHEN p_outcome='accepted' THEN 'sent' ELSE 'failed' END;
 INSERT INTO public.report_delivery_reviews(delivery_id,actor_id,previous_status,outcome,provider_reference,note)
 VALUES(d.id,p_actor,d.status,p_outcome,trim(p_reference),trim(p_note));
 UPDATE public.report_deliveries SET status=target,provider_reference=trim(p_reference),updated_at=now(),
  next_attempt_at=CASE WHEN target='failed' THEN now()+interval '15 minutes' ELSE NULL END WHERE id=d.id;
 RETURN jsonb_build_object('id',d.id,'status',target,'sent',false);
END $$;
REVOKE ALL ON FUNCTION public.review_report_delivery(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_report_delivery(uuid,uuid,text,text,text) TO service_role;
COMMIT;
