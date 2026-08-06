import { useEffect, useState } from 'react'
import { useNavigate, Navigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin')
  const navigate = useNavigate()
  const { user, loading: authLoading, member } = useAuthStore()

  useEffect(() => {
    if (sessionStorage.getItem('pulsrm_not_invited') === '1') {
      sessionStorage.removeItem('pulsrm_not_invited')
      setError('You need an invite to access pulsrm. Ask an admin to invite your email.')
    }
  }, [])

  if (!authLoading && user && member) return <Navigate to="/" replace />

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) throw signInError
      if (!data.user) throw new Error('No user')

      const { data: profile } = await supabase
        .from('users')
        .select('id')
        .eq('id', data.user.id)
        .maybeSingle()

      if (!profile) {
        try { await supabase.functions.invoke('reject-uninvited') } catch { /* ignore */ }
        await supabase.auth.signOut()
        setError('You need an invite to access pulsrm. Ask an admin to invite this email.')
        return
      }

      navigate('/', { replace: true })
    } catch {
      setError('Invalid email or password')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    setError('')
    setInfo('')
    setGoogleLoading(true)
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/`,
          queryParams: { prompt: 'select_account' },
        },
      })
      if (oauthError) throw oauthError
    } catch {
      setError('Google sign-in failed. Try again or use email.')
      setGoogleLoading(false)
    }
  }

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)
    try {
      const redirectTo = `${window.location.origin}/set-password`
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
      if (resetError) throw resetError
      setInfo('Check your email for a link to set a new password.')
    } catch {
      setError('Could not send reset email. Check the address and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-md p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="flex items-center justify-center mb-3">
            <img src="/logo.svg" alt="pulsrm" className="h-10" />
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {mode === 'signin' ? 'Sign in to your account' : 'Reset your password'}
          </p>
        </div>

        {error && mode === 'signin' && (
          <p className="text-sm text-red-500 mb-4 text-center">{error}</p>
        )}

        {mode === 'signin' ? (
          <div className="space-y-4">
            <button
              type="button"
              onClick={handleGoogle}
              disabled={googleLoading || loading}
              className="w-full flex items-center justify-center gap-2 border border-gray-300 bg-white text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
              {googleLoading ? 'Redirecting…' : 'Continue with Google'}
            </button>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-gray-200" />
              <span className="text-xs text-gray-400">or</span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>

            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">Password</label>
                  <button
                    type="button"
                    onClick={() => { setMode('forgot'); setError(''); setInfo('') }}
                    className="text-xs text-green-600 hover:text-green-700"
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="••••••••"
                />
              </div>
              <button
                type="submit"
                disabled={loading || googleLoading}
                className="w-full bg-green-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>
          </div>
        ) : (
          <form onSubmit={handleForgot} className="space-y-4">
            <p className="text-sm text-gray-500">
              Enter your email and we&apos;ll send a link to set a new password.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="you@example.com"
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            {info && <p className="text-sm text-green-600">{info}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
            <button
              type="button"
              onClick={() => { setMode('signin'); setError(''); setInfo('') }}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              Back to sign in
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-gray-400">
          Access is invite-only. Open your invite email, or use{' '}
          <Link to="/set-password" className="text-green-600 hover:text-green-700">
            set password
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
