import type { Enquiry, EnquiryStatus, Followup, Conversation, Customer } from '../types'

export type DateRangeKey = 'today' | '7d' | '30d' | '90d' | 'all' | 'custom'

export interface DateRange {
  key: DateRangeKey
  from: Date | null
  to: Date
  label: string
}

export interface PaymentRow {
  id: string
  customerId: string
  amount: number
  currency: string
  method: string
  status: string
  recordedBy: string
  createdAt: string
}

export interface ActivityRow {
  id: string
  enquiryId: string
  type: string
  description: string
  createdAt: string
}

export const ACTIVE_FUNNEL: { key: EnquiryStatus; label: string; color: string; gradient: [string, string] }[] = [
  { key: 'new_lead', label: 'New Lead', color: '#94a3b8', gradient: ['#cbd5e1', '#94a3b8'] },
  { key: 'assigned', label: 'Assigned', color: '#60a5fa', gradient: ['#93c5fd', '#3b82f6'] },
  { key: 'contact_attempted', label: 'Contacted', color: '#38bdf8', gradient: ['#7dd3fc', '#0ea5e9'] },
  { key: 'interested', label: 'Interested', color: '#fbbf24', gradient: ['#fcd34d', '#f59e0b'] },
  { key: 'confused', label: 'Confused', color: '#818cf8', gradient: ['#a5b4fc', '#6366f1'] },
  { key: 'follow_up_required', label: 'Follow-up req.', color: '#fb923c', gradient: ['#fdba74', '#f97316'] },
  { key: 'negotiation', label: 'Negotiation', color: '#a78bfa', gradient: ['#c4b5fd', '#8b5cf6'] },
  { key: 'ready_to_buy', label: 'Ready to Buy', color: '#2dd4bf', gradient: ['#5eead4', '#14b8a6'] },
  { key: 'payment_pending', label: 'Payment pending', color: '#f472b6', gradient: ['#f9a8d4', '#ec4899'] },
  { key: 'sale_completed', label: 'Completed', color: '#22c55e', gradient: ['#4ade80', '#16a34a'] },
]

export const LOST_STAGES: { key: EnquiryStatus; label: string; color: string; gradient: [string, string] }[] = [
  { key: 'not_interested', label: 'Not interested', color: '#f87171', gradient: ['#fca5a5', '#ef4444'] },
  { key: 'lost', label: 'Lost', color: '#fb7185', gradient: ['#fda4af', '#f43f5e'] },
  { key: 'spam', label: 'Spam', color: '#a8a29e', gradient: ['#d6d3d1', '#78716c'] },
  { key: 'duplicate', label: 'Duplicate', color: '#c084fc', gradient: ['#d8b4fe', '#a855f7'] },
]

const LOST_KEYS = new Set(LOST_STAGES.map((s) => s.key))
const WON_KEYS = new Set<EnquiryStatus>(['sale_completed', 'after_sales', 'repeat_customer'])

export function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function endOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

export function resolveRange(
  key: DateRangeKey,
  customFrom?: string,
  customTo?: string
): DateRange {
  const now = new Date()
  const to = endOfDay(now)

  if (key === 'all') return { key, from: null, to, label: 'All time' }
  if (key === 'today') return { key, from: startOfDay(now), to, label: 'Today' }
  if (key === 'custom') {
    const from = customFrom ? startOfDay(new Date(customFrom)) : startOfDay(now)
    const end = customTo ? endOfDay(new Date(customTo)) : to
    return { key, from, to: end, label: 'Custom' }
  }

  const days = key === '7d' ? 7 : key === '30d' ? 30 : 90
  const from = startOfDay(new Date(now))
  from.setDate(from.getDate() - (days - 1))
  return {
    key,
    from,
    to,
    label: key === '7d' ? 'Last 7 days' : key === '30d' ? 'Last 30 days' : 'Last 90 days',
  }
}

/** Previous period of equal length (for deltas). */
export function previousRange(range: DateRange): DateRange {
  if (!range.from) {
    return { key: 'all', from: null, to: range.to, label: '—' }
  }
  const ms = range.to.getTime() - range.from.getTime()
  const to = new Date(range.from.getTime() - 1)
  const from = new Date(to.getTime() - ms)
  return { key: range.key, from, to, label: 'Previous' }
}

export function inRange(iso: string | undefined | null, range: DateRange): boolean {
  if (!iso) return range.from === null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return false
  if (range.from && t < range.from.getTime()) return false
  if (t > range.to.getTime()) return false
  return true
}

export function isMine(
  assignedTo: string | null | undefined,
  me: { email?: string | null; id?: string | null; label?: string | null }
): boolean {
  if (!assignedTo?.trim()) return false
  return (
    assignedTo === me.email
    || assignedTo === me.id
    || (!!me.label && assignedTo === me.label)
  )
}

export function filterByAssignee<T extends { assignedTo?: string | null }>(
  items: T[],
  scope: 'mine' | 'all',
  me: { email?: string | null; id?: string | null; label?: string | null }
): T[] {
  if (scope === 'all') return items
  return items.filter((i) => isMine(i.assignedTo, me))
}

export function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return Math.round(((current - previous) / previous) * 100)
}

export function closedConversion(enquiries: Enquiry[]) {
  const won = enquiries.filter((e) => WON_KEYS.has(e.status)).length
  const lost = enquiries.filter((e) => LOST_KEYS.has(e.status)).length
  const decided = won + lost
  return {
    won,
    lost,
    decided,
    rate: decided > 0 ? Math.round((won / decided) * 100) : 0,
  }
}

export function stageCounts(enquiries: Enquiry[], stages: { key: EnquiryStatus; label: string }[]) {
  return stages.map((s) => ({
    ...s,
    count: enquiries.filter((e) => e.status === s.key).length,
  }))
}

/** Avg age (days) of open enquiries currently sitting in each stage. */
export function stageVelocityDays(enquiries: Enquiry[]) {
  const now = Date.now()
  return ACTIVE_FUNNEL.filter((s) => s.key !== 'sale_completed').map((s) => {
    const inStage = enquiries.filter((e) => e.status === s.key)
    if (!inStage.length) return { key: s.key, label: s.label, days: 0, count: 0, color: s.color, gradient: s.gradient }
    const avgMs =
      inStage.reduce((sum, e) => sum + (now - new Date(e.createdAt).getTime()), 0) / inStage.length
    return {
      key: s.key,
      label: s.label,
      days: Math.round(avgMs / (1000 * 60 * 60 * 24)),
      count: inStage.length,
      color: s.color,
      gradient: s.gradient,
    }
  })
}

export function weeklyBuckets(range: DateRange): { start: Date; end: Date; label: string }[] {
  const buckets: { start: Date; end: Date; label: string }[] = []
  const end = startOfDay(range.to)
  let cursor = range.from ? startOfDay(range.from) : (() => {
    const d = startOfDay(range.to)
    d.setDate(d.getDate() - 83) // ~12 weeks
    return d
  })()

  // Align to week start (Mon)
  const day = cursor.getDay()
  const diff = day === 0 ? -6 : 1 - day
  cursor.setDate(cursor.getDate() + diff)

  while (cursor <= end) {
    const start = new Date(cursor)
    const weekEnd = new Date(cursor)
    weekEnd.setDate(weekEnd.getDate() + 6)
    weekEnd.setHours(23, 59, 59, 999)
    buckets.push({
      start,
      end: weekEnd > range.to ? range.to : weekEnd,
      label: start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    })
    cursor.setDate(cursor.getDate() + 7)
  }
  return buckets.slice(-12)
}

export function trendSeries(
  enquiries: Enquiry[],
  payments: PaymentRow[],
  range: DateRange
) {
  const buckets = weeklyBuckets(range)
  return buckets.map((b) => {
    const leads = enquiries.filter((e) => {
      const t = new Date(e.createdAt).getTime()
      return t >= b.start.getTime() && t <= b.end.getTime()
    }).length
    const sales = enquiries.filter((e) => {
      if (!WON_KEYS.has(e.status)) return false
      const t = new Date(e.createdAt).getTime()
      return t >= b.start.getTime() && t <= b.end.getTime()
    }).length
    const revenue = payments
      .filter((p) => {
        if (p.status !== 'received') return false
        const t = new Date(p.createdAt).getTime()
        return t >= b.start.getTime() && t <= b.end.getTime()
      })
      .reduce((s, p) => s + p.amount, 0)
    return { label: b.label, leads, sales, revenue }
  })
}

export function assigneeStats(
  enquiries: Enquiry[],
  payments: PaymentRow[],
  followups: Followup[],
  customers: Customer[],
  labelFor: (id: string) => string
) {
  const keys = new Set<string>()
  for (const e of enquiries) if (e.assignedTo?.trim()) keys.add(e.assignedTo.trim())
  for (const c of customers) if (c.assignedTo?.trim()) keys.add(c.assignedTo.trim())
  for (const f of followups) if (f.assignedTo?.trim()) keys.add(f.assignedTo.trim())

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return [...keys]
    .map((key) => {
      const mine = enquiries.filter((e) => e.assignedTo === key)
      const won = mine.filter((e) => WON_KEYS.has(e.status)).length
      const open = mine.filter((e) => !WON_KEYS.has(e.status) && !LOST_KEYS.has(e.status)).length
      const revenue = payments
        .filter((p) => p.status === 'received' && p.recordedBy === key)
        .reduce((s, p) => s + p.amount, 0)
      // Also attribute enquiry value on completed assigned to them
      const enquiryRevenue = mine
        .filter((e) => WON_KEYS.has(e.status))
        .reduce((s, e) => s + (e.value ?? 0), 0)
      const overdue = followups.filter((f) => {
        if (f.completed || f.assignedTo !== key || !f.dueDate) return false
        return new Date(f.dueDate) < today
      }).length
      return {
        key,
        name: labelFor(key),
        leads: mine.length,
        open,
        won,
        revenue: Math.max(revenue, enquiryRevenue),
        overdue,
      }
    })
    .sort((a, b) => b.won - a.won || b.leads - a.leads)
}

export function followupMetrics(followups: Followup[], range: DateRange) {
  const today = startOfDay(new Date())
  const pending = followups.filter((f) => !f.completed)
  const completed = followups.filter((f) => f.completed && inRange(f.completedAt ?? f.dueDate, range))
  const createdInRange = followups.filter((f) => inRange(f.createdAt ?? f.dueDate, range))
  const overdue = pending.filter((f) => f.dueDate && new Date(f.dueDate) < today)
  const dueToday = pending.filter((f) => {
    if (!f.dueDate) return false
    const d = new Date(f.dueDate)
    return d >= today && d <= endOfDay(today)
  })
  const completionDenom = completed.length + overdue.length
  const completionRate = completionDenom > 0
    ? Math.round((completed.length / (completed.length + pending.length || 1)) * 100)
    : completed.length > 0 ? 100 : 0

  // Avg hours to complete for completed with completedAt
  const withDone = completed.filter((f) => f.completedAt && f.createdAt)
  const avgHours = withDone.length
    ? Math.round(
        withDone.reduce((s, f) => {
          return s + (new Date(f.completedAt!).getTime() - new Date(f.createdAt!).getTime())
        }, 0) /
          withDone.length /
          (1000 * 60 * 60)
      )
    : null

  return {
    pending: pending.length,
    overdue: overdue.length,
    dueToday: dueToday.length,
    completed: completed.length,
    createdInRange: createdInRange.length,
    completionRate,
    avgHours,
  }
}

export function paymentBreakdown(payments: PaymentRow[]) {
  const statuses = ['received', 'pending', 'refunded'] as const
  const colors: Record<string, { color: string; gradient: [string, string] }> = {
    received: { color: '#22c55e', gradient: ['#4ade80', '#16a34a'] },
    pending: { color: '#f59e0b', gradient: ['#fbbf24', '#d97706'] },
    refunded: { color: '#f43f5e', gradient: ['#fb7185', '#e11d48'] },
  }
  return statuses.map((status) => {
    const rows = payments.filter((p) => p.status === status)
    return {
      key: status,
      label: status.charAt(0).toUpperCase() + status.slice(1),
      count: rows.length,
      amount: rows.reduce((s, p) => s + p.amount, 0),
      ...colors[status],
    }
  })
}

export function inboxHealth(conversations: Conversation[]) {
  const unread = conversations.reduce((s, c) => s + (c.unreadCount || 0), 0)
  const withUnread = conversations.filter((c) => (c.unreadCount || 0) > 0).length
  const stale = conversations.filter((c) => {
    if (!c.updatedAt) return false
    const age = Date.now() - new Date(c.updatedAt).getTime()
    return age > 1000 * 60 * 60 * 48 // 48h
  }).length
  return { unread, withUnread, stale, total: conversations.length }
}

export function unassignedBacklog(enquiries: Enquiry[], customers: Customer[]) {
  const unassignedEnquiries = enquiries.filter((e) => !e.assignedTo?.trim() && !WON_KEYS.has(e.status) && !LOST_KEYS.has(e.status))
  const unassignedCustomers = customers.filter((c) => !c.assignedTo?.trim())
  const now = Date.now()
  const aging = unassignedEnquiries.map((e) => ({
    id: e.id,
    customerId: e.customerId,
    days: Math.max(0, Math.round((now - new Date(e.createdAt).getTime()) / (1000 * 60 * 60 * 24))),
    status: e.status,
  }))
  const avgAge = aging.length
    ? Math.round(aging.reduce((s, a) => s + a.days, 0) / aging.length)
    : 0
  return {
    enquiries: unassignedEnquiries.length,
    customers: unassignedCustomers.length,
    avgAgeDays: avgAge,
    aging,
  }
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v ?? '')
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
