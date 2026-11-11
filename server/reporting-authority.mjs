import config from '../config/reporting.production.json' with { type: 'json' };

// Caller must also verify that the authenticated user is an enabled dashboard admin.
export function reportingCanReject(env, user) {
  return env.VITE_SUPABASE_URL === 'https://jsxkyzdijoawzaiwfkfc.supabase.co'
    && Boolean(user?.id && user.email_confirmed_at)
    && ['superiorvideo@gmail.com', 'placeparks@gmail.com'].includes(user.email?.toLowerCase());
}

export function reportingApprover(env, user) {
  if (env.VITE_SUPABASE_URL === 'https://jsxkyzdijoawzaiwfkfc.supabase.co') {
    return reportingCanReject(env, user) ? user.id : null;
  }
  if (user && (user.email?.toLowerCase() !== config.approver_email || !user.email_confirmed_at)) return null;
  // Production identity was verified in Auth and explicitly selected by the owner.
  // Scope the default to that project so testing cannot inherit production authority.
  if (env.VITE_SUPABASE_URL === `https://${config.supabase_project_id}.supabase.co`) {
    return config.approver_user_id;
  }
  return env.REPORTING_APPROVER_USER_ID || null;
}
