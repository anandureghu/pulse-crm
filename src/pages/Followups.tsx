import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useFollowups, useEnrichedFollowups } from '../hooks/useFollowups'
import { useUsers } from '../hooks/useUsers'
import { useAuthStore } from '../store/authStore'
import { userLabel } from '../lib/db'
import { toast } from '../components/Toast'
import { FollowupFormModal } from '../components/FollowupFormModal'
import { CustomerNotesModal } from '../components/CustomerNotesModal'
import { formatPhoneDisplay, telHref } from '../lib/phone'
import type { EnrichedFollowup } from '../types'

type MainTab = 'pending' | 'completed'
type PeriodTab = 'overdue' | 'today' | 'upcoming'
type Scope = 'mine' | 'all'
type SortKey = 'due' | 'customer' | 'assignee'

/** Local calendar date YYYY-MM-DD (avoids UTC off-by-one). */
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

function formatDueDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function formatDueTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function addDaysAtSameTime(iso: string, days: number) {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

function tomorrowNineIso() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d.toISOString()
}

export default function Followups() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const users = useUsers()
  const {
    pending,
    completed,
    loading,
    complete,
    uncomplete,
    update,
    remove,
  } = useFollowups()

  const { enriched: pendingEnriched, enriching: enrichingPending } = useEnrichedFollowups(pending)
  const { enriched: completedEnriched, enriching: enrichingCompleted } = useEnrichedFollowups(completed)

  const [tab, setTab] = useState<MainTab>('pending')
  const [period, setPeriod] = useState<PeriodTab>('today')
  const [scope, setScope] = useState<Scope>('mine')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('due')
  const [selectMode, setSelectMode] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<EnrichedFollowup | null>(null)
  const [notesFor, setNotesFor] = useState<EnrichedFollowup | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const assigneeLabel = (assignedTo: string) => {
    const u = users.find((x) => x.email === assignedTo || x.id === assignedTo)
    return u ? userLabel(u) : assignedTo
  }

  const isMine = (f: { assignedTo: string }) =>
    !!user && (f.assignedTo === user.email || f.assignedTo === user.id)

  const filterList = (list: EnrichedFollowup[], forCompleted: boolean) => {
    const q = search.trim().toLowerCase()
    let next = list.filter((f) => {
      if (scope === 'mine' && !isMine(f)) return false
      if (!q) return true
      return (
        f.customerName.toLowerCase().includes(q) ||
        f.note.toLowerCase().includes(q) ||
        f.assignedTo.toLowerCase().includes(q) ||
        (f.customerPhone ?? '').includes(q)
      )
    })

    next = [...next].sort((a, b) => {
      if (sort === 'customer') return a.customerName.localeCompare(b.customerName)
      if (sort === 'assignee') return a.assignedTo.localeCompare(b.assignedTo)
      if (forCompleted) {
        const aT = a.completedAt ? new Date(a.completedAt).getTime() : 0
        const bT = b.completedAt ? new Date(b.completedAt).getTime() : 0
        if (aT !== bT) return bT - aT
      }
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    })
    return next
  }

  const filteredPending = useMemo(
    () => filterList(pendingEnriched, false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingEnriched, scope, search, sort, user]
  )
  const filteredCompleted = useMemo(
    () => filterList(completedEnriched, true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [completedEnriched, scope, search, sort, user]
  )

  const today = localDateKey()
  const overdue = filteredPending.filter((f) => dueDateKey(f.dueDate) < today)
  const todayItems = filteredPending.filter((f) => dueDateKey(f.dueDate) === today)
  const upcoming = filteredPending.filter((f) => dueDateKey(f.dueDate) > today)

  const periodItems =
    period === 'overdue' ? overdue : period === 'today' ? todayItems : upcoming

  const headerCounts = useMemo(() => {
    const scoped = pendingEnriched.filter((f) => (scope === 'mine' ? isMine(f) : true))
    const t = localDateKey()
    const scopedCompleted = completed.filter((f) => (scope === 'mine' ? isMine(f) : true))
    return {
      overdue: scoped.filter((f) => dueDateKey(f.dueDate) < t).length,
      today: scoped.filter((f) => dueDateKey(f.dueDate) === t).length,
      upcoming: scoped.filter((f) => dueDateKey(f.dueDate) > t).length,
      completed: scopedCompleted.length,
    }
  }, [pendingEnriched, completed, scope, user])

  const markBusy = (id: string, on: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const handleComplete = async (id: string) => {
    markBusy(id, true)
    const ok = await complete(id)
    markBusy(id, false)
    if (ok) {
      toast('Marked complete', 'success')
      setSelected((s) => {
        const n = new Set(s)
        n.delete(id)
        return n
      })
    }
  }

  const handleUncomplete = async (id: string) => {
    markBusy(id, true)
    await uncomplete(id)
    markBusy(id, false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this follow-up?')) return
    markBusy(id, true)
    await remove(id)
    markBusy(id, false)
    setOpenMenuId(null)
  }

  const handleSnooze = async (f: EnrichedFollowup, kind: 'tomorrow' | 'plus3') => {
    markBusy(f.id, true)
    const dueDate = kind === 'tomorrow' ? tomorrowNineIso() : addDaysAtSameTime(f.dueDate, 3)
    const ok = await update(f.id, { dueDate })
    markBusy(f.id, false)
    if (ok) toast(kind === 'tomorrow' ? 'Snoozed to tomorrow 9am' : 'Snoozed +3 days', 'success')
    setOpenMenuId(null)
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const bulkComplete = async () => {
    const ids = [...selected]
    for (const id of ids) await complete(id)
    setSelected(new Set())
    setSelectMode(false)
    toast(`Completed ${ids.length} follow-up${ids.length === 1 ? '' : 's'}`, 'success')
  }

  const bulkReassign = async (email: string) => {
    if (!email) return
    const ids = [...selected]
    for (const id of ids) await update(id, { assignedTo: email })
    setSelected(new Set())
    setSelectMode(false)
    toast(`Reassigned ${ids.length} follow-up${ids.length === 1 ? '' : 's'}`, 'success')
  }

  const enriching = enrichingPending || (tab === 'completed' && enrichingCompleted)

  return (
    <div className="p-4 sm:p-6 max-w-full min-w-0" onClick={() => setOpenMenuId(null)}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">Follow-ups</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Scheduled tasks — separate from the pipeline “Follow-up required” status
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="bg-green-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-green-700"
        >
          + Schedule
        </button>
      </div>

      <div className="flex gap-1 border-b border-gray-200 mb-3">
        {(
          [
            {
              key: 'pending' as const,
              label: 'Pending',
              count: headerCounts.overdue + headerCounts.today + headerCounts.upcoming,
            },
            { key: 'completed' as const, label: 'Completed', count: headerCounts.completed },
          ]
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key)
              setSelected(new Set())
              setSelectMode(false)
              setOpenMenuId(null)
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs text-gray-400">{t.count}</span>
          </button>
        ))}
      </div>

      {tab === 'pending' && (
        <div className="flex gap-1 border-b border-gray-100 mb-4 overflow-x-auto">
          {(
            [
              { key: 'overdue' as const, label: 'Overdue', count: overdue.length, active: 'border-red-500 text-red-600', idle: 'text-red-400/70' },
              { key: 'today' as const, label: 'Today', count: todayItems.length, active: 'border-amber-500 text-amber-700', idle: 'text-amber-600/60' },
              { key: 'upcoming' as const, label: 'Upcoming', count: upcoming.length, active: 'border-gray-500 text-gray-700', idle: 'text-gray-400' },
            ]
          ).map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => {
                setPeriod(p.key)
                setSelected(new Set())
                setOpenMenuId(null)
              }}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                period === p.key
                  ? p.active
                  : `border-transparent hover:text-gray-700 ${p.idle}`
              }`}
            >
              {p.label}
              <span className="ml-1.5 text-xs opacity-70">{p.count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
          {(
            [
              { key: 'mine' as const, label: 'Mine' },
              { key: 'all' as const, label: 'All team' },
            ]
          ).map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setScope(s.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                scope === s.key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer, note, assignee…"
          className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          <option value="due">Sort: due date</option>
          <option value="customer">Sort: customer</option>
          <option value="assignee">Sort: assignee</option>
        </select>

        {tab === 'pending' && (
          <button
            type="button"
            onClick={() => {
              setSelectMode((v) => !v)
              setSelected(new Set())
            }}
            className={`text-xs px-3 py-2 rounded-lg border ${
              selectMode
                ? 'border-green-500 bg-green-50 text-green-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {selectMode ? 'Cancel select' : 'Select'}
          </button>
        )}
      </div>

      {tab === 'pending' && selectMode && selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 bg-green-50 border border-green-100 rounded-xl px-3 py-2">
          <span className="text-sm text-green-800 font-medium">{selected.size} selected</span>
          <button
            type="button"
            onClick={bulkComplete}
            className="text-xs px-2.5 py-1 rounded-lg bg-green-600 text-white hover:bg-green-700"
          >
            Complete
          </button>
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) bulkReassign(e.target.value)
              e.target.value = ''
            }}
            className="text-xs border border-green-200 rounded-lg px-2 py-1 bg-white"
          >
            <option value="">Reassign to…</option>
            {users.map((u) => (
              <option key={u.id} value={u.email}>{userLabel(u)}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs text-gray-500 hover:text-gray-700 ml-auto"
          >
            Clear
          </button>
        </div>
      )}

      {loading || enriching ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : tab === 'pending' ? (
        filteredPending.length === 0 ? (
          <EmptyState
            title={search || scope === 'mine' ? 'No matching follow-ups' : 'No pending follow-ups'}
            subtitle="Schedule a reminder so nothing slips through."
            actionLabel="+ Schedule follow-up"
            onAction={() => setShowCreate(true)}
          />
        ) : periodItems.length === 0 ? (
          <EmptyState
            title={`No ${period} follow-ups`}
            subtitle={
              period === 'overdue'
                ? 'You’re caught up — nothing overdue.'
                : period === 'today'
                ? 'Nothing due today. Check Upcoming or schedule a new one.'
                : 'No future follow-ups scheduled yet.'
            }
            actionLabel={period === 'upcoming' ? '+ Schedule follow-up' : undefined}
            onAction={period === 'upcoming' ? () => setShowCreate(true) : undefined}
          />
        ) : (
          <Section
            title={period === 'overdue' ? 'Overdue' : period === 'today' ? 'Today' : 'Upcoming'}
            accent={period === 'overdue' ? 'text-red-600' : period === 'today' ? 'text-amber-700' : 'text-gray-500'}
            items={periodItems}
            hideTitle
            selectMode={selectMode}
            assigneeLabel={assigneeLabel}
            busyIds={busyIds}
            selected={selected}
            openMenuId={openMenuId}
            onToggleSelect={toggleSelect}
            onComplete={handleComplete}
            onOpenMenu={setOpenMenuId}
            onEdit={setEditing}
            onViewNotes={(f) => { setNotesFor(f); setOpenMenuId(null) }}
            onSnooze={handleSnooze}
            onDelete={handleDelete}
            onOpenCustomer={(id) => navigate(`/customers/${id}`)}
          />
        )
      ) : filteredCompleted.length === 0 ? (
        <EmptyState
          title="No completed follow-ups yet"
          subtitle="Completed items will show up here so you can review history."
        />
      ) : (
        <div className="space-y-2">
          {filteredCompleted.map((f) => (
            <CompletedRow
              key={f.id}
              item={f}
              assigneeLabel={assigneeLabel(f.assignedTo)}
              busy={busyIds.has(f.id)}
              onRestore={() => handleUncomplete(f.id)}
              onDelete={() => handleDelete(f.id)}
              onViewNotes={() => setNotesFor(f)}
              onOpenCustomer={(id) => navigate(`/customers/${id}`)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <FollowupFormModal mode="create" onClose={() => setShowCreate(false)} />
      )}
      {editing && (
        <FollowupFormModal
          mode="edit"
          editing={editing}
          onClose={() => setEditing(null)}
          onUpdate={async (id, data) => update(id, data)}
        />
      )}
      {notesFor && (
        <CustomerNotesModal
          customerName={notesFor.customerName}
          customerId={notesFor.customerId}
          enquiryId={notesFor.enquiryId}
          followupNote={notesFor.note}
          onClose={() => setNotesFor(null)}
        />
      )}
    </div>
  )
}

function EmptyState({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string
  subtitle: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="text-center py-16 px-4 border border-dashed border-gray-200 rounded-2xl bg-gray-50/50">
      <p className="text-sm font-medium text-gray-700">{title}</p>
      <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">{subtitle}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 bg-green-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-green-700"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}

function Section({
  title,
  accent,
  items,
  hideTitle,
  selectMode,
  assigneeLabel,
  busyIds,
  selected,
  openMenuId,
  onToggleSelect,
  onComplete,
  onOpenMenu,
  onEdit,
  onViewNotes,
  onSnooze,
  onDelete,
  onOpenCustomer,
}: {
  title: string
  accent: string
  items: EnrichedFollowup[]
  hideTitle?: boolean
  selectMode: boolean
  assigneeLabel: (a: string) => string
  busyIds: Set<string>
  selected: Set<string>
  openMenuId: string | null
  onToggleSelect: (id: string) => void
  onComplete: (id: string) => void
  onOpenMenu: (id: string | null) => void
  onEdit: (f: EnrichedFollowup) => void
  onViewNotes: (f: EnrichedFollowup) => void
  onSnooze: (f: EnrichedFollowup, kind: 'tomorrow' | 'plus3') => void
  onDelete: (id: string) => void
  onOpenCustomer: (customerId: string) => void
}) {
  if (items.length === 0) return null
  return (
    <section className="mb-6">
      {!hideTitle && (
        <h3 className={`text-sm font-semibold uppercase tracking-wide mb-3 ${accent}`}>
          {title} ({items.length})
        </h3>
      )}
      <div className="space-y-2">
        {items.map((f) => (
          <PendingRow
            key={f.id}
            item={f}
            selectMode={selectMode}
            assigneeLabel={assigneeLabel(f.assignedTo)}
            busy={busyIds.has(f.id)}
            isSelected={selected.has(f.id)}
            menuOpen={openMenuId === f.id}
            onToggleSelect={() => onToggleSelect(f.id)}
            onComplete={() => onComplete(f.id)}
            onToggleMenu={() => onOpenMenu(openMenuId === f.id ? null : f.id)}
            onEdit={() => onEdit(f)}
            onViewNotes={() => onViewNotes(f)}
            onSnooze={(kind) => onSnooze(f, kind)}
            onDelete={() => onDelete(f.id)}
            onOpenCustomer={() => f.customerId && onOpenCustomer(f.customerId)}
          />
        ))}
      </div>
    </section>
  )
}

function PendingRow({
  item,
  selectMode,
  assigneeLabel,
  busy,
  isSelected,
  menuOpen,
  onToggleSelect,
  onComplete,
  onToggleMenu,
  onEdit,
  onViewNotes,
  onSnooze,
  onDelete,
  onOpenCustomer,
}: {
  item: EnrichedFollowup
  selectMode: boolean
  assigneeLabel: string
  busy: boolean
  isSelected: boolean
  menuOpen: boolean
  onToggleSelect: () => void
  onComplete: () => void
  onToggleMenu: () => void
  onEdit: () => void
  onViewNotes: () => void
  onSnooze: (kind: 'tomorrow' | 'plus3') => void
  onDelete: () => void
  onOpenCustomer: () => void
}) {
  return (
    <div
      className={`bg-white rounded-xl border p-3 sm:p-4 flex items-start gap-3 ${
        isSelected ? 'border-green-400 bg-green-50/40' : 'border-gray-200'
      } ${busy ? 'opacity-60' : ''}`}
    >
      {selectMode ? (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="mt-1 w-4 h-4 accent-green-600 cursor-pointer flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <input
          type="checkbox"
          checked={false}
          disabled={busy}
          onChange={onComplete}
          className="mt-1 w-4 h-4 accent-green-600 cursor-pointer flex-shrink-0"
          title="Mark complete"
          onClick={(e) => e.stopPropagation()}
        />
      )}

      <div className="flex-1 min-w-0">
        <button
          type="button"
          onClick={onOpenCustomer}
          className="font-medium text-sm text-gray-800 truncate hover:text-green-700 text-left block max-w-full"
        >
          {item.customerName}
        </button>
        {item.note && <p className="text-xs text-gray-500 truncate mt-0.5">{item.note}</p>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-400">
          <span className="text-gray-600 font-medium">
            {formatDueDate(item.dueDate)} · {formatDueTime(item.dueDate)}
          </span>
          <span>{assigneeLabel}</span>
          {item.customerPhone && (
            <a
              href={telHref(item.customerPhone)}
              onClick={(e) => e.stopPropagation()}
              className="text-green-600 hover:text-green-700"
            >
              Call {formatPhoneDisplay(item.customerPhone)}
            </a>
          )}
          {item.customerId && (
            <Link
              to={`/customers/${item.customerId}`}
              onClick={(e) => e.stopPropagation()}
              className="text-blue-600 hover:text-blue-700"
            >
              Open customer
            </Link>
          )}
        </div>
      </div>

      {!selectMode && (
        <div className="flex items-center gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={onViewNotes}
            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 shadow-sm"
          >
            Notes
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={onToggleMenu}
              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 text-sm"
              aria-label="More actions"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-20 w-48 bg-white border border-gray-200 rounded-xl shadow-lg py-1 text-sm">
                <MenuItem onClick={onViewNotes}>View customer notes</MenuItem>
                <MenuItem onClick={onEdit}>Edit / reschedule</MenuItem>
                <MenuItem onClick={() => onSnooze('tomorrow')}>Snooze → tomorrow 9am</MenuItem>
                <MenuItem onClick={() => onSnooze('plus3')}>Snooze → +3 days</MenuItem>
                <MenuItem onClick={onOpenCustomer}>Open customer</MenuItem>
                <MenuItem onClick={onDelete} danger>Delete</MenuItem>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CompletedRow({
  item,
  assigneeLabel,
  busy,
  onRestore,
  onDelete,
  onViewNotes,
  onOpenCustomer,
}: {
  item: EnrichedFollowup
  assigneeLabel: string
  busy: boolean
  onRestore: () => void
  onDelete: () => void
  onViewNotes: () => void
  onOpenCustomer: (id: string) => void
}) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-3 sm:p-4 flex items-start gap-3 ${busy ? 'opacity-60' : ''}`}>
      <span className="mt-0.5 w-5 h-5 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs flex-shrink-0">✓</span>
      <div className="flex-1 min-w-0">
        <button
          type="button"
          onClick={() => item.customerId && onOpenCustomer(item.customerId)}
          className="font-medium text-sm text-gray-800 truncate hover:text-green-700 text-left block"
        >
          {item.customerName}
        </button>
        {item.note && <p className="text-xs text-gray-500 truncate mt-0.5">{item.note}</p>}
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-400">
          <span>Was due {formatDueDate(item.dueDate)}</span>
          {item.completedAt && (
            <span>
              Done {new Date(item.completedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </span>
          )}
          <span>{assigneeLabel}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={onViewNotes}
          className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700"
        >
          Notes
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onRestore}
          className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          title="Move back to Pending"
        >
          Undo
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          className="text-xs px-2 py-1 rounded-lg text-red-500 hover:bg-red-50"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2 hover:bg-gray-50 ${danger ? 'text-red-600' : 'text-gray-700'}`}
    >
      {children}
    </button>
  )
}
