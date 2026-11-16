import { useCallback, useEffect, useRef, useState } from 'react'
import Dashboard from './components/Dashboard'
import ReadOnlyDashboard from './components/ReadOnlyDashboard'
import { dashboardAccessRequest } from './services/dashboardAccess'
import { supabase } from './services/supabaseClient'
import './style.css'
import { rememberOrderForSignIn } from './services/orderLinks.mjs'

function Login() {
  const [error, setError] = useState('')

  const signInWithGoogle = async () => {
    setError('')
    rememberOrderForSignIn()
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (signInError) setError(signInError.message || 'Google sign in failed')
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '48px 40px', width: '360px', textAlign: 'center' }}>
        <div style={{ marginBottom: '8px' }}>
          <img src='/logo.png' alt='Logo' style={{ height: '48px', objectFit: 'contain' }} />
        </div>
        <h1 style={{ color: 'var(--text-primary)', fontSize: '22px', fontWeight: '600', marginBottom: '8px' }}>
          TCGPlaytest Dashboard
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '32px' }}>
          Sign in with an approved Google account
        </p>
        {error && <p style={{ color: 'var(--status-cancelled)', fontSize: '13px' }}>{error}</p>}
        <button type='button' onClick={signInWithGoogle} style={{ width: '100%', padding: '12px', background: 'var(--accent-primary)', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '15px', fontWeight: '600', cursor: 'pointer' }}>
          Continue with Google
        </button>
      </div>
    </div>
  )
}

function App() {
  const [access, setAccess] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const verifySession = useCallback(async () => {
    const version = ++generation.current
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      if (!data.session) {
        if (version === generation.current) { setAccess(null); setError(''); setLoading(false) }
        return
      }
      if (version === generation.current) setAccess(previous => previous?.user_id === data.session.user.id ? previous : null)
      const result = await dashboardAccessRequest()
      if (version === generation.current) { setAccess(result); setError(''); setLoading(false) }
    } catch (err) {
      if (version === generation.current) {
        // Keep a previously verified workspace mounted during a temporary
        // outage. Confirmed session/permission loss still clears it immediately.
        if ([400, 401, 403, 422].includes(Number(err.status))) setAccess(null)
        setError(err.message || 'Unable to verify dashboard access.'); setLoading(false)
      }
    }
  }, [])
  const accessLost = useCallback(() => { generation.current++; setAccess(null); setLoading(true); verifySession() }, [verifySession])

  useEffect(() => {
    const counter = generation
    let scheduled
    verifySession()
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') {
        counter.current++; setAccess(null); setError(''); setLoading(false)
      } else if (event !== 'TOKEN_REFRESHED') {
        // Leave the auth callback before asking Supabase for the session again.
        window.clearTimeout(scheduled)
        scheduled = window.setTimeout(verifySession, 0)
      }
      // A refresh already retries its request. Rechecking on TOKEN_REFRESHED
      // would recursively start refreshes if the server continues to reject it.
    })
    const onFocus = () => { if (document.visibilityState === 'visible') verifySession() }
    const timer = window.setInterval(onFocus, 30000)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      counter.current++; window.clearTimeout(scheduled); window.clearInterval(timer)
      data.subscription.unsubscribe()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [verifySession])

  if (loading) return <div className="ta-viewer"><p role="status">Checking dashboard access…</p></div>
  const accessError = error && <div className="ta-viewer" role="alertdialog" aria-modal="true" aria-labelledby="access-error-title" style={access ? { position: 'fixed', inset: 0, zIndex: 10000, overflow: 'auto', background: 'var(--bg-primary)' } : undefined}><div className="team-access ta-panel"><h1 id="access-error-title">Dashboard access</h1><p role="alert" className="ta-error">{error}</p><div className="ta-toolbar"><button autoFocus onClick={verifySession}>Try again</button><button onClick={() => supabase.auth.signOut()}>Sign out</button></div></div></div>
  if (error && !access) return accessError
  if (!access) return <Login />
  return <>{accessError}<div inert={Boolean(error)} aria-hidden={error ? true : undefined}>
    {access.role === 'admin' ? <Dashboard key={access.user_id} /> : <ReadOnlyDashboard key={access.user_id + access.version} access={access} onAccessLost={accessLost} />}
  </div></>
}

export default App

