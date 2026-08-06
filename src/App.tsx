import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { useAuthStore } from './store/authStore'
import { requestNotificationPermission, showLocalNotification } from './lib/notifications'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import Login from './pages/Login'
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

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore()
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function PageLoader() {
  return <div className="p-6 text-sm text-gray-400">Loading…</div>
}

export default function App() {
  const { setUser, setRole, setLoading } = useAuthStore()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
      if (session?.user) {
        supabase
          .from('users')
          .select('role')
          .eq('id', session.user.id)
          .single()
          .then(({ data }) => setRole((data?.role ?? null) as 'admin' | 'sales' | null))
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null
      setUser(user)
      setLoading(false)

      if (user) {
        supabase
          .from('users')
          .select('role')
          .eq('id', user.id)
          .single()
          .then(({ data }) => setRole((data?.role ?? null) as 'admin' | 'sales' | null))
        requestNotificationPermission().catch(() => {})
      } else {
        setRole(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [setUser, setRole, setLoading])

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
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
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
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
