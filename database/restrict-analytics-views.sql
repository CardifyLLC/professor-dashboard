-- Deploy /api/analytics-summary and its dashboard consumer FIRST.
-- This patch changes only privileges on these six views, not table RLS.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $$
DECLARE
  view_name text;
  role_name text;
  col_name text;
  view_oid oid;
BEGIN
  IF pg_has_role('anon', 'service_role', 'MEMBER') OR pg_has_role('authenticated', 'service_role', 'MEMBER') THEN
    RAISE EXCEPTION 'Unexpected service_role membership; review roles before applying';
  END IF;
  FOREACH view_name IN ARRAY ARRAY['order_analytics_totals','v_order_funnel_summary',
    'v_design_funnel_summary','v_feature_adoption','v_nps_summary','v_error_summary'] LOOP
    view_oid := to_regclass(format('public.%I', view_name));
    IF view_oid IS NULL THEN RAISE EXCEPTION 'Missing analytics view: %', view_name; END IF;
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', view_name);
    -- Include inherited grants; do not change role membership or unrelated tables.
    FOR role_name IN SELECT rolname FROM pg_roles
      WHERE rolname IN ('anon','authenticated')
        OR pg_has_role('anon', oid, 'MEMBER') OR pg_has_role('authenticated', oid, 'MEMBER') LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', view_name, role_name);
      FOR col_name IN SELECT attname FROM pg_attribute WHERE attrelid = view_oid AND attnum > 0 AND NOT attisdropped LOOP
        EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.%I FROM %I',
          col_name,col_name,col_name,col_name,view_name,role_name);
      END LOOP;
    END LOOP;
    FOR col_name IN SELECT attname FROM pg_attribute WHERE attrelid = view_oid AND attnum > 0 AND NOT attisdropped LOOP
      EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.%I FROM PUBLIC',
        col_name,col_name,col_name,col_name,view_name);
    END LOOP;
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', view_name);
    IF has_table_privilege('anon', view_oid, 'SELECT') OR has_any_column_privilege('anon', view_oid, 'SELECT')
       OR has_table_privilege('authenticated', view_oid, 'SELECT') OR has_any_column_privilege('authenticated', view_oid, 'SELECT') THEN
      RAISE EXCEPTION 'Effective client access remains on %; rolling back', view_name;
    END IF;
  END LOOP;
END $$;
COMMIT;
