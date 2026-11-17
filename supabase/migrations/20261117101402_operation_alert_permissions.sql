-- Supabase may grant broad service_role privileges through default privileges.
-- Only the internal trigger can append to the immutable email-attempt ledger.
REVOKE ALL ON public.operation_alert_attempts FROM service_role;
GRANT SELECT ON public.operation_alert_attempts TO service_role;
REVOKE ALL ON public.operation_alert_webhooks FROM service_role;
GRANT SELECT, INSERT, UPDATE ON public.operation_alert_webhooks TO service_role;
