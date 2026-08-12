import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useEnquiries } from '../hooks/useEnquiries'
import { useCustomers } from '../hooks/useCustomers'
import { useFollowups } from '../hooks/useFollowups'
import { useConversations } from '../hooks/useConversations'
import { useUsers } from '../hooks/useUsers'
import { usePayments } from '../hooks/useAnalyticsData'
import { useAuthStore } from '../store/authStore'
import { userLabel } from '../lib/db'
import {
  ACTIVE_FUNNEL,
  LOST_STAGES,
  resolveRange,
  previousRange,
  inRange,
  filterByAssignee,
  pctDelta,
  closedConversion,
  stageCounts,
  stageVelocityDays,
  trendSeries,
  assigneeStats,
  followupMetrics,
  paymentBreakdown,
  inboxHealth,
  unassignedBacklog,
  downloadCsv,
  type DateRangeKey,
} from '../lib/analytics'
import {
  GradientBarChart,
  GradientAreaChart,
  GradientDonut,
  HorizontalFunnel,
} from '../components/charts/AnalyticsCharts'

type Tab = 'overview' | 'pipeline' | 'team' | 'followups'
type Scope = 'mine' | 'all'

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-[10px] text-gray-400">vs prev</span>
  if (delta === 0) return <span className="text-[10px] text-gray-400">0% vs prev</span>
  const up = delta > 0
  return (
    <span className={`text-[10px] font-semibold ${up ? 'text-emerald-600' : 'text-rose-500'}`}>
      {up ? '↑' : '↓'} {Math.abs(delta)}% vs prev
    </span>
  )
}

function KpiCard({
  label,
  value,
  delta,
  hint,
  to,
  accent,
}: {
  label: string
  value: string | number
  delta?: number | null
  hint?: string
  to?: string
  accent: string
}) {
  const inner = (
    <div
      className={`relative overflow-hidden rounded-2xl border border-white/60 p-4 shadow-sm transition-transform hover:-translate-y-0.5 ${accent}`}
    >
      <div className="absolute inset-0 opacity-40 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-white via-transparent to-transparent pointer-events-none" />
      <p className="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums relative break-all">{value}</p>
      <p className="text-sm text-gray-600 mt-1 relative">{label}</p>
      <div className="mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 relative">
        {delta !== undefined ? <DeltaBadge delta={delta ?? null} /> : <span />}
        {hint && <span className="text-[10px] text-gray-400 whitespace-normal">{hint}</span>}
      </div>
    </div>
  )
  if (to) {
    return (
      <Link to={to} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-2xl">
        {inner}
      </Link>
    )
  }
  return inner
}

function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-2xl border border-gray-200/80 bg-white/90 backdrop-blur shadow-sm p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-semibold text-gray-800">{title}</h3>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

export default function Analytics() {
  const { enquiries, loading: enqLoading } = useEnquiries()
  const { customers, loading: custLoading } = useCustomers()
  const { pending, completed, all: allFollowups, loading: fuLoading } = useFollowups()
  const { conversations, loading: convLoading } = useConversations()
  const { payments, loading: payLoading } = usePayments()
  const users = useUsers()
  const authUser = useAuthStore((s) => s.user)

  const [tab, setTab] = useState<Tab>('overview')
  const [scope, setScope] = useState<Scope>('all')
  const [rangeKey, setRangeKey] = useState<DateRangeKey>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const meLabel = (() => {
    const row = users.find((u) => u.id === authUser?.id)
    if (row) return userLabel(row)
    return authUser?.email ?? ''
  })()
  const me = { email: authUser?.email, id: authUser?.id, label: meLabel }

  const labelFor = (key: string) => {
    const u = users.find((x) => x.email === key || x.id === key || userLabel(x) === key)
    return u ? userLabel(u) : key
  }

  const range = useMemo(
    () => resolveRange(rangeKey, customFrom, customTo),
    [rangeKey, customFrom, customTo]
  )
  const prev = useMemo(() => previousRange(range), [range])

  const scopedEnquiries = useMemo(
    () => filterByAssignee(enquiries, scope, me),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enquiries, scope, me.email, me.id, me.label]
  )
  const scopedFollowups = useMemo(
    () => filterByAssignee(allFollowups, scope, me),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allFollowups, scope, me.email, me.id, me.label]
  )
  const scopedPayments = useMemo(() => {
    if (scope === 'all') return payments
    return payments.filter(
      (p) => p.recordedBy === me.email || p.recordedBy === me.id || p.recordedBy === me.label
    )
  }, [payments, scope, me.email, me.id, me.label])

  const enqInRange = useMemo(
    () => scopedEnquiries.filter((e) => inRange(e.createdAt, range)),
    [scopedEnquiries, range]
  )
  const enqPrev = useMemo(
    () => scopedEnquiries.filter((e) => inRange(e.createdAt, prev)),
    [scopedEnquiries, prev]
  )
  const payInRange = useMemo(
    () => scopedPayments.filter((p) => inRange(p.createdAt, range)),
    [scopedPayments, range]
  )
  const payPrev = useMemo(
    () => scopedPayments.filter((p) => inRange(p.createdAt, prev)),
    [scopedPayments, prev]
  )

  const conversion = closedConversion(enqInRange)
  const conversionPrev = closedConversion(enqPrev)

  const revenue = payInRange.filter((p) => p.status === 'received').reduce((s, p) => s + p.amount, 0)
  const revenuePrev = payPrev.filter((p) => p.status === 'received').reduce((s, p) => s + p.amount, 0)

  const custInRange = customers.filter((c) => inRange(c.createdAt, range)).length
  const custPrev = customers.filter((c) => inRange(c.createdAt, prev)).length

  const funnel = stageCounts(scopedEnquiries, ACTIVE_FUNNEL).map((s) => {
    const meta = ACTIVE_FUNNEL.find((x) => x.key === s.key)!
    return { key: s.key, label: s.label, value: s.count, color: meta.color, gradient: meta.gradient }
  })
  const lost = stageCounts(enqInRange, LOST_STAGES).map((s) => {
    const meta = LOST_STAGES.find((x) => x.key === s.key)!
    return { key: s.key, label: s.label, value: s.count, color: meta.color, gradient: meta.gradient }
  })
  const velocity = stageVelocityDays(scopedEnquiries.filter((e) => !['sale_completed', 'after_sales', 'repeat_customer', 'not_interested', 'lost', 'spam', 'duplicate'].includes(e.status)))
  const trends = trendSeries(scopedEnquiries, scopedPayments, range)
  const team = assigneeStats(enqInRange, payInRange, scopedFollowups, customers, labelFor)
  const fu = followupMetrics(scopedFollowups, range)
  const payBreak = paymentBreakdown(payInRange)
  const inbox = inboxHealth(conversations)
  const backlog = unassignedBacklog(
    scope === 'all' ? enquiries : scopedEnquiries,
    customers
  )

  const loading = enqLoading || custLoading || fuLoading || convLoading || payLoading

  const exportCurrent = () => {
    const stamp = new Date().toISOString().slice(0, 10)
    if (tab === 'team') {
      downloadCsv(
        `analytics-team-${stamp}.csv`,
        ['Assignee', 'Leads', 'Open', 'Won', 'Revenue', 'Overdue follow-ups'],
        team.map((t) => [t.name, t.leads, t.open, t.won, t.revenue, t.overdue])
      )
      return
    }
    if (tab === 'followups') {
      downloadCsv(
        `analytics-followups-${stamp}.csv`,
        ['Metric', 'Value'],
        [
          ['Pending', fu.pending],
          ['Overdue', fu.overdue],
          ['Due today', fu.dueToday],
          ['Completed (range)', fu.completed],
          ['Completion rate %', fu.completionRate],
          ['Avg hours to complete', fu.avgHours ?? ''],
        ]
      )
      return
    }
    if (tab === 'pipeline') {
      downloadCsv(
        `analytics-pipeline-${stamp}.csv`,
        ['Stage', 'Count', 'Avg age days'],
        [
          ...funnel.map((f) => {
            const v = velocity.find((x) => x.key === f.key)
            return [f.label, f.value, v?.days ?? '']
          }),
          ...lost.map((l) => [l.label, l.value, '']),
        ]
      )
      return
    }
    downloadCsv(
      `analytics-overview-${stamp}.csv`,
      ['Metric', 'Value'],
      [
        ['Range', range.label],
        ['Customers (new)', custInRange],
        ['Enquiries', enqInRange.length],
        ['Conversion %', conversion.rate],
        ['Won', conversion.won],
        ['Lost', conversion.lost],
        ['Revenue received', revenue],
        ['Unread messages', inbox.unread],
        ['Unassigned enquiries', backlog.enquiries],
      ]
    )
  }

  return (
    <div className="min-h-full bg-gradient-to-br from-slate-50 via-emerald-50/30 to-sky-50/40">
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Analytics</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Pipeline, team, follow-ups & revenue — {range.label}
              {scope === 'mine' ? ' · Mine' : ' · All team'}
            </p>
          </div>
          <button
            type="button"
            onClick={exportCurrent}
            className="text-xs font-medium px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 shadow-sm"
          >
            Export CSV
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-2 mb-5">
          <div className="inline-flex w-full sm:w-auto rounded-xl border border-gray-200/80 p-0.5 bg-white/80 shadow-sm overflow-x-auto">
            {(
              [
                { key: 'today' as const, label: 'Today' },
                { key: '7d' as const, label: '7d' },
                { key: '30d' as const, label: '30d' },
                { key: '90d' as const, label: '90d' },
                { key: 'all' as const, label: 'All' },
                { key: 'custom' as const, label: 'Custom' },
              ]
            ).map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRangeKey(r.key)}
                className={`flex-1 sm:flex-none px-3 py-2 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
                  rangeKey === r.key
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {rangeKey === 'custom' && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-2 text-xs bg-white w-full min-w-0"
              />
              <span className="text-xs text-gray-400 text-center hidden sm:inline">→</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-2 text-xs bg-white w-full min-w-0"
              />
            </div>
          )}

          <div className="inline-flex w-full sm:w-auto rounded-xl border border-gray-200/80 p-0.5 bg-white/80 shadow-sm">
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
                className={`flex-1 sm:flex-none px-3 py-2 text-xs font-medium rounded-lg ${
                  scope === s.key
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200/80 mb-5 overflow-x-auto">
          {(
            [
              { key: 'overview' as const, label: 'Overview' },
              { key: 'pipeline' as const, label: 'Pipeline' },
              { key: 'team' as const, label: 'Team' },
              { key: 'followups' as const, label: 'Follow-ups' },
            ]
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                tab === t.key
                  ? 'border-emerald-500 text-emerald-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 py-16 text-center">Loading analytics…</p>
        ) : (
          <>
            {tab === 'overview' && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <KpiCard
                    label="New customers"
                    value={custInRange}
                    delta={pctDelta(custInRange, custPrev)}
                    to="/customers"
                    accent="bg-gradient-to-br from-sky-100 to-blue-50"
                  />
                  <KpiCard
                    label="Enquiries"
                    value={enqInRange.length}
                    delta={pctDelta(enqInRange.length, enqPrev.length)}
                    to="/pipeline"
                    accent="bg-gradient-to-br from-violet-100 to-purple-50"
                    hint={`${conversion.won} won · ${conversion.lost} lost`}
                  />
                  <KpiCard
                    label="Win rate"
                    value={`${conversion.rate}%`}
                    delta={pctDelta(conversion.rate, conversionPrev.rate)}
                    hint="Won ÷ (won + lost)"
                    accent="bg-gradient-to-br from-amber-100 to-orange-50"
                  />
                  <KpiCard
                    label="Revenue received"
                    value={`₹${revenue.toLocaleString('en-IN')}`}
                    delta={pctDelta(revenue, revenuePrev)}
                    accent="bg-gradient-to-br from-emerald-100 to-teal-50"
                    hint="From payments"
                  />
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <KpiCard
                    label="Unread inbox"
                    value={inbox.unread}
                    to="/inbox"
                    accent="bg-gradient-to-br from-rose-100 to-pink-50"
                    hint={`${inbox.withUnread} chats`}
                  />
                  <KpiCard
                    label="Stale chats (48h+)"
                    value={inbox.stale}
                    to="/inbox"
                    accent="bg-gradient-to-br from-slate-100 to-gray-50"
                  />
                  <KpiCard
                    label="Unassigned leads"
                    value={backlog.enquiries}
                    to="/pipeline"
                    accent="bg-gradient-to-br from-yellow-100 to-amber-50"
                    hint={`avg ${backlog.avgAgeDays}d old`}
                  />
                  <KpiCard
                    label="Overdue follow-ups"
                    value={fu.overdue}
                    to="/followups"
                    accent="bg-gradient-to-br from-red-100 to-orange-50"
                    hint={`${fu.dueToday} due today`}
                  />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                  <Panel
                    title="Trends"
                    subtitle="Weekly leads, sales & revenue"
                    className="lg:col-span-3"
                  >
                    <GradientAreaChart series={trends} />
                  </Panel>
                  <Panel title="Payments" subtitle="By status in range" className="lg:col-span-2">
                    <GradientDonut
                      data={payBreak.map((p) => ({
                        key: p.key,
                        label: p.label,
                        value: p.amount,
                        color: p.color,
                        gradient: p.gradient,
                      }))}
                      centerLabel="total"
                      centerValue={`₹${Math.round(payBreak.reduce((s, p) => s + p.amount, 0) / 1000)}k`}
                      formatValue={(n) => `₹${n.toLocaleString('en-IN')}`}
                    />
                  </Panel>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Panel title="Lost reasons" subtitle="Closed-lost in selected range">
                    {lost.every((l) => l.value === 0) ? (
                      <p className="text-sm text-gray-400 py-8 text-center">No lost deals in this range.</p>
                    ) : (
                      <GradientDonut data={lost} centerLabel="lost" />
                    )}
                  </Panel>
                  <Panel title="Unassigned aging" subtitle="Open enquiries with no owner">
                    {backlog.aging.length === 0 ? (
                      <p className="text-sm text-gray-400 py-8 text-center">All open leads are assigned.</p>
                    ) : (
                      <div className="space-y-2 max-h-56 overflow-y-auto">
                        {backlog.aging
                          .sort((a, b) => b.days - a.days)
                          .slice(0, 8)
                          .map((a) => {
                            const name = customers.find((c) => c.id === a.customerId)?.name ?? 'Customer'
                            return (
                              <Link
                                key={a.id}
                                to={`/customers/${a.customerId}`}
                                className="flex items-center justify-between text-sm rounded-lg px-2 py-1.5 hover:bg-gray-50"
                              >
                                <span className="truncate text-gray-800 font-medium">{name}</span>
                                <span className="text-xs text-amber-700 font-semibold">{a.days}d</span>
                              </Link>
                            )
                          })}
                      </div>
                    )}
                  </Panel>
                </div>
              </div>
            )}

            {tab === 'pipeline' && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Panel title="Live funnel" subtitle="Current open + completed pipeline counts">
                    <HorizontalFunnel data={funnel} />
                  </Panel>
                  <Panel title="Stage velocity" subtitle="Avg age (days) of deals currently in stage">
                    <GradientBarChart
                      data={velocity.map((v) => ({
                        key: v.key,
                        label: v.label.split(' ')[0],
                        value: v.days,
                        color: v.color,
                        gradient: v.gradient,
                      }))}
                      valueSuffix="d"
                    />
                  </Panel>
                </div>
                <Panel title="Stage counts" subtitle="Tap a stage concept via Pipeline board">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {funnel.map((s) => (
                      <Link
                        key={s.key}
                        to="/pipeline"
                        className="rounded-xl p-3 border border-gray-100 hover:border-emerald-200 transition-colors"
                        style={{
                          background: `linear-gradient(135deg, ${s.gradient?.[0]}22, ${s.gradient?.[1]}11)`,
                        }}
                      >
                        <p className="text-xl font-bold text-gray-900 tabular-nums">{s.value}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                      </Link>
                    ))}
                  </div>
                </Panel>
                <Panel title="Lost / excluded" subtitle="Not interested, lost, spam, duplicate (in range)">
                  <GradientBarChart data={lost} height={180} />
                </Panel>
              </div>
            )}

            {tab === 'team' && (
              <div className="space-y-5">
                <Panel title="Team performance" subtitle={`Leads created in ${range.label.toLowerCase()}`}>
                  {team.length === 0 ? (
                    <p className="text-sm text-gray-400 py-10 text-center">No assignee data yet.</p>
                  ) : (
                    <>
                      <GradientBarChart
                        data={team.slice(0, 8).map((t) => ({
                          key: t.key,
                          label: t.name.split('@')[0].slice(0, 8),
                          value: t.won,
                          gradient: ['#6ee7b7', '#059669'] as [string, string],
                        }))}
                        height={200}
                      />
                      {/* Mobile cards */}
                      <div className="md:hidden space-y-2 mt-4">
                        {team.map((t) => (
                          <div key={t.key} className="rounded-xl border border-gray-100 p-3 bg-gradient-to-br from-white to-emerald-50/40">
                            <p className="font-medium text-gray-800 truncate">{t.name}</p>
                            <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                              <span className="text-gray-500">Leads <strong className="text-gray-800">{t.leads}</strong></span>
                              <span className="text-gray-500">Open <strong className="text-gray-800">{t.open}</strong></span>
                              <span className="text-gray-500">Won <strong className="text-emerald-700">{t.won}</strong></span>
                              <span className="text-gray-500">Revenue <strong className="text-gray-800">₹{t.revenue.toLocaleString('en-IN')}</strong></span>
                              <span className={`col-span-2 ${t.overdue ? 'text-rose-600' : 'text-gray-400'}`}>
                                Overdue FU: <strong>{t.overdue}</strong>
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 overflow-x-auto hidden md:block">
                        <table className="w-full min-w-[560px] text-sm">
                          <thead>
                            <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                              <th className="py-2 font-medium">Assignee</th>
                              <th className="py-2 font-medium text-right">Leads</th>
                              <th className="py-2 font-medium text-right">Open</th>
                              <th className="py-2 font-medium text-right">Won</th>
                              <th className="py-2 font-medium text-right">Revenue</th>
                              <th className="py-2 font-medium text-right">Overdue FU</th>
                            </tr>
                          </thead>
                          <tbody>
                            {team.map((t) => (
                              <tr key={t.key} className="border-b border-gray-50 hover:bg-emerald-50/40">
                                <td className="py-2.5 font-medium text-gray-800">{t.name}</td>
                                <td className="py-2.5 text-right tabular-nums">{t.leads}</td>
                                <td className="py-2.5 text-right tabular-nums">{t.open}</td>
                                <td className="py-2.5 text-right tabular-nums text-emerald-700 font-semibold">{t.won}</td>
                                <td className="py-2.5 text-right tabular-nums">₹{t.revenue.toLocaleString('en-IN')}</td>
                                <td className={`py-2.5 text-right tabular-nums ${t.overdue ? 'text-rose-600 font-semibold' : 'text-gray-400'}`}>
                                  {t.overdue}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </Panel>
              </div>
            )}

            {tab === 'followups' && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <KpiCard label="Pending" value={fu.pending} to="/followups" accent="bg-gradient-to-br from-slate-100 to-gray-50" />
                  <KpiCard label="Overdue" value={fu.overdue} to="/followups" accent="bg-gradient-to-br from-red-100 to-rose-50" />
                  <KpiCard label="Due today" value={fu.dueToday} to="/followups" accent="bg-gradient-to-br from-amber-100 to-yellow-50" />
                  <KpiCard
                    label="Completion rate"
                    value={`${fu.completionRate}%`}
                    accent="bg-gradient-to-br from-emerald-100 to-teal-50"
                    hint={fu.avgHours != null ? `avg ${fu.avgHours}h to done` : undefined}
                  />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Panel title="Follow-up mix" subtitle="Pending vs completed in view">
                    <GradientDonut
                      data={[
                        { key: 'pending', label: 'Pending', value: pending.length, gradient: ['#fcd34d', '#f59e0b'] },
                        { key: 'done', label: 'Completed', value: completed.length, gradient: ['#6ee7b7', '#059669'] },
                        { key: 'overdue', label: 'Overdue', value: fu.overdue, gradient: ['#fda4af', '#e11d48'] },
                      ]}
                      centerLabel="tasks"
                      centerValue={String(allFollowups.length)}
                    />
                  </Panel>
                  <Panel title="Created vs done" subtitle="In selected date range">
                    <GradientBarChart
                      data={[
                        { key: 'created', label: 'Created', value: fu.createdInRange, gradient: ['#93c5fd', '#2563eb'] },
                        { key: 'completed', label: 'Completed', value: fu.completed, gradient: ['#86efac', '#16a34a'] },
                        { key: 'overdue', label: 'Overdue now', value: fu.overdue, gradient: ['#fda4af', '#e11d48'] },
                      ]}
                      height={200}
                    />
                  </Panel>
                </div>
                <p className="text-xs text-gray-400 text-center">
                  Tip: open <Link to="/followups" className="text-emerald-600 hover:underline">Follow-ups</Link> to work overdue items.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
