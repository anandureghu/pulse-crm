import type { Conversation, Customer, EnquiryStatus } from '../types'
import { ACTIVE_FUNNEL, LOST_STAGES } from './analytics'

export type UnreadFilter = 'all' | 'unread' | 'read'
export type ActivityFilter = 'all' | 'today' | '7d' | 'stale'
/** 'all' | 'me' | 'unassigned' | 'other' | specific assignee label */
export type AssigneeFilterValue = string
/** 'all' | 'none' | EnquiryStatus */
export type StatusFilterValue = string
/** 'all' | 'none' | tag name */
export type TagFilterValue = string

export interface InboxFilters {
  unread: UnreadFilter
  assignee: AssigneeFilterValue
  status: StatusFilterValue
  activity: ActivityFilter
  tag: TagFilterValue
}

export const DEFAULT_INBOX_FILTERS: InboxFilters = {
  unread: 'all',
  assignee: 'all',
  status: 'all',
  activity: 'all',
  tag: 'all',
}

export const INBOX_STATUS_OPTIONS: { value: StatusFilterValue; label: string }[] = [
  { value: 'all', label: 'Any status' },
  { value: 'none', label: 'No enquiry' },
  ...ACTIVE_FUNNEL.map((s) => ({ value: s.key, label: s.label })),
  { value: 'after_sales', label: 'After sales' },
  { value: 'repeat_customer', label: 'Repeat customer' },
  ...LOST_STAGES.map((s) => ({ value: s.key, label: s.label })),
]

export const UNREAD_OPTIONS: { value: UnreadFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread only' },
  { value: 'read', label: 'Read only' },
]

export const ACTIVITY_OPTIONS: { value: ActivityFilter; label: string }[] = [
  { value: 'all', label: 'Any time' },
  { value: 'today', label: 'Active today' },
  { value: '7d', label: 'Last 7 days' },
  { value: 'stale', label: 'Stale (48h+)' },
]

const STALE_MS = 1000 * 60 * 60 * 48
const DAY_MS = 1000 * 60 * 60 * 24

export function isDefaultInboxFilters(f: InboxFilters): boolean {
  return (
    f.unread === DEFAULT_INBOX_FILTERS.unread
    && f.assignee === DEFAULT_INBOX_FILTERS.assignee
    && f.status === DEFAULT_INBOX_FILTERS.status
    && f.activity === DEFAULT_INBOX_FILTERS.activity
    && f.tag === DEFAULT_INBOX_FILTERS.tag
  )
}

export function countActiveInboxFilters(f: InboxFilters): number {
  let n = 0
  if (f.unread !== 'all') n += 1
  if (f.assignee !== 'all') n += 1
  if (f.status !== 'all') n += 1
  if (f.activity !== 'all') n += 1
  if (f.tag !== 'all') n += 1
  return n
}

export function inboxFilterSummaries(
  f: InboxFilters,
  meLabel: string,
): { key: keyof InboxFilters; label: string }[] {
  const out: { key: keyof InboxFilters; label: string }[] = []
  if (f.unread === 'unread') out.push({ key: 'unread', label: 'Unread' })
  if (f.unread === 'read') out.push({ key: 'unread', label: 'Read' })
  if (f.assignee === 'me') out.push({ key: 'assignee', label: meLabel ? `Mine (${meLabel})` : 'Assigned to me' })
  if (f.assignee === 'unassigned') out.push({ key: 'assignee', label: 'Unassigned' })
  if (f.assignee === 'other') out.push({ key: 'assignee', label: 'Not me' })
  if (f.assignee !== 'all' && f.assignee !== 'me' && f.assignee !== 'unassigned' && f.assignee !== 'other') {
    out.push({ key: 'assignee', label: f.assignee })
  }
  if (f.status === 'none') out.push({ key: 'status', label: 'No enquiry' })
  if (f.status !== 'all' && f.status !== 'none') {
    const opt = INBOX_STATUS_OPTIONS.find((o) => o.value === f.status)
    out.push({ key: 'status', label: opt?.label ?? f.status.replace(/_/g, ' ') })
  }
  if (f.activity === 'today') out.push({ key: 'activity', label: 'Today' })
  if (f.activity === '7d') out.push({ key: 'activity', label: 'Last 7 days' })
  if (f.activity === 'stale') out.push({ key: 'activity', label: 'Stale 48h+' })
  if (f.tag === 'none') out.push({ key: 'tag', label: 'No tags' })
  if (f.tag !== 'all' && f.tag !== 'none') out.push({ key: 'tag', label: `#${f.tag}` })
  return out
}

export function matchesUnread(c: Conversation, filter: UnreadFilter): boolean {
  if (filter === 'all') return true
  const unread = (c.unreadCount || 0) > 0
  return filter === 'unread' ? unread : !unread
}

export function matchesAssignee(
  assignee: string | null,
  filter: AssigneeFilterValue,
  meLabel: string,
): boolean {
  if (filter === 'all') return true
  const a = assignee?.trim() || null
  if (filter === 'unassigned') return !a
  if (filter === 'me') return Boolean(meLabel) && a === meLabel
  if (filter === 'other') return !meLabel || a !== meLabel
  return a === filter
}

export function matchesStatus(
  status: EnquiryStatus | null,
  filter: StatusFilterValue,
): boolean {
  if (filter === 'all') return true
  if (filter === 'none') return !status
  return status === filter
}

export function matchesActivity(updatedAt: string | undefined, filter: ActivityFilter): boolean {
  if (filter === 'all') return true
  if (!updatedAt) return false
  const age = Date.now() - new Date(updatedAt).getTime()
  if (Number.isNaN(age)) return false
  if (filter === 'stale') return age > STALE_MS
  if (filter === 'today') {
    const d = new Date(updatedAt)
    const now = new Date()
    return d.toDateString() === now.toDateString()
  }
  if (filter === '7d') return age <= 7 * DAY_MS
  return true
}

export function matchesTag(customer: Customer | undefined, filter: TagFilterValue): boolean {
  if (filter === 'all') return true
  const tags = customer?.tags ?? []
  if (filter === 'none') return tags.length === 0 && !customer?.shopifyCustomerId
  if (filter.toLowerCase() === 'shopify') {
    return tags.some((t) => t.toLowerCase() === 'shopify') || Boolean(customer?.shopifyCustomerId)
  }
  return tags.some((t) => t === filter)
}

export function collectAssigneeOptions(
  customers: Customer[],
  teamLabels: string[],
): string[] {
  const set = new Set<string>()
  for (const label of teamLabels) {
    const t = label.trim()
    if (t) set.add(t)
  }
  for (const c of customers) {
    const a = c.assignedTo?.trim()
    if (a) set.add(a)
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

export function collectTagOptions(customers: Customer[]): string[] {
  const set = new Set<string>()
  let hasShopify = false
  for (const c of customers) {
    for (const t of c.tags ?? []) {
      const trimmed = t.trim()
      if (!trimmed) continue
      if (trimmed.toLowerCase() === 'shopify') {
        hasShopify = true
        continue
      }
      set.add(trimmed)
    }
    if (c.shopifyCustomerId) hasShopify = true
  }
  const tags = Array.from(set).sort((a, b) => a.localeCompare(b))
  return hasShopify ? ['shopify', ...tags] : tags
}
