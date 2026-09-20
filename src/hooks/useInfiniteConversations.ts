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
      queryClient.setQueryData(queryKey, (old: { pages: Conversation[][]; pageParams: unknown[] } | undefined) => {
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
