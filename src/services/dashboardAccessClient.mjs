const expired = () => Object.assign(new Error('Your session has expired. Sign in again.'), { status: 401 });
function authFailure(error) {
  return [400, 401, 403, 422].includes(Number(error?.status)) || error?.name === 'AuthSessionMissingError'
    ? expired()
    : Object.assign(new Error('Sign-in verification is temporarily unavailable. Please try again.'), { status: 503 });
}

export function createDashboardAccessRequest({ auth, apiKey, fetchImpl = fetch }) {
  let refreshing;
  const session = async () => {
    const { data, error } = await auth.getSession();
    if (error) throw authFailure(error);
    if (!data?.session?.access_token) throw expired();
    return data.session;
  };
  const recover = async previous => {
    const current = await session();
    if (current.user?.id !== previous.user?.id) throw expired();
    // Another tab or an earlier request may already have refreshed this token.
    if (current.access_token !== previous.access_token) return current;
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const { data, error } = await auth.refreshSession();
          if (error) throw authFailure(error);
          if (!data?.session?.access_token) throw expired();
          return data.session;
        } finally { refreshing = null; }
      })();
    }
    const refreshed = await refreshing;
    if (refreshed.user?.id !== previous.user?.id) throw expired();
    return refreshed;
  };
  return async function dashboardAccessRequest(path = '/api/dashboard-access?mode=session', body, signal) {
    let current = await session();
    const requestSignal = signal || AbortSignal.timeout(30000);
    for (let attempt = 0; attempt < 2; attempt++) {
      requestSignal.throwIfAborted();
      const response = await fetchImpl(path, {
        method: body ? 'POST' : 'GET',
        headers: { apikey: apiKey, Authorization: `Bearer ${current.access_token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: 'no-store', credentials: 'omit', signal: requestSignal,
      });
      const data = await response.json().catch(() => null);
      if (response.status === 401 && attempt === 0) {
        requestSignal.throwIfAborted();
        current = await recover(current);
        continue;
      }
      if (!response.ok || !data) {
        throw Object.assign(new Error(data?.error || 'Could not reach dashboard access. Please try again.'), { status: response.ok ? 503 : response.status });
      }
      return data;
    }
  };
}
