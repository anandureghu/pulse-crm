import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { useAuthStore } from './store/authStore'
import { useTenantStore } from './store/tenantStore'
import { queryClient } from './lib/queryClient'
import { tenantKeys } from './lib/queryKeys'
import { requestNotificationPermission, showLocalNotification } from './lib/notifications'
import ErrorBoundary from './components/ErrorBoundary'
import InstallPWA from './components/InstallPWA'
import SplashScreen from './components/SplashScreen'
import TenantSync from './components/TenantSync'
import Layout from './components/Layout'
import Login from './pages/Login'
import SetPassword from './pages/SetPassword'
import { Toaster } from './components/Toast'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Inbox = lazy(() => import('./pages/Inbox'))
const Customers = lazy(() => import('./pages/Customers'))
const CustomerDetail = lazy(() => import('./pages/CustomerDetail'))
const Pipeline = lazy(() => import('./pages/Pipeline'))
const Calendar = lazy(() => import('./pages/Calendar'))
const Followups = lazy(() => import('./pages/Followups'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Orders = lazy(() => import('./pages/Orders'))
const Settings = lazy(() => import('./pages/Settings'))
const Team = lazy(() => import('./pages/Team'))
const Admin = lazy(() => import('./pages/Admin'))

async function resolveMembership(userId: string): Promise<{
  hasProfile: boolean
  isPlatformAdmin: boolean
}> {
  const { data } = await supabase
    .from('users')
    .select('id, is_platform_admin')
    .eq('id', userId)
    .maybeSingle()

  if (!data) {
    try {
      await supabase.functions.invoke('reject-uninvited')
    } catch {
      // ignore
    }
    sessionStorage.setItem('pulsrm_not_invited', '1')
    await supabase.auth.signOut()
    return { hasProfile: false, isPlatformAdmin: false }
  }

  return { hasProfile: true, isPlatformAdmin: Boolean(data.is_platform_admin) }
}

function BootSplash({ children }: { children: React.ReactNode }) {
  const loading = useAuthStore((s) => s.loading)
  const [done, setDone] = useState(false)

  if (!done) {
    return <SplashScreen ready={!loading} onDone={() => setDone(true)} />
  }
  return <>{children}</>
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, member } = useAuthStore()
  const tenantReady = useTenantStore((s) => s.ready)
  // Already signed in — keep pages mounted across token refresh / tab focus
  if (user && member === true && tenantReady) return <>{children}</>
  if (loading || member === null || (member && !tenantReady)) {
    return <SplashScreen ready={false} />
  }
  if (!user || !member) return <Navigate to="/login" replace />
  return <>{children}</>
}

function PageLoader() {
  return <div className="p-6 text-sm text-gray-400">Loading…</div>
}

export default function App() {
  const { setUser, setRole, setMember, setLoading, setIsPlatformAdmin } = useAuthStore()
  const { setReady, reset: resetTenant } = useTenantStore()

  useEffect(() => {
    let cancelled = false

    const applySession = async (user: import('@supabase/supabase-js').User | null) => {
      if (!user) {
        setUser(null)
        setRole(null)
        setIsPlatformAdmin(false)
        setMember(false)
        resetTenant()
        queryClient.removeQueries({ queryKey: tenantKeys.all })
        setLoading(false)
        return
      }

      const prev = useAuthStore.getState()
      const keepMounted = prev.member === true && prev.user?.id === user.id
      setUser(user)
      // Tab focus / TOKEN_REFRESHED must not set member=null — that unmounts the
      // app and wipes in-progress forms (e.g. order prompt).
      if (!keepMounted) {
        setMember(null)
        setReady(false)
      }

      const { hasProfile, isPlatformAdmin } = await resolveMembership(user.id)
      if (cancelled) return
      if (!hasProfile) {
        setUser(null)
        setRole(null)
        setIsPlatformAdmin(false)
        setMember(false)
        resetTenant()
        queryClient.removeQueries({ queryKey: tenantKeys.all })
        setLoading(false)
        return
      }

      setIsPlatformAdmin(isPlatformAdmin)
      setMember(true)
      if (keepMounted) {
        setLoading(false)
      } else {
        requestNotificationPermission().catch(() => {})
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) applySession(session?.user ?? null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session?.user ?? null)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [
    setUser,
    setRole,
    setMember,
    setLoading,
    setIsPlatformAdmin,
    setReady,
    resetTenant,
  ])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const channel = new BroadcastChannel('push-messages')
    channel.onmessage = (event) => {
      const { title = 'New message', body = '' } = event.data ?? {}
      showLocalNotification(title, body)
    }
    return () => channel.close()
  }, [])

  return (
    <ErrorBoundary>
      <Toaster />
      <InstallPWA />
      <TenantSync />
      <BootSplash>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/set-password" element={<SetPassword />} />
            <Route
              path="/"
              element={
                <AuthGuard>
                  <Layout />
                </AuthGuard>
              }
            >
              <Route index element={<Suspense fallback={<PageLoader />}><Dashboard /></Suspense>} />
              <Route path="inbox" element={<Suspense fallback={<PageLoader />}><Inbox /></Suspense>} />
              <Route path="customers" element={<Suspense fallback={<PageLoader />}><Customers /></Suspense>} />
              <Route path="customers/:id" element={<Suspense fallback={<PageLoader />}><CustomerDetail /></Suspense>} />
              <Route path="pipeline" element={<Suspense fallback={<PageLoader />}><Pipeline /></Suspense>} />
              <Route path="calendar" element={<Suspense fallback={<PageLoader />}><Calendar /></Suspense>} />
              <Route path="followups" element={<Suspense fallback={<PageLoader />}><Followups /></Suspense>} />
              <Route path="analytics" element={<Suspense fallback={<PageLoader />}><Analytics /></Suspense>} />
              <Route path="orders" element={<Suspense fallback={<PageLoader />}><Orders /></Suspense>} />
              <Route path="settings" element={<Suspense fallback={<PageLoader />}><Settings /></Suspense>} />
              <Route path="team" element={<Suspense fallback={<PageLoader />}><Team /></Suspense>} />
              <Route path="admin" element={<Suspense fallback={<PageLoader />}><Admin /></Suspense>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </BootSplash>
    </ErrorBoundary>
  )
}
