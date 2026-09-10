import { useEffect, useState, type ReactNode } from 'react'
import {
  ACTIVITY_OPTIONS,
  DEFAULT_INBOX_FILTERS,
  INBOX_STATUS_OPTIONS,
  UNREAD_OPTIONS,
  type InboxFilters,
} from '../lib/inboxFilters'

interface InboxFiltersDialogProps {
  open: boolean
  value: InboxFilters
  meLabel: string
  assigneeOptions: string[]
  tagOptions: string[]
  onClose: () => void
  onApply: (next: InboxFilters) => void
}

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      {children}
    </label>
  )
}

const selectClass =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50'

export function InboxFiltersDialog({
  open,
  value,
  meLabel,
  assigneeOptions,
  tagOptions,
  onClose,
  onApply,
}: InboxFiltersDialogProps) {
  const [draft, setDraft] = useState<InboxFilters>(value)

  useEffect(() => {
    if (open) setDraft(value)
  }, [open, value])

  if (!open) return null

  const set = <K extends keyof InboxFilters>(key: K, v: InboxFilters[K]) => {
    setDraft((prev) => ({ ...prev, [key]: v }))
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="inbox-filters-title"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between gap-3">
          <h3 id="inbox-filters-title" className="text-base font-semibold text-gray-800">
            Filter conversations
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-sm px-2 py-1"
            aria-label="Close filters"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-auto">
          <Field label="Unread">
            <select
              value={draft.unread}
              onChange={(e) => set('unread', e.target.value as InboxFilters['unread'])}
              className={selectClass}
              aria-label="Filter by unread"
            >
              {UNREAD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Assignee">
            <select
              value={draft.assignee}
              onChange={(e) => set('assignee', e.target.value)}
              className={selectClass}
              aria-label="Filter by assignee"
            >
              <option value="all">Anyone</option>
              <option value="me">{meLabel ? `Assigned to me (${meLabel})` : 'Assigned to me'}</option>
              <option value="unassigned">Unassigned</option>
              <option value="other">Not assigned to me</option>
              {assigneeOptions.length > 0 && (
                <optgroup label="Team">
                  {assigneeOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </Field>

          <Field label="Enquiry status">
            <select
              value={draft.status}
              onChange={(e) => set('status', e.target.value)}
              className={selectClass}
              aria-label="Filter by enquiry status"
            >
              {INBOX_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Activity">
            <select
              value={draft.activity}
              onChange={(e) => set('activity', e.target.value as InboxFilters['activity'])}
              className={selectClass}
              aria-label="Filter by activity"
            >
              {ACTIVITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Tag">
            <select
              value={draft.tag}
              onChange={(e) => set('tag', e.target.value)}
              className={selectClass}
              aria-label="Filter by tag"
            >
              <option value="all">Any tag</option>
              <option value="none">No tags</option>
              {tagOptions.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
          <button
            type="button"
            onClick={() => setDraft({ ...DEFAULT_INBOX_FILTERS })}
            className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-lg"
          >
            Reset
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onApply(draft)}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
