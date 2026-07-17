# Secure dashboard deployment

1. Rotate every exposed Supabase service-role key before deploying.
2. Run `database/migration-secure-dashboard-admin.sql` in Supabase.
3. Create the administrator through Supabase Authentication.
4. Run the enrollment INSERT shown at the bottom of the migration.
5. Set `VITE_DASHBOARD_ADMIN_EMAIL` to that administrator email.
6. Deploy all Edge Functions again so the admin checks take effect.
7. Keep service-role, Stripe, Gmail, coupon, AI, and RunPod keys server-only.
8. Enable MFA for the administrator account in Supabase.

Do not deploy until steps 1-6 are complete. The dashboard intentionally fails closed before enrollment.
