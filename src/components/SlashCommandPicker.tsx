import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { useInboxSnippets } from '../hooks/useInboxSnippets'
import { useShopifyProducts } from '../hooks/useShopifyProducts'
import { useUsers } from '../hooks/useUsers'
import { createInboxSnippet } from '../lib/inboxSnippets'
import { parseSlashInput, SLASH_COMMANDS } from '../lib/slashCommands'
import { formatInr, formatProductCaption } from '../lib/shopifyProducts'
import { userLabel } from '../lib/db'
import { toast } from './Toast'
import { InboxSnippetForm } from './InboxSnippetForm'
import type { CatalogVariant, InboxSnippet, SendableProduct } from '../types'

function snippetToProduct(s: InboxSnippet): SendableProduct {
  return {
    title: s.title,
    variantTitle: s.variantTitle,
    sku: s.sku,
    price: s.price,
    imageUrl: s.imageUrl,
    productUrl: s.productUrl,
    body: s.body,
  }
}

function variantToProduct(v: CatalogVariant): SendableProduct {
  return {
    title: v.title,
    variantTitle: v.variantTitle,
    sku: v.sku,
    price: v.price,
    imageUrl: v.imageUrl,
    productUrl: v.productUrl,
  }
}

type ListItem =
  | { key: string; type: 'command'; commandId: 'products' | 'replies' }
  | { key: string; type: 'reply'; snippet: InboxSnippet }
  | { key: string; type: 'saved-product'; snippet: InboxSnippet }
  | { key: string; type: 'catalog'; variant: CatalogVariant }

export function SlashCommandPicker({
  text,
  onChange,
  onSendProduct,
  onKeyIntercept,
}: {
  text: string
  onChange: (value: string) => void
  onSendProduct: (product: SendableProduct) => void
  onKeyIntercept?: (handler: ((e: React.KeyboardEvent) => boolean) | null) => void
}) {
  const userId = useAuthStore((s) => s.user?.id)
  const users = useUsers()
  const parsed = useMemo(() => parseSlashInput(text), [text])
  const { snippets } = useInboxSnippets()
  const replies = useMemo(() => snippets.filter((s) => s.kind === 'reply'), [snippets])
  const savedProducts = useMemo(() => snippets.filter((s) => s.kind === 'product'), [snippets])
  const { grouped, variants, loading: productsLoading, syncedAt } = useShopifyProducts(parsed.query)
  const [active, setActive] = useState(0)
  const [creatingKind, setCreatingKind] = useState<'reply' | 'product' | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const q = parsed.query.trim().toLowerCase()

  const filteredReplies = useMemo(() => {
    if (!q) return replies
    return replies.filter((s) =>
      `${s.title} ${s.body}`.toLowerCase().includes(q),
    )
  }, [replies, q])

  const filteredSavedProducts = useMemo(() => {
    if (!q) return savedProducts
    return savedProducts.filter((s) =>
      `${s.title} ${s.variantTitle ?? ''} ${s.sku ?? ''} ${s.price ?? ''} ${s.body}`.toLowerCase().includes(q),
    )
  }, [savedProducts, q])

  const catalogVariants = useMemo(() => {
    // Prefer grouped products when not searching so the list stays scannable
    if (!q) {
      return grouped.flatMap((g) => g.variants.slice(0, 3))
    }
    return variants
  }, [grouped, variants, q])

  const items: ListItem[] = useMemo(() => {
    if (!parsed.open) return []
    if (parsed.mode === 'commands') {
      return SLASH_COMMANDS
        .filter((c) => !q || c.aliases.some((a) => a.startsWith(q)) || c.label.toLowerCase().startsWith(q))
        .map((c) => ({ key: c.id, type: 'command' as const, commandId: c.id }))
    }
    if (parsed.mode === 'replies') {
      return filteredReplies.map((s) => ({ key: s.id, type: 'reply' as const, snippet: s }))
    }
    const saved: ListItem[] = filteredSavedProducts.map((s) => ({
      key: `saved-${s.id}`,
      type: 'saved-product' as const,
      snippet: s,
    }))
    const catalog: ListItem[] = catalogVariants.slice(0, 40).map((v) => ({
      key: `cat-${v.variantId}`,
      type: 'catalog' as const,
      variant: v,
    }))
    return [...saved, ...catalog]
  }, [parsed.open, parsed.mode, q, filteredReplies, filteredSavedProducts, catalogVariants])

  useEffect(() => {
    setActive(0)
  }, [parsed.mode, parsed.query, items.length])

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (item: ListItem) => {
    if (item.type === 'command') {
      const cmd = SLASH_COMMANDS.find((c) => c.id === item.commandId)
      if (cmd) onChange(cmd.insert)
      return
    }
    if (item.type === 'reply') {
      onChange(item.snippet.body)
      return
    }
    if (item.type === 'saved-product') {
      onSendProduct(snippetToProduct(item.snippet))
      onChange('')
      return
    }
    onSendProduct(variantToProduct(item.variant))
    onChange('')
  }

  const handleKey = (e: React.KeyboardEvent): boolean => {
    if (!parsed.open) return false
    if (e.key === 'Escape') {
      e.preventDefault()
      onChange('')
      return true
    }
    if (items.length === 0) return false
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(items.length - 1, i + 1))
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
      return true
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const item = items[active]
      if (item) choose(item)
      return true
    }
    if (e.key === 'Tab' && items[active]) {
      e.preventDefault()
      choose(items[active])
      return true
    }
    return false
  }

  useEffect(() => {
    onKeyIntercept?.(parsed.open ? handleKey : null)
    return () => onKeyIntercept?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.open, items, active])

  const pinCatalog = async (v: CatalogVariant, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!userId) return
    try {
      await createInboxSnippet(userId, {
        kind: 'product',
        title: v.title,
        body: formatProductCaption(v),
        imageUrl: v.imageUrl || null,
        price: v.price,
        productUrl: v.productUrl || null,
        shopifyProductId: v.productId,
        shopifyVariantId: v.variantId,
        sku: v.sku || null,
        variantTitle: v.variantTitle && v.variantTitle !== 'Default Title' ? v.variantTitle : null,
        shared: false,
        sharedWith: [],
      })
      toast('Saved to your products (private)', 'success')
    } catch {
      toast('Could not save product', 'error')
    }
  }

  if (!parsed.open) return null

  const emptyCatalog = parsed.mode === 'products' && !productsLoading && items.length === 0
  const emptyReplies = parsed.mode === 'replies' && filteredReplies.length === 0

  return (
    <>
      <div className="absolute left-3 right-3 bottom-full mb-2 bg-white border border-gray-200 rounded-xl shadow-lg z-30 overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-gray-500 truncate">
            {parsed.mode === 'commands' && 'Commands'}
            {parsed.mode === 'products' && 'Products — select to send'}
            {parsed.mode === 'replies' && 'Saved replies'}
          </p>
          {parsed.mode === 'products' && syncedAt && (
            <span className="text-[10px] text-gray-400 flex-shrink-0">
              Catalog {new Date(syncedAt).toLocaleDateString()}
            </span>
          )}
          {parsed.mode !== 'commands' && (
            <button
              type="button"
              onClick={() => setCreatingKind(parsed.mode === 'replies' ? 'reply' : 'product')}
              className="text-[11px] text-green-600 hover:text-green-800 flex-shrink-0"
            >
              + New
            </button>
          )}
        </div>

        <div ref={listRef} className="max-h-64 overflow-y-auto">
          {parsed.mode === 'products' && productsLoading && (
            <p className="text-sm text-gray-400 px-3 py-3">Loading products…</p>
          )}
          {emptyReplies && (
            <p className="text-sm text-gray-400 px-3 py-3">
              No replies yet. Create one — it stays private until you share it.
            </p>
          )}
          {emptyCatalog && (
            <p className="text-sm text-gray-400 px-3 py-3">
              No products found. Sync from Orders, or add a custom product with + New.
            </p>
          )}

          {items.map((item, idx) => {
            const selected = idx === active
            const cls = `w-full text-left px-3 py-2 flex items-center gap-3 ${
              selected ? 'bg-green-50' : 'hover:bg-gray-50'
            }`
            if (item.type === 'command') {
              const cmd = SLASH_COMMANDS.find((c) => c.id === item.commandId)!
              return (
                <button
                  key={item.key}
                  type="button"
                  data-idx={idx}
                  className={cls}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => choose(item)}
                >
                  <span className="text-lg w-7 text-center">{cmd.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-800">/{cmd.id}</span>
                    <span className="block text-xs text-gray-500">{cmd.hint}</span>
                  </span>
                </button>
              )
            }
            if (item.type === 'reply') {
              const owner = users.find((u) => u.id === item.snippet.ownerId)
              const mine = item.snippet.ownerId === userId
              return (
                <button
                  key={item.key}
                  type="button"
                  data-idx={idx}
                  className={cls}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => choose(item)}
                >
                  <span className="text-lg w-7 text-center flex-shrink-0">💬</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-gray-800 truncate">{item.snippet.title}</span>
                      <ShareBadge snippet={item.snippet} mine={mine} />
                    </span>
                    <span className="block text-xs text-gray-500 truncate">{item.snippet.body}</span>
                    {!mine && owner && (
                      <span className="block text-[10px] text-gray-400">from {userLabel(owner)}</span>
                    )}
                  </span>
                </button>
              )
            }

            const product = item.type === 'saved-product' ? snippetToProduct(item.snippet) : variantToProduct(item.variant)
            const img = product.imageUrl
            const mine = item.type === 'saved-product' && item.snippet.ownerId === userId
            const owner = item.type === 'saved-product'
              ? users.find((u) => u.id === item.snippet.ownerId)
              : undefined
            return (
              <div
                key={item.key}
                data-idx={idx}
                className={`${cls} cursor-pointer`}
                onMouseEnter={() => setActive(idx)}
                onClick={() => choose(item)}
              >
                <span className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                  {img ? (
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center text-base">🛍️</span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-gray-800 truncate">{product.title}</span>
                    {item.type === 'saved-product' && <ShareBadge snippet={item.snippet} mine={mine} />}
                    {item.type === 'catalog' && (
                      <span className="text-[10px] text-gray-400 flex-shrink-0">Catalog</span>
                    )}
                  </span>
                  <span className="block text-xs text-gray-500 truncate">
                    {product.variantTitle && product.variantTitle !== 'Default Title' ? `${product.variantTitle} · ` : ''}
                    {product.price ? formatInr(product.price) : ''}
                    {product.sku ? ` · ${product.sku}` : ''}
                  </span>
                  {item.type === 'saved-product' && !mine && owner && (
                    <span className="block text-[10px] text-gray-400">from {userLabel(owner)}</span>
                  )}
                </span>
                {item.type === 'catalog' && (
                  <button
                    type="button"
                    title="Save to my products (private)"
                    onClick={(e) => pinCatalog(item.variant, e)}
                    className="text-gray-400 hover:text-green-600 text-sm flex-shrink-0 px-1"
                  >
                    ☆
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <div className="px-3 py-1.5 border-t border-gray-100 text-[10px] text-gray-400">
          ↑↓ navigate · Enter select · Esc close
        </div>
      </div>
      {creatingKind && (
        <InboxSnippetForm kind={creatingKind} onClose={() => setCreatingKind(null)} />
      )}
    </>
  )
}

function ShareBadge({ snippet, mine }: { snippet: InboxSnippet; mine: boolean }) {
  if (snippet.shared) {
    return <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full flex-shrink-0">Team</span>
  }
  if (snippet.sharedWith.length > 0) {
    return <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full flex-shrink-0">Shared</span>
  }
  if (mine) {
    return <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full flex-shrink-0">Private</span>
  }
  return null
}
