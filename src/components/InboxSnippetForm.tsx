import { useMemo, useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { useUsers } from '../hooks/useUsers'
import { createInboxSnippet, updateInboxSnippet } from '../lib/inboxSnippets'
import { userLabel } from '../lib/db'
import { toast } from './Toast'
import type { InboxSnippet, InboxSnippetKind } from '../types'

export function InboxSnippetForm({
  kind,
  editing,
  onClose,
  onSaved,
  productPrefill,
}: {
  kind: InboxSnippetKind
  editing?: InboxSnippet | null
  onClose: () => void
  onSaved?: (row: InboxSnippet) => void
  productPrefill?: Partial<InboxSnippet>
}) {
  const userId = useAuthStore((s) => s.user?.id)
  const users = useUsers()
  const initial = editing ?? productPrefill
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? '')
  const [price, setPrice] = useState(initial?.price ?? '')
  const [productUrl, setProductUrl] = useState(initial?.productUrl ?? '')
  const [sku, setSku] = useState(initial?.sku ?? '')
  const [variantTitle, setVariantTitle] = useState(initial?.variantTitle ?? '')
  const [shareMode, setShareMode] = useState<'private' | 'team' | 'members'>(
    initial?.shared ? 'team' : (initial?.sharedWith?.length ? 'members' : 'private'),
  )
  const [sharedWith, setSharedWith] = useState<string[]>(initial?.sharedWith ?? [])
  const [saving, setSaving] = useState(false)

  const teammates = useMemo(
    () => users.filter((u) => u.id !== userId),
    [users, userId],
  )

  const toggleMember = (id: string) => {
    setShareMode('members')
    setSharedWith((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const handleSave = async () => {
    if (!userId || !title.trim()) return
    if (kind === 'reply' && !body.trim()) {
      toast('Reply text is required', 'error')
      return
    }
    setSaving(true)
    const payload = {
      kind,
      title: title.trim(),
      body: body.trim(),
      imageUrl: imageUrl.trim() || null,
      price: price.trim() || null,
      productUrl: productUrl.trim() || null,
      sku: sku.trim() || null,
      variantTitle: variantTitle.trim() || null,
      shopifyProductId: initial?.shopifyProductId ?? null,
      shopifyVariantId: initial?.shopifyVariantId ?? null,
      shared: shareMode === 'team',
      sharedWith: shareMode === 'members' ? sharedWith : [],
    }
    try {
      const row = editing
        ? await updateInboxSnippet(editing.id, payload)
        : await createInboxSnippet(userId, payload)
      toast(editing ? 'Saved' : 'Created', 'success')
      onSaved?.(row)
      onClose()
    } catch {
      toast('Could not save', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <h3 className="text-base font-semibold text-gray-800 mb-1">
          {editing ? 'Edit' : 'New'} {kind === 'reply' ? 'reply' : 'product'}
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          Private by default. Share with the team or specific members when you want.
        </p>

        <label className="block text-sm text-gray-600 mb-1">Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === 'reply' ? 'e.g. Greeting' : 'Product name'}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-green-500"
        />

        {kind === 'product' && (
          <>
            <label className="block text-sm text-gray-600 mb-1">Image URL</label>
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            {imageUrl && (
              <img src={imageUrl} alt="" className="w-full h-32 object-cover rounded-lg mb-3 bg-gray-100" />
            )}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Price</label>
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="1200"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">SKU</label>
                <input
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            </div>
            <label className="block text-sm text-gray-600 mb-1">Variant</label>
            <input
              value={variantTitle}
              onChange={(e) => setVariantTitle(e.target.value)}
              placeholder="Optional, e.g. Black / M"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <label className="block text-sm text-gray-600 mb-1">Product link</label>
            <input
              value={productUrl}
              onChange={(e) => setProductUrl(e.target.value)}
              placeholder="https://…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </>
        )}

        <label className="block text-sm text-gray-600 mb-1">
          {kind === 'reply' ? 'Reply text' : 'Caption (optional)'}
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={kind === 'reply' ? 5 : 3}
          placeholder={kind === 'reply' ? 'Hi! Thanks for your message…' : 'Leave blank to auto-generate from title, price, and link'}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
        />

        <p className="text-sm text-gray-600 mb-1">Visibility</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {([
            ['private', 'Private'],
            ['team', 'Team'],
            ['members', 'Members'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setShareMode(id)}
              className={`text-xs px-3 py-1.5 rounded-full border ${
                shareMode === id
                  ? 'bg-green-600 text-white border-green-600'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {shareMode === 'members' && (
          <div className="border border-gray-200 rounded-lg p-2 mb-3 max-h-36 overflow-y-auto">
            {teammates.length === 0 && (
              <p className="text-xs text-gray-400 px-1 py-1">No other team members yet.</p>
            )}
            {teammates.map((u) => (
              <label key={u.id} className="flex items-center gap-2 px-1 py-1 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={sharedWith.includes(u.id)}
                  onChange={() => toggleMember(u.id)}
                />
                {userLabel(u)}
              </label>
            ))}
          </div>
        )}

        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !title.trim()}
            className="flex-1 bg-green-600 text-white text-sm font-medium py-2 rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
