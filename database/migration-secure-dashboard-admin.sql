-- Run once in the Supabase SQL editor, then enroll the first admin at the bottom.
CREATE TABLE IF NOT EXISTS public.dashboard_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.dashboard_admins ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_dashboard_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dashboard_admins
    WHERE user_id = auth.uid() AND enabled = TRUE
  );
$$;

REVOKE ALL ON FUNCTION public.is_dashboard_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_dashboard_admin() TO authenticated;

DROP POLICY IF EXISTS dashboard_admins_select_self ON public.dashboard_admins;
CREATE POLICY dashboard_admins_select_self ON public.dashboard_admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND enabled = TRUE);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dashboard_admin_orders ON public.orders;
CREATE POLICY dashboard_admin_orders ON public.orders
  FOR ALL TO authenticated
  USING (public.is_dashboard_admin())
  WITH CHECK (public.is_dashboard_admin());

DROP POLICY IF EXISTS users_select_own_orders ON public.orders;
CREATE POLICY users_select_own_orders ON public.orders
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS dashboard_admin_profiles ON public.profiles;
CREATE POLICY dashboard_admin_profiles ON public.profiles
  FOR SELECT TO authenticated USING (public.is_dashboard_admin());

DROP POLICY IF EXISTS dashboard_admin_wallets ON public.wallet_accounts;
CREATE POLICY dashboard_admin_wallets ON public.wallet_accounts
  FOR SELECT TO authenticated USING (public.is_dashboard_admin());

ALTER TABLE public.affiliate_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dashboard_admin_affiliates ON public.affiliate_applications;
CREATE POLICY dashboard_admin_affiliates ON public.affiliate_applications
  FOR ALL TO authenticated
  USING (public.is_dashboard_admin())
  WITH CHECK (public.is_dashboard_admin());

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dashboard_admin_analytics ON public.analytics_events;
CREATE POLICY dashboard_admin_analytics ON public.analytics_events
  FOR SELECT TO authenticated USING (public.is_dashboard_admin());

ALTER TABLE public.order_daily_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dashboard_admin_daily_stats ON public.order_daily_stats;
CREATE POLICY dashboard_admin_daily_stats ON public.order_daily_stats
  FOR SELECT TO authenticated USING (public.is_dashboard_admin());

ALTER TABLE public.marketing_subscribers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dashboard_admin_subscribers ON public.marketing_subscribers;
CREATE POLICY dashboard_admin_subscribers ON public.marketing_subscribers
  FOR SELECT TO authenticated USING (public.is_dashboard_admin());

-- After creating the admin in Supabase Authentication, replace the email and run:
-- INSERT INTO public.dashboard_admins (user_id, email)
-- SELECT id, email FROM auth.users WHERE lower(email) = lower('you@example.com')
-- ON CONFLICT (user_id) DO UPDATE SET enabled = TRUE, email = EXCLUDED.email;
