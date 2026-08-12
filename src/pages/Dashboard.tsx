import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useEnquiries } from '../hooks/useEnquiries'
import { useFollowups, useEnrichedFollowups } from '../hooks/useFollowups'
import { useCustomers } from '../hooks/useCustomers'
import { useConversations } from '../hooks/useConversations'
import { useUsers } from '../hooks/useUsers'
import { usePayments } from '../hooks/useAnalyticsData'
import { useAuthStore } from '../store/authStore'
import { userLabel } from '../lib/db'
import type { EnrichedFollowup } from '../types'

type Scope = 'mine' | 'all'

function localDateKey(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dueDateKey(iso: string | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return localDateKey(d)
}

function greetingForHour(h: number) {
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function isMine(
  assignedTo: string | null | undefined,
  me: { email?: string | null; id?: string | null; label?: string | null }
) {
  if (!assignedTo?.trim()) return false
  return assignedTo === me.email || assignedTo === me.id || (!!me.label && assignedTo === me.label)
}

function Kpi({
  label,
  value,
  hint,
  to,
  accent,
  pulse,
}: {
  label: string
  value: string | number
  hint?: string
  to: string
  accent: string
  pulse?: boolean
}) {
  return (
    <Link
      to={to}
      className={`group relative overflow-hidden rounded-2xl border border-white/70 p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md ${accent}`}
    >
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/30 blur-2xl transition-transform group-hover:scale-125" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.55),transparent_55%)]" />
      <div className="relative">
        <div className="flex items-start justify-between gap-2">
          <p className="font-display text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums tracking-tight break-all">
            {value}
          </p>
          {pulse && Number(value) > 0 && (
            <span className="relative flex h-2.5 w-2.5 mt-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
            </span>
          )}
        </div>
        <p className="text-sm font-medium text-gray-700 mt-1.5">{label}</p>
        {hint && <p className="text-[11px] text-gray-500 mt-1 leading-snug">{hint}</p>}
      </div>
    </Link>
  )
}

function Panel({
  title,
  action,
  children,
  tone = 'default',
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  tone?: 'default' | 'urgent'
}) {
  return (
    <section
      className={`rounded-2xl border bg-white/90 backdrop-blur shadow-sm overflow-hidden ${
        tone === 'urgent' ? 'border-rose-200/80' : 'border-gray-200/80'
      }`}
    >
      <div className={`flex items-center justify-between gap-2 px-4 py-3 border-b ${
        tone === 'urgent'
          ? 'bg-gradient-to-r from-rose-50 to-orange-50/50 border-rose-100'
          : 'bg-gradient-to-r from-slate-50 to-white border-gray-100'
      }`}
      >
        <h3 className="font-semibold text-gray-800 text-sm sm:text-base">{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function EmptyBlock({
  title,
  subtitle,
  cta,
  to,
}: {
  title: string
  subtitle: string
  cta?: string
  to?: string
}) {
  return (
    <div className="text-center py-10 px-4 rounded-xl border border-dashed border-gray-200 bg-gradient-to-br from-gray-50/80 to-white">
      <p className="text-sm font-medium text-gray-700">{title}</p>
      <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">{subtitle}</p>
      {cta && to && (
        <Link
          to={to}
          className="inline-flex mt-4 text-xs font-semibold px-3 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-sm hover:opacity-95"
        >
          {cta}
        </Link>
      )}
    </div>
  )
}

function FollowupRow({ f, urgent }: { f: EnrichedFollowup; urgent?: boolean }) {
  return (
    <Link
      to={f.customerId ? `/customers/${f.customerId}` : '/followups'}
      className="flex items-center gap-3 text-sm rounded-xl px-2.5 py-2 -mx-1 hover:bg-gradient-to-r hover:from-emerald-50/80 hover:to-transparent transition-colors"
    >
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${urgent ? 'bg-rose-500' : 'bg-amber-400'}`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-gray-800 font-medium truncate">{f.customerName}</p>
        {f.note && <p className="text-xs text-gray-400 truncate">{f.note}</p>}
      </div>
      <span className={`text-xs flex-shrink-0 tabular-nums ${urgent ? 'text-rose-600 font-semibold' : 'text-gray-400'}`}>
        {f.dueDate
          ? new Date(f.dueDate).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
          : ''}
      </span>
    </Link>
  )
}

export default function Dashboard() {
  const { enquiries } = useEnquiries()
  const { followups, pending } = useFollowups()
  const { customers: contacts } = useCustomers()
  const { conversations } = useConversations()
  const { payments } = usePayments()
  const users = useUsers()
  const authUser = useAuthStore((s) => s.user)
  const { enriched } = useEnrichedFollowups(followups)

  const [scope, setScope] = useState<Scope>('all')

  const meLabel = (() => {
    const row = users.find((u) => u.id === authUser?.id)
    if (row) return userLabel(row)
    return authUser?.email ?? ''
  })()
  const me = { email: authUser?.email, id: authUser?.id, label: meLabel }

  const firstName =
    meLabel.split('@')[0]?.split(/[.\s_-]/)[0] ||
    authUser?.email?.split('@')[0] ||
    'there'
  const prettyName = firstName.charAt(0).toUpperCase() + firstName.slice(1)

  const today = localDateKey()
  const now = new Date()
  const todayLabel = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  const scopedEnriched = useMemo(() => {
    if (scope === 'all') return enriched
    return enriched.filter((f) => isMine(f.assignedTo, me))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enriched, scope, me.email, me.id, me.label])

  const scopedEnquiries = useMemo(() => {
    if (scope === 'all') return enquiries
    return enquiries.filter((e) => isMine(e.assignedTo, me))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enquiries, scope, me.email, me.id, me.label])

  const overdueFollowups = scopedEnriched.filter((f) => dueDateKey(f.dueDate) < today)
  const todayFollowups = scopedEnriched.filter((f) => dueDateKey(f.dueDate) === today)

  const openEnquiries = scopedEnquiries.filter(
    (e) => !['sale_completed', 'after_sales', 'repeat_customer', 'not_interested', 'lost', 'spam', 'duplicate'].includes(e.status)
  ).length

  const dealsWon = scopedEnquiries.filter((e) =>
    ['sale_completed', 'after_sales', 'repeat_customer'].includes(e.status)
  ).length

  const payingContacts = contacts.filter((c) => {
    const enq = enquiries.find((e) => e.customerId === c.id && ['sale_completed', 'after_sales', 'repeat_customer'].includes(e.status))
    return Boolean(enq)
  }).length

  const unassignedLeads = enquiries.filter(
    (e) =>
      !e.assignedTo?.trim()
      && !['sale_completed', 'after_sales', 'repeat_customer', 'not_interested', 'lost', 'spam', 'duplicate'].includes(e.status)
  ).length

  const unreadInbox = conversations.reduce((s, c) => s + (c.unreadCount || 0), 0)

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayPayments = payments.filter((p) => {
    if (!p.createdAt) return false
    return new Date(p.createdAt) >= todayStart
  })
  const revenueToday = todayPayments
    .filter((p) => p.status === 'received')
    .reduce((s, p) => s + p.amount, 0)
  const pendingPayments = payments
    .filter((p) => p.status === 'pending')
    .reduce((s, p) => s + p.amount, 0)

  const recentEnquiries = scopedEnquiries.slice(0, 6)
  const nameById = new Map(contacts.map((c) => [c.id, c.name]))

  const assigneeDisplay = (assignedTo: string | null | undefined) => {
    if (!assignedTo?.trim()) return 'Unassigned'
    const u = users.find((x) => x.email === assignedTo || x.id === assignedTo || userLabel(x) === assignedTo)
    return u ? userLabel(u) : assignedTo
  }

  return (
    <div className="min-h-full bg-gradient-to-br from-slate-50 via-emerald-50/40 to-sky-50/50">
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-3xl mb-6 border border-white/60 shadow-sm bg-gradient-to-br from-emerald-600 via-teal-600 to-sky-700 text-white">
          <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_20%_20%,#fff,transparent_40%),radial-gradient(circle_at_80%_0%,#a7f3d0,transparent_35%)]" />
          <div className="absolute -right-10 -bottom-16 w-56 h-56 rounded-full bg-white/10 blur-2xl" />
          <div className="relative p-5 sm:p-7 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <p className="text-emerald-100/90 text-sm font-medium">{todayLabel}</p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mt-1">
                {greetingForHour(now.getHours())}, {prettyName}
              </h2>
              <p className="text-sm text-emerald-50/85 mt-2 max-w-lg">
                Your work queue for leads and enquiries — not every contact is a customer yet.
              </p>
            </div>
            <div className="inline-flex rounded-xl bg-white/15 backdrop-blur border border-white/20 p-0.5 self-start sm:self-auto">
              {(
                [
                  { key: 'all' as const, label: 'All team' },
                  { key: 'mine' as const, label: 'Mine' },
                ]
              ).map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setScope(s.key)}
                  className={`px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
                    scope === s.key ? 'bg-white text-teal-800 shadow' : 'text-white/85 hover:text-white'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex gap-2 overflow-x-auto pb-1 mb-5 -mx-1 px-1">
          {[
            { to: '/inbox', label: 'Open inbox', icon: '💬' },
            { to: '/followups', label: 'Follow-ups', icon: '🔔' },
            { to: '/pipeline', label: 'Pipeline', icon: '📈' },
            { to: '/customers', label: 'Contacts', icon: '👥' },
            { to: '/analytics', label: 'Analytics', icon: '📉' },
          ].map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className="flex-shrink-0 inline-flex items-center gap-2 rounded-full border border-gray-200/80 bg-white/90 px-3.5 py-2 text-xs font-semibold text-gray-700 shadow-sm hover:border-emerald-300 hover:text-emerald-800 transition-colors"
            >
              <span>{a.icon}</span>
              {a.label}
            </Link>
          ))}
        </div>

        {/* Primary KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <Kpi
            label="Total contacts"
            value={contacts.length}
            hint="People in CRM — leads & enquiries"
            to="/customers"
            accent="bg-gradient-to-br from-sky-100 to-blue-50"
          />
          <Kpi
            label="Open enquiries"
            value={openEnquiries}
            hint="Active in the pipeline"
            to="/pipeline"
            accent="bg-gradient-to-br from-emerald-100 to-teal-50"
          />
          <Kpi
            label="Today's follow-ups"
            value={todayFollowups.length}
            hint={overdueFollowups.length ? `${overdueFollowups.length} overdue` : 'Due today'}
            to="/followups"
            accent="bg-gradient-to-br from-amber-100 to-yellow-50"
            pulse={overdueFollowups.length > 0}
          />
          <Kpi
            label="Deals won"
            value={dealsWon}
            hint={payingContacts ? `${payingContacts} paying contacts` : 'Closed sales'}
            to="/pipeline"
            accent="bg-gradient-to-br from-violet-100 to-purple-50"
          />
        </div>

        {/* Secondary KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <Kpi
            label="Overdue follow-ups"
            value={overdueFollowups.length}
            to="/followups"
            accent="bg-gradient-to-br from-rose-100 to-red-50"
            pulse
          />
          <Kpi
            label="Unassigned leads"
            value={scope === 'all' ? unassignedLeads : '—'}
            hint="Need an owner"
            to="/pipeline"
            accent="bg-gradient-to-br from-orange-100 to-amber-50"
          />
          <Kpi
            label="Unread inbox"
            value={unreadInbox}
            to="/inbox"
            accent="bg-gradient-to-br from-pink-100 to-rose-50"
          />
          <Kpi
            label="Money today"
            value={revenueToday > 0 ? `₹${revenueToday.toLocaleString('en-IN')}` : '₹0'}
            hint={pendingPayments > 0 ? `₹${pendingPayments.toLocaleString('en-IN')} pending` : 'Received payments'}
            to="/analytics"
            accent="bg-gradient-to-br from-teal-100 to-cyan-50"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          {/* Overdue first when present */}
          {overdueFollowups.length > 0 && (
            <Panel
              title={`Overdue follow-ups (${overdueFollowups.length})`}
              tone="urgent"
              action={
                <Link to="/followups" className="text-xs font-semibold text-rose-600 hover:text-rose-700">
                  Work queue →
                </Link>
              }
            >
              <div className="space-y-0.5 max-h-64 overflow-y-auto">
                {overdueFollowups.slice(0, 8).map((f) => (
                  <FollowupRow key={f.id} f={f} urgent />
                ))}
              </div>
            </Panel>
          )}

          <Panel
            title={`Today's follow-ups (${todayFollowups.length})`}
            action={
              <Link to="/followups" className="text-xs font-semibold text-emerald-600 hover:text-emerald-700">
                View all →
              </Link>
            }
          >
            {todayFollowups.length === 0 ? (
              <EmptyBlock
                title="Nothing due today"
                subtitle="Stay ahead — schedule the next touchpoint for a lead."
                cta="+ Schedule follow-up"
                to="/followups"
              />
            ) : (
              <div className="space-y-0.5 max-h-64 overflow-y-auto">
                {todayFollowups.map((f) => (
                  <FollowupRow key={f.id} f={f} />
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="Recent enquiries"
            action={
              <Link to="/pipeline" className="text-xs font-semibold text-emerald-600 hover:text-emerald-700">
                View all →
              </Link>
            }
          >
            {recentEnquiries.length === 0 ? (
              <EmptyBlock
                title="No enquiries yet"
                subtitle="New WhatsApp conversations will show up here as leads."
                cta="Open inbox"
                to="/inbox"
              />
            ) : (
              <div className="space-y-1">
                {recentEnquiries.map((e) => {
                  const name = nameById.get(e.customerId) ?? 'Unknown contact'
                  const assignee =
                    e.assignedTo?.trim()
                    || contacts.find((c) => c.id === e.customerId)?.assignedTo?.trim()
                    || null
                  return (
                    <Link
                      key={e.id}
                      to={`/customers/${e.customerId}`}
                      className="flex items-center gap-3 text-sm rounded-xl px-2.5 py-2 -mx-1 hover:bg-gradient-to-r hover:from-sky-50 hover:to-transparent transition-colors"
                    >
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-100 to-teal-200 text-teal-800 flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {name[0]?.toUpperCase() || '?'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-gray-800 font-medium truncate">{name}</p>
                        <p className="text-xs text-gray-400 truncate">{assigneeDisplay(assignee)}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] sm:text-xs capitalize flex-shrink-0 font-medium ${statusColor(e.status)}`}>
                        {e.status.replace(/_/g, ' ')}
                      </span>
                    </Link>
                  )
                })}
              </div>
            )}
          </Panel>

          {overdueFollowups.length === 0 && (
            <Panel title="Pipeline snapshot">
              <div className="grid grid-cols-2 gap-3">
                <Link to="/pipeline" className="rounded-xl p-3 bg-gradient-to-br from-slate-50 to-gray-100 border border-gray-100">
                  <p className="font-display text-xl font-bold text-gray-900 tabular-nums">{openEnquiries}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Open enquiries</p>
                </Link>
                <Link to="/followups" className="rounded-xl p-3 bg-gradient-to-br from-amber-50 to-yellow-100/60 border border-amber-100/60">
                  <p className="font-display text-xl font-bold text-gray-900 tabular-nums">{pending.length}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Pending follow-ups</p>
                </Link>
                <Link to="/inbox" className="rounded-xl p-3 bg-gradient-to-br from-rose-50 to-pink-100/50 border border-rose-100/60">
                  <p className="font-display text-xl font-bold text-gray-900 tabular-nums">{unreadInbox}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Unread messages</p>
                </Link>
                <Link to="/analytics" className="rounded-xl p-3 bg-gradient-to-br from-violet-50 to-purple-100/50 border border-violet-100/60">
                  <p className="font-display text-xl font-bold text-gray-900 tabular-nums">{dealsWon}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Deals won</p>
                </Link>
              </div>
            </Panel>
          )}
        </div>

        <p className="text-[11px] text-center text-gray-400 pb-2">
          Tip: “Contacts” are people you’ve spoken to. They become customers when a deal is won.
        </p>
      </div>
    </div>
  )
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    new_lead: 'bg-slate-100 text-slate-600',
    assigned: 'bg-blue-100 text-blue-700',
    contact_attempted: 'bg-sky-100 text-sky-700',
    interested: 'bg-amber-100 text-amber-800',
    follow_up_required: 'bg-orange-100 text-orange-700',
    negotiation: 'bg-violet-100 text-violet-700',
    ready_to_buy: 'bg-teal-100 text-teal-700',
    payment_pending: 'bg-pink-100 text-pink-700',
    sale_completed: 'bg-emerald-100 text-emerald-700',
    lost: 'bg-rose-100 text-rose-700',
    not_interested: 'bg-red-100 text-red-600',
  }
  return map[status] ?? 'bg-gray-100 text-gray-600'
}
