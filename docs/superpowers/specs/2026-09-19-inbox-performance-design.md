# Inbox Performance — Pagination + Realtime Injection + Virtualization

**Date:** 2026-09-19  
**Status:** Approved

## Problem

With 1000+ conversations, the inbox initial load is slow because:
1. `subscribeToConversations()` fetches ALL rows from Supabase with no `LIMIT`
2. All conversations are `.map()`'d into the DOM simultaneously (no virtualization)
3. Any realtime change triggers a full re-fetch of the entire list

## Chosen Approach

**Option C: Server-side cursor pagination + realtime cache injection + virtual rendering**

- Fetch 50 conversations at a time using a composite cursor (`updated_at DESC, id DESC`)
- React Query `useInfiniteQuery` manages paginated pages and caching
- Realtime events patch the query cache directly — no network re-fetch on updates
- `@tanstack/react-virtual` renders only ~15-20 DOM nodes regardless of total loaded count
- Intersection Observer sentinel triggers `fetchNextPage()` as user scrolls near the bottom

## Architecture

```
DB (Supabase)
  └── fetchConversationsPage(): SELECT ... ORDER BY updated_at DESC, id DESC LIMIT 50
  └── subscribeToConversationEvents(): postgres_changes on conversations table

React Query (useInfiniteConversations)
  └── useInfiniteQuery — pages keyed by (orgId, filters)
  └── Realtime handler patches cache: prepend/move conversation to page[0][0]
  └── No network re-fetch triggered by realtime events

Inbox.tsx
  └── useInfiniteConversations(filters) → flat merged list
  └── useVirtualizer — renders only visible rows
  └── Intersection Observer sentinel → fetchNextPage()
```

**Why cursor-based (not offset):** Offset pagination breaks when realtime pushes new conversations to the top — items shift position causing duplicates and gaps on the next page load. A composite cursor `(updated_at, id)` is stable regardless of prepended items.

## Data Layer — `src/lib/db.ts`

Two new functions added alongside existing ones:

### `fetchConversationsPage(params)`

```typescript
params: {
  organizationId: string
  cursor?: { updated_at: string; id: string }  // undefined = first page
  limit: number                                 // 50
  filters?: {
    status?: string
    assigneeId?: string
    unread?: boolean
    instanceId?: string
  }
}
returns: Promise<Conversation[]>
```

Builds a Supabase query with `ORDER BY updated_at DESC, id DESC` and a `LIMIT`. When a cursor is provided, adds a `WHERE (updated_at, id) < (cursor.updated_at, cursor.id)` clause. Filter params translate to Supabase `.eq()` / `.is()` calls.

### `subscribeToConversationEvents(organizationId, onEvent)`

```typescript
onEvent: (event: 'INSERT' | 'UPDATE', conversation: Conversation) => void
returns: () => void  // unsubscribe
```

Sets up a `postgres_changes` realtime channel on the conversations table filtered by `organization_id`. Calls `onEvent` with the raw conversation row. Does **not** perform any fetch.

The existing `subscribeToConversations()` is kept until the new hook fully replaces `useConversations`, then both are deleted.

## Hook — `src/hooks/useInfiniteConversations.ts`

New file replacing `useConversations.ts`.

```typescript
useInfiniteConversations(filters: InboxFilters) → {
  conversations: Conversation[]   // flat list across all loaded pages
  fetchNextPage: () => void
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isLoading: boolean
}
```

**Internals:**

- `useInfiniteQuery` with `queryKey: ['conversations', orgId, instanceId, filters]`
- `queryFn` calls `fetchConversationsPage()` using the last item of the previous page as cursor
- `getNextPageParam`: returns `{ updated_at, id }` of the last item in the page, or `undefined` if the page has fewer than 50 items (last page)
- On mount: calls `subscribeToConversationEvents()`, stores unsubscribe in a ref, cleans up on unmount

**Realtime handler logic:**

```
On UPDATE:
  1. Scan all pages in queryClient cache for conversation.id
  2. Remove it from its current position
  3. Prepend to page[0] at index 0
  4. queryClient.setQueryData(...) with mutated pages

On INSERT:
  1. Prepend to page[0] at index 0
  2. queryClient.setQueryData(...)

Filter check: if the conversation doesn't match current active filters, skip injection
```

When `filters` change, `queryKey` changes → React Query auto-invalidates and refetches from page 1.

## Component — `src/pages/Inbox.tsx`

Minimal changes to the render path:

1. Replace `useConversations()` with `useInfiniteConversations(filters)`
2. Remove client-side filter logic for `status`, `assigneeId`, `unread` (now server-side)
3. Keep text search as client-side filter over the loaded list
4. Replace `filtered.map(...)` with virtualizer render

**Virtualizer setup:**

```tsx
const parentRef = useRef<HTMLDivElement>(null)

const virtualizer = useVirtualizer({
  count: filtered.length + (isFetchingNextPage ? 1 : 0),  // +1 for spinner row
  getScrollElement: () => parentRef.current,
  estimateSize: () => 72,   // conversation row height in px
  overscan: 5,
})
```

The list container gets `overflow-auto` and a fixed height (full panel height). Inside: one tall div (`height: virtualizer.getTotalSize()`) with each virtual item absolutely positioned via `transform: translateY(...)`.

**Infinite scroll sentinel:**

```tsx
const sentinelRef = useRef<HTMLDivElement>(null)

useEffect(() => {
  const observer = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, { threshold: 0.1 })
  if (sentinelRef.current) observer.observe(sentinelRef.current)
  return () => observer.disconnect()
}, [hasNextPage, isFetchingNextPage])
```

Sentinel is placed as the last virtual item when there are more pages. A small spinner renders in its slot while `isFetchingNextPage` is true.

## Filtering

| Filter type | Strategy | Reason |
|---|---|---|
| Status | Server-side (Supabase `.eq()`) | Simple equality, reduces rows fetched |
| Assignee | Server-side (Supabase `.eq()`) | Simple equality, reduces rows fetched |
| Unread | Server-side (Supabase `.gt('unread_count', 0)`) | Reduces rows fetched |
| WhatsApp instance | Server-side (Supabase `.eq()`) | Reduces rows fetched |
| Text search | Client-side over loaded pages | Acceptable — most recent convos are in first pages |

When any server-side filter changes, the query key changes and React Query refetches from page 1 automatically.

## New Dependency

`@tanstack/react-virtual` — same Tanstack org as React Query v5 already in the project. No other new dependencies.

## Files Changed

| File | Change |
|---|---|
| `src/lib/db.ts` | Add `fetchConversationsPage()` and `subscribeToConversationEvents()` |
| `src/hooks/useInfiniteConversations.ts` | New file — replaces `useConversations.ts` |
| `src/hooks/useConversations.ts` | Deleted after migration |
| `src/pages/Inbox.tsx` | Swap hook, add virtualizer, add sentinel, remove client-side filters |
| `package.json` | Add `@tanstack/react-virtual` |

## Success Criteria

- Initial inbox load completes in under 2 seconds for 1000+ conversation accounts
- Scrolling is jank-free — no frame drops
- New messages cause the conversation to appear at the top of the list within ~1 second
- Applying a filter refetches from DB and shows results without loading stale client-side data
- No regression on text search, conversation selection, message sending, or existing filter UI
