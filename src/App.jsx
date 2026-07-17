import { useEffect, useState } from 'react'
import Dashboard from './components/Dashboard'
import { supabase } from './services/supabaseClient'
import './style.css'

async function isEnabledAdmin(userId) {
  if (!userId) return false
  const { data } = await supabase
    .from('dashboard_admins')
    .select('enabled')
    .eq('user_id', userId)
    .eq('enabled', true)
    .maybeSingle()
  return Boolean(data)
}

function Login() {
  const [error, setError] = useState('')

  const signInWithGoogle = async () => {
    setError('')
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
  const [authed, setAuthed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    const verifySession = async (session) => {
      const allowed = await isEnabledAdmin(session?.user?.id)
      if (!active) return
      setAuthed(Boolean(session && allowed))
      setLoading(false)
      if (session && !allowed) {
        await supabase.auth.signOut()
        if (active) window.alert('This Google account is not authorized for the dashboard.')
      }
    }

    supabase.auth.getSession().then(({ data }) => verifySession(data.session))
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setAuthed(false)
        setLoading(false)
      } else if (event === 'SIGNED_IN') {
        verifySession(session)
      }
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  if (loading) return null
  if (!authed) return <Login />
  return <Dashboard />
}

export default App

