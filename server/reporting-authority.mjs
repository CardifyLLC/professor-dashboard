import config from '../config/reporting.production.json' with { type: 'json' };

export function reportingApprover(env, user) {
  // Callers authenticate with getUser and separately require enabled admin membership.
  // Pin both the verified email and Auth ID; production never inherits an env override.
  if (env.VITE_SUPABASE_URL !== `https://${config.supabase_project_id}.supabase.co`
      || !user?.id || !user.email_confirmed_at || user.is_anonymous) return null;
  const approver = config.approvers.find(account =>
    account.user_id === user.id && account.email === user.email?.toLowerCase());
  return approver?.user_id || null;
}
