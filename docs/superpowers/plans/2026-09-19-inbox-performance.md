# Inbox Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the all-at-once conversation fetch in Inbox with cursor-paginated loading, realtime cache injection, and virtual list rendering so the inbox is fast with 1000+ conversations.

**Architecture:** `fetchConversationsPage()` in db.ts fetches 50 rows at a time using a `(updated_at, id)` cursor. A new `useInfiniteConversations` hook wires this to React Query's `useInfiniteQuery` and patches the cache directly on Supabase realtime events — no re-fetch. `Inbox.tsx` replaces its `.map()` with `@tanstack/react-virtual`, and an IntersectionObserver sentinel triggers `fetchNextPage()`.

**Tech Stack:** React, TypeScript, Supabase, `@tanstack/react-query` v5 (already installed), `@tanstack/react-virtual` (new), native IntersectionObserver

**Scope note:** `useConversations` (used by Layout, Dashboard, Analytics) is NOT changed. Only `Inbox.tsx` switches to the new hook.

---

### Task 1: Install @tanstack/react-virtual

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install the package**

```bash
cd /Users/anandu.reghu/learn/pulse-crm && npm install @tanstack/react-virtual
```

Expected: package added, no peer-dep errors.

- [ ] **Step 2: Verify it resolves**

```bash
node -e "require('@tanstack/react-virtual'); console.log('ok')"
```

Expected output: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @tanstack/react-virtual"
```

---

### Task 2: Add `fetchConversationsPage()` to db.ts

**Files:**
- Modify: `src/lib/db.ts` (after line 312, in the Conversations section)

- [ ] **Step 1: Add the type and function**

Open `src/lib/db.ts`. After the closing `}` of `subscribeToConversations` (around line 312), add:

```typescript
export interface ConversationPageParams {
  organizationId: string
  cursor?: { updatedAt: string; id: string }
  limit?: number
  unread?: 'all' | 'unread' | 'read'
  activity?: 'all' | 'today' | '7d' | 'stale'
}

export async function fetchConversationsPage(params: ConversationPageParams): Promise<Conversation[]> {
  const { organizationId, cursor, limit = 50, unread = 'all', activity = 'all' } = params

  let query = supabase
    .from('conversations')
    .select('*')
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)

  // Cursor: fetch rows older than the last seen item
  if (cursor) {
    query = query.or(
      `updated_at.lt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`
    )
  }

  // Server-side unread filter (column lives on conversations)
  if (unread === 'unread') query = query.gt('unread_count', 0)
  if (unread === 'read') query = query.eq('unread_count', 0)

  // Server-side activity filter (updated_at lives on conversations)
  if (activity !== 'all') {
    const now = new Date()
    if (activity === 'today') {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      query = query.gte('updated_at', startOfDay)
    } else if (activity === '7d') {
      const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
      query = query.gte('updated_at', since)
    } else if (activity === 'stale') {
      const before = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()
      query = query.lte('updated_at', before)
    }
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map((row) => fromRow<Conversation>(row as Record<string, unknown>))
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/anandu.reghu/learn/pulse-crm && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors related to `fetchConversationsPage`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat: add fetchConversationsPage() with cursor pagination to db.ts"
```

---

### Task 3: Add `subscribeToConversationEvents()` to db.ts

**Files:**
- Modify: `src/lib/db.ts` (right after `fetchConversationsPage`)

- [ ] **Step 1: Add the function**

In `src/lib/db.ts`, directly after the `fetchConversationsPage` function, add:

```typescript
export function subscribeToConversationEvents(
  organizationId: string,
  onEvent: (event: 'INSERT' | 'UPDATE', conversation: Conversation) => void
): Unsubscribe {
  const channel = supabase
    .channel(`conv-events:${organizationId}:${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'conversations',
        filter: `organization_id=eq.${organizationId}`,
      },
      (payload) => {
        if (payload.eventType !== 'INSERT' && payload.eventType !== 'UPDATE') return
        const conv = fromRow<Conversation>(payload.new as Record<string, unknown>)
        onEvent(payload.eventType, conv)
      }
    )
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/anandu.reghu/learn/pulse-crm && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat: add subscribeToConversationEvents() for lightweight realtime injection"
```

---

### Task 4: Create `useInfiniteConversations` hook

**Files:**
- Create: `src/hooks/useInfiniteConversations.ts`

- [ ] **Step 1: Create the file**

Create `src/hooks/useInfiniteConversations.ts` with this content:

```typescript
import { useEffect, useRef } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { fetchConversationsPage, subscribeToConversationEvents } from '../lib/db'
import { useTenantStore } from '../store/tenantStore'
import type { Conversation } from '../types'
import type { InboxFilters } from '../lib/inboxFilters'

const PAGE_SIZE = 50

export function useInfiniteConversations(filters: InboxFilters) {
  const organizationId = useTenantStore((s) => s.activeOrganizationId)
  const queryClient = useQueryClient()
  const unsubRef = useRef<(() => void) | null>(null)

  const queryKey = ['conversations-infinite', organizationId, filters.unread, filters.activity]

  const result = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => {
      if (!organizationId) return []
      return fetchConversationsPage({
        organizationId,
        cursor: pageParam as { updatedAt: string; id: string } | undefined,
        limit: PAGE_SIZE,
        unread: filters.unread,
        activity: filters.activity,
      })
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage: Conversation[]) => {
      if (lastPage.length < PAGE_SIZE) return undefined
      const last = lastPage[lastPage.length - 1]
      return { updatedAt: last.updatedAt, id: last.id }
    },
    enabled: !!organizationId,
    staleTime: 30_000,
  })

  // Realtime: inject updated/new conversations into page[0] without re-fetching
  useEffect(() => {
    if (!organizationId) return

    unsubRef.current?.()

    unsubRef.current = subscribeToConversationEvents(organizationId, (event, conv) => {
      queryClient.setQueryData(queryKey, (old: { pages: Conversation[][] } | undefined) => {
        if (!old) return old

        const pages = old.pages.map((page) => [...page])

        if (event === 'UPDATE') {
          // Remove the conversation from wherever it currently sits
          for (let i = 0; i < pages.length; i++) {
            const idx = pages[i].findIndex((c) => c.id === conv.id)
            if (idx !== -1) {
              pages[i].splice(idx, 1)
              break
            }
          }
        }

        // Prepend to page 0 (most recent position)
        pages[0] = [conv, ...pages[0]]

        return { ...old, pages }
      })
    })

    return () => {
      unsubRef.current?.()
      unsubRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, queryClient])

  // Flatten all pages into a single list
  const conversations: Conversation[] = result.data?.pages.flat() ?? []

  return {
    conversations,
    isLoading: result.isLoading,
    isFetchingNextPage: result.isFetchingNextPage,
    hasNextPage: result.hasNextPage,
    fetchNextPage: result.fetchNextPage,
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/anandu.reghu/learn/pulse-crm && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useInfiniteConversations.ts
git commit -m "feat: add useInfiniteConversations hook with React Query infinite pagination and realtime injection"
```

---

### Task 5: Rewire Inbox.tsx — hook + virtualizer + sentinel

**Files:**
- Modify: `src/pages/Inbox.tsx`

This task has several sub-steps. Make all changes before committing.

- [ ] **Step 1: Update imports at the top of Inbox.tsx**

Replace:
```typescript
import { useEffect, useMemo, useRef, useState } from 'react'
```
with:
```typescript
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
```

Replace:
```typescript
import { useConversations, useMessages } from '../hooks/useConversations'
```
with:
```typescript
import { useMessages } from '../hooks/useConversations'
import { useInfiniteConversations } from '../hooks/useInfiniteConversations'
```

Add after the existing imports (e.g., after the `InboxFiltersDialog` import line):
```typescript
import { useVirtualizer } from '@tanstack/react-virtual'
```

- [ ] **Step 2: Replace the hook call and add virtualizer state**

Find (around line 61):
```typescript
  const { conversations, loading } = useConversations()
```

Replace with:
```typescript
  const {
    conversations,
    isLoading: loading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteConversations(filters)
```

- [ ] **Step 3: Remove client-side unread and activity filter logic**

Find the `matchesFilters` function (around line 191):
```typescript
  const matchesFilters = (c: Conversation) => {
    const customer = customerById.get(c.customerId)
    if (!matchesUnread(c, filters.unread)) return false
    if (!matchesAssignee(customerAssignee(c), filters.assignee, meLabel)) return false
    if (!matchesStatus(customerStatus(c), filters.status)) return false
    if (!matchesActivity(c.updatedAt, filters.activity)) return false
    if (!matchesTag(customer, filters.tag)) return false
    return true
  }
```

Replace with (remove unread and activity — now server-side):
```typescript
  const matchesFilters = (c: Conversation) => {
    const customer = customerById.get(c.customerId)
    if (!matchesAssignee(customerAssignee(c), filters.assignee, meLabel)) return false
    if (!matchesStatus(customerStatus(c), filters.status)) return false
    if (!matchesTag(customer, filters.tag)) return false
    return true
  }
```

- [ ] **Step 4: Add virtualizer and sentinel refs**

Find the block of existing refs near the top of the component (around line 81–83):
```typescript
  const actionsRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const slashKeyRef = useRef<((e: React.KeyboardEvent) => boolean) | null>(null)
```

Add after `slashKeyRef`:
```typescript
  const listRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
```

- [ ] **Step 5: Add virtualizer hook call**

Find (around line 188):
```typescript
  const activeFilterCount = countActiveInboxFilters(filters)
```

Add the virtualizer call directly before that line:
```typescript
  const virtualizer = useVirtualizer({
    count: filtered.length + (hasNextPage || isFetchingNextPage ? 1 : 0),
    getScrollElement: () => listRef.current,
    estimateSize: () => 72,
    overscan: 5,
  })
```

- [ ] **Step 6: Add IntersectionObserver effect**

Find the `useEffect` that watches `actionsOpen` (around line 142):
```typescript
  useEffect(() => {
    if (!actionsOpen) return
    const onDoc = (e: MouseEvent) => {
```

Add a new `useEffect` directly before it:
```typescript
  // Infinite scroll sentinel
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
```

- [ ] **Step 7: Replace the list render with virtual rows**

Find the list container and its contents (around line 578–644):
```tsx
        <div className="flex-1 overflow-auto">
          {loading && <p className="text-sm text-gray-400 p-4">Loading…</p>}
          {!loading && filtered.length === 0 && (
            <p className="text-sm text-gray-400 p-4">
              {search || activeFilterCount > 0 ? 'No matches.' : 'No conversations yet.'}
            </p>
          )}
          {filtered.map((c) => {
            const assignee = customerAssignee(c)
            const status = customerStatus(c)
            const cust = customerById.get(c.customerId)
            return (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={`w-full text-left px-3 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                  selected === c.id ? 'bg-green-50' : ''
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <div className="w-10 h-10 rounded-full flex-shrink-0 overflow-hidden bg-green-100 flex items-center justify-center text-green-700 font-bold text-sm">
                    {cust?.profilePicUrl ? (
                      <img src={cust.profilePicUrl} alt="" className="w-full h-full object-cover" />
                    ) : cust?.isGroup ? (
                      <span className="text-base">👥</span>
                    ) : (
                      customerName(c)[0]?.toUpperCase()
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm text-gray-800 truncate">{customerName(c)}</span>
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {formatConversationTime(c.updatedAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5 gap-2">
                      <span className="text-xs text-gray-500 truncate">{c.lastMessage}</span>
                      {c.unreadCount > 0 && (
                        <span className="bg-green-500 text-white text-xs rounded-full min-w-[20px] h-5 flex items-center justify-center px-1 flex-shrink-0">
                          {c.unreadCount}
                        </span>
                      )}
                    </div>
                    {(assignee || status) && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {status && (
                          <span
                            className={`inline-flex max-w-full text-[11px] px-2 py-0.5 rounded-full truncate capitalize ${statusColor(status)}`}
                            title={`Status: ${statusLabel(status)}`}
                          >
                            {statusLabel(status)}
                          </span>
                        )}
                        {assignee && (
                          <span className="inline-flex max-w-full bg-blue-100 text-blue-700 text-[11px] px-2 py-0.5 rounded-full truncate">
                            {assignee}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
```

Replace with:
```tsx
        <div ref={listRef} className="flex-1 overflow-auto">
          {loading && <p className="text-sm text-gray-400 p-4">Loading…</p>}
          {!loading && filtered.length === 0 && (
            <p className="text-sm text-gray-400 p-4">
              {search || activeFilterCount > 0 ? 'No matches.' : 'No conversations yet.'}
            </p>
          )}
          {!loading && filtered.length > 0 && (
            <div
              style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
            >
              {virtualizer.getVirtualItems().map((virtualItem) => {
                // Last slot = sentinel / spinner
                if (virtualItem.index === filtered.length) {
                  return (
                    <div
                      key="sentinel"
                      ref={sentinelRef}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualItem.start}px)`,
                        height: `${virtualItem.size}px`,
                      }}
                      className="flex items-center justify-center py-3"
                    >
                      {isFetchingNextPage && (
                        <span className="text-xs text-gray-400">Loading more…</span>
                      )}
                    </div>
                  )
                }

                const c = filtered[virtualItem.index]
                const assignee = customerAssignee(c)
                const status = customerStatus(c)
                const cust = customerById.get(c.customerId)

                return (
                  <div
                    key={c.id}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <button
                      onClick={() => setSelected(c.id)}
                      className={`w-full text-left px-3 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                        selected === c.id ? 'bg-green-50' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="w-10 h-10 rounded-full flex-shrink-0 overflow-hidden bg-green-100 flex items-center justify-center text-green-700 font-bold text-sm">
                          {cust?.profilePicUrl ? (
                            <img src={cust.profilePicUrl} alt="" className="w-full h-full object-cover" />
                          ) : cust?.isGroup ? (
                            <span className="text-base">👥</span>
                          ) : (
                            customerName(c)[0]?.toUpperCase()
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm text-gray-800 truncate">{customerName(c)}</span>
                            <span className="text-xs text-gray-400 flex-shrink-0">
                              {formatConversationTime(c.updatedAt)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-0.5 gap-2">
                            <span className="text-xs text-gray-500 truncate">{c.lastMessage}</span>
                            {c.unreadCount > 0 && (
                              <span className="bg-green-500 text-white text-xs rounded-full min-w-[20px] h-5 flex items-center justify-center px-1 flex-shrink-0">
                                {c.unreadCount}
                              </span>
                            )}
                          </div>
                          {(assignee || status) && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {status && (
                                <span
                                  className={`inline-flex max-w-full text-[11px] px-2 py-0.5 rounded-full truncate capitalize ${statusColor(status)}`}
                                  title={`Status: ${statusLabel(status)}`}
                                >
                                  {statusLabel(status)}
                                </span>
                              )}
                              {assignee && (
                                <span className="inline-flex max-w-full bg-blue-100 text-blue-700 text-[11px] px-2 py-0.5 rounded-full truncate">
                                  {assignee}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
```

- [ ] **Step 8: Remove unused imports from Inbox.tsx**

Remove `matchesUnread` and `matchesActivity` from the inboxFilters import since they're no longer called in Inbox.tsx. Find:
```typescript
import {
  collectAssigneeOptions,
  collectTagOptions,
  countActiveInboxFilters,
  DEFAULT_INBOX_FILTERS,
  inboxFilterSummaries,
  matchesActivity,
  matchesAssignee,
  matchesStatus,
  matchesTag,
  matchesUnread,
  type InboxFilters,
} from '../lib/inboxFilters'
```

Replace with:
```typescript
import {
  collectAssigneeOptions,
  collectTagOptions,
  countActiveInboxFilters,
  DEFAULT_INBOX_FILTERS,
  inboxFilterSummaries,
  matchesAssignee,
  matchesStatus,
  matchesTag,
  type InboxFilters,
} from '../lib/inboxFilters'
```

Also remove `useCallback` from the React import if it was added but not used elsewhere — check after compile.

- [ ] **Step 9: Verify TypeScript compiles**

```bash
cd /Users/anandu.reghu/learn/pulse-crm && npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors. If `useCallback` is unused, remove it from the import.

- [ ] **Step 10: Commit**

```bash
git add src/pages/Inbox.tsx
git commit -m "feat: replace Inbox list with virtual rendering and infinite scroll pagination"
```

---

### Task 6: Smoke-test in browser

**Files:** none — verification only

- [ ] **Step 1: Start dev server**

```bash
cd /Users/anandu.reghu/learn/pulse-crm && npm run dev
```

- [ ] **Step 2: Verify initial load**

Open the inbox. Confirm:
- The conversation list appears quickly (only 50 rows fetched)
- No JavaScript errors in the browser console
- Conversations render correctly (name, last message, timestamp, badges)

- [ ] **Step 3: Verify infinite scroll**

Scroll to the bottom of the conversation list. Confirm:
- "Loading more…" text appears briefly
- More conversations load and append below

- [ ] **Step 4: Verify realtime**

From another device or the Supabase dashboard, send a message to an existing conversation. Confirm:
- The conversation moves to the top of the inbox list within ~1 second
- No full page reload occurs

- [ ] **Step 5: Verify filters still work**

Apply an Assignee or Status filter. Confirm:
- Filter chips appear correctly
- The list updates (filtered client-side on loaded pages)
- Clearing filters restores the full paginated list

- [ ] **Step 6: Verify selected conversation**

Click a conversation. Confirm:
- The right panel opens with messages
- Sending a message still works
- Unread count clears correctly

- [ ] **Step 7: Final commit if any fixups were made**

```bash
git add -p
git commit -m "fix: inbox performance smoke-test fixups"
```
