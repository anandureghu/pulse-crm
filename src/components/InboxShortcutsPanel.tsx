import { useMemo, useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { useInboxSnippets } from '../hooks/useInboxSnippets'
import { useUsers } from '../hooks/useUsers'
import { deleteInboxSnippet, updateInboxSnippet } from '../lib/inboxSnippets'
import { formatInr, formatProductCaption } from '../lib/shopifyProducts'
import { userLabel } from '../lib/db'
import { toast } from './Toast'
import { InboxSnippetForm } from './InboxSnippetForm'
import type { InboxSnippet, InboxSnippetKind } from '../types'

function visibilityLabel(s: InboxSnippet, users: { id: string; email: string; username: string | null }[]) {
  if (s.shared) return 'Team'
  if (s.sharedWith.length > 0) {
    const names = s.sharedWith
      .map((id) => users.find((u) => u.id === id))
      .filter(Boolean)
      .map((u) => userLabel(u!))
    return names.length ? names.join(', ') : `${s.sharedWith.length} members`
  }
  return 'Private'
}

export function InboxShortcutsPanel() {
  const userId = useAuthStore((s) => s.user?.id)
  const users = useUsers()
  const { snippets, loading } = useInboxSnippets()
  const [tab, setTab] = useState<InboxSnippetKind>('reply')
  const [editing, setEditing] = useState<InboxSnippet | null>(null)
  const [creating, setCreating] = useState(false)

  const mineAndShared = useMemo(
    () => snippets.filter((s) => s.kind === tab),
    [snippets, tab],
  )

  const handleDelete = async (s: InboxSnippet) => {
    if (!confirm(`Delete “${s.title}”?`)) return
    try {
      await deleteInboxSnippet(s.id)
      toast('Deleted', 'success')
    } catch {
      toast('Could not delete', 'error')
    }
  }

  const cycleShare = async (s: InboxSnippet) => {
    if (s.ownerId !== userId) return
    try {
      if (!s.shared && s.sharedWith.length === 0) {
        await updateInboxSnippet(s.id, { shared: true, sharedWith: [] })
        toast('Shared with team', 'success')
      } else {
        await updateInboxSnippet(s.id, { shared: false, sharedWith: [] })
        toast('Now private', 'success')
      }
    } catch {
      toast('Could not update sharing', 'error')
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h3 className="font-semibold text-gray-700">Inbox shortcuts</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Type <code className="bg-gray-100 px-1 rounded">/products</code> or{' '}
            <code className="bg-gray-100 px-1 rounded">/reply</code> in chat.
            New items stay private until you share them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setCreating(true); setEditing(null) }}
          className="text-sm bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 flex-shrink-0"
        >
          + New {tab === 'reply' ? 'reply' : 'product'}
        </button>
      </div>

      <div className="flex gap-1 mt-4 mb-3">
        {(['reply', 'product'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`text-sm px-3 py-1.5 rounded-lg ${
              tab === id ? 'bg-green-50 text-green-700 font-medium' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            {id === 'reply' ? 'Replies' : 'Products'}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-gray-400">Loading…</p>}
      {!loading && mineAndShared.length === 0 && (
        <p className="text-sm text-gray-400">
          {tab === 'reply'
            ? 'No saved replies yet. Create one to insert with /reply.'
            : 'No saved products yet. Pin one from /products in a chat, or add a custom card here.'}
        </p>
      )}

      <ul className="space-y-2">
        {mineAndShared.map((s) => {
          const owner = users.find((u) => u.id === s.ownerId)
          const mine = s.ownerId === userId
          return (
            <li key={s.id} className="border border-gray-100 rounded-lg p-3 flex gap-3">
              {tab === 'product' && (
                <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                  {s.imageUrl ? (
                    <img src={s.imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-lg">🛍️</div>
                  )}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-800 truncate">{s.title}</p>
                  {s.price && <span className="text-xs text-gray-500 flex-shrink-0">{formatInr(s.price)}</span>}
                </div>
                <p className="text-xs text-gray-500 truncate mt-0.5">
                  {s.kind === 'reply' ? s.body : formatProductCaption(s)}
                </p>
                <p className="text-[11px] text-gray-400 mt-1">
                  {visibilityLabel(s, users)}
                  {!mine && owner ? ` · from ${userLabel(owner)}` : ''}
                </p>
              </div>
              {mine && (
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => cycleShare(s)}
                    className="text-[11px] text-gray-500 hover:text-gray-800"
                  >
                    {s.shared || s.sharedWith.length ? 'Make private' : 'Share team'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditing(s); setCreating(false) }}
                    className="text-[11px] text-green-600 hover:text-green-800"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(s)}
                    className="text-[11px] text-red-500 hover:text-red-700"
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {(creating || editing) && (
        <InboxSnippetForm
          kind={editing?.kind ?? tab}
          editing={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}
    </div>
  )
}
