import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export default function SetPassword() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const navigate = useNavigate()
  const { user, loading: authLoading, member } = useAuthStore()

  useEffect(() => {
    // Wait for invite/recovery tokens in the URL hash to become a session
    if (authLoading || member === null) return
    if (user) {
      setReady(true)
      return
    }
    const t = window.setTimeout(() => setReady(true), 4000)
    return () => window.clearTimeout(t)
  }, [user, authLoading, member])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      navigate('/', { replace: true })
    } catch (err) {
      setError((err as Error).message || 'Could not set password')
    } finally {
      setLoading(false)
    }
  }

  if (authLoading || member === null || !ready) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-gray-50 text-sm text-gray-400 p-4 safe-area-pb">
        Checking invite link…
      </div>
    )
  }

  if (!user || !member) {
    return (
      <div className="min-h-dvh overflow-y-auto flex items-center justify-center bg-gray-50 p-4 safe-area-pb">
        <div className="bg-white rounded-2xl shadow-md p-6 sm:p-8 w-full max-w-sm text-center my-auto">
          <h1 className="text-lg font-semibold text-gray-800 mb-2">
            {!user ? 'Link expired or invalid' : 'Invite required'}
          </h1>
          <p className="text-sm text-gray-500 mb-6">
            {!user
              ? 'Ask an admin to send a new invite, or use Forgot password on the login page.'
              : 'You need an invite to access pulsrm. Ask an admin to invite your email.'}
          </p>
          <Link to="/login" className="text-sm text-green-600 hover:text-green-700 font-medium">
            Go to login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh overflow-y-auto flex items-center justify-center bg-gray-50 p-4 safe-area-pb">
      <div className="bg-white rounded-2xl shadow-md p-6 sm:p-8 w-full max-w-sm my-auto">
        <div className="text-center mb-6">
          <img src="/logo.svg" alt="pulsrm" className="h-10 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-gray-800">Set your password</h1>
          <p className="text-sm text-gray-500 mt-1">
            Choose a password for <span className="font-medium text-gray-700">{user.email}</span>
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="••••••••"
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? 'Saving…' : 'Save password & continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
