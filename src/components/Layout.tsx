import { useMemo, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useConversations } from '../hooks/useConversations'
import { supabase } from '../lib/supabase'

const navItems = [
  { to: '/', label: 'Dashboard', icon: '📊', adminOnly: false },
  { to: '/inbox', label: 'Inbox', icon: '💬', adminOnly: false, badge: 'inbox' as const },
  { to: '/customers', label: 'Customers', icon: '👥', adminOnly: false },
  { to: '/orders', label: 'Orders', icon: '🛒', adminOnly: false },
  { to: '/pipeline', label: 'Pipeline', icon: '📈', adminOnly: false },
  { to: '/calendar', label: 'Calendar', icon: '📅', adminOnly: false },
  { to: '/followups', label: 'Follow-ups', icon: '🔔', adminOnly: false },
  { to: '/analytics', label: 'Analytics', icon: '📉', adminOnly: false },
  { to: '/team', label: 'Team', icon: '👤', adminOnly: true },
  { to: '/settings', label: 'Settings', icon: '⚙️', adminOnly: false },
]

/** Bottom bar: daily-use destinations + More opens the full drawer. */
const MOBILE_NAV_PATHS = ['/inbox', '/customers', '/followups', '/pipeline'] as const
const mobileNav = MOBILE_NAV_PATHS
  .map((path) => navItems.find((i) => i.to === path))
  .filter((i): i is (typeof navItems)[number] => Boolean(i))

function InboxBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="ml-auto bg-green-500 text-white text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
      {count > 99 ? '99+' : count}
    </span>
  )
}

export default function Layout() {
  const user = useAuthStore((s) => s.user)
  const role = useAuthStore((s) => s.role)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { conversations } = useConversations()
  const unreadTotal = useMemo(
    () => conversations.reduce((sum, c) => sum + (c.unreadCount > 0 ? c.unreadCount : 0), 0),
    [conversations],
  )

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`
        fixed md:relative z-30 md:z-auto
        top-0 left-0 h-full w-64 md:w-56
        bg-white border-r border-gray-200
        flex flex-col
        transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <img src="/logo.svg" alt="pulsrm" className="h-8" />
          <button
            className="md:hidden text-gray-400 hover:text-gray-600 p-2 min-w-10 min-h-10"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {navItems.filter((item) => !item.adminOnly || role === 'admin').map(({ to, label, icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-green-50 text-green-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              <span className="text-base">{icon}</span>
              <span className="truncate">{label}</span>
              {badge === 'inbox' && <InboxBadge count={unreadTotal} />}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-200">
          <p className="text-xs text-gray-500 truncate mb-2">{user?.email}</p>
          <button
            onClick={() => supabase.auth.signOut()}
            className="text-xs text-red-500 hover:text-red-700"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">

        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-600 hover:text-gray-900 p-2 -ml-1 min-w-10 min-h-10"
            aria-label="Open menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <img src="/logo.svg" alt="pulsrm" className="h-7" />
        </header>

        <main className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden pb-16 md:pb-0">
          <Outlet />
        </main>
      </div>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-10 flex safe-area-pb">
        {mobileNav.map(({ to, label, icon, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center min-h-14 py-1.5 text-[10px] sm:text-xs transition-colors relative ${
                isActive ? 'text-green-600' : 'text-gray-400'
              }`
            }
          >
            <span className="text-xl leading-none mb-0.5 relative">
              {icon}
              {badge === 'inbox' && unreadTotal > 0 && (
                <span className="absolute -top-1 -right-2 bg-green-500 text-white text-[9px] font-semibold rounded-full min-w-[14px] h-[14px] px-0.5 flex items-center justify-center">
                  {unreadTotal > 9 ? '9+' : unreadTotal}
                </span>
              )}
            </span>
            <span className="truncate w-full text-center px-0.5">{label === 'Follow-ups' ? 'Follow-ups' : label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="flex-1 flex flex-col items-center justify-center min-h-14 py-1.5 text-[10px] sm:text-xs text-gray-400"
          aria-label="More"
        >
          <span className="text-xl leading-none mb-0.5">⋯</span>
          <span>More</span>
        </button>
      </nav>

    </div>
  )
}
