import { useEffect, useMemo, useState } from 'react'
import { subscribeToInboxSnippets } from '../lib/inboxSnippets'
import type { InboxSnippet, InboxSnippetKind } from '../types'

export function useInboxSnippets(kind?: InboxSnippetKind) {
  const [snippets, setSnippets] = useState<InboxSnippet[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = subscribeToInboxSnippets((rows) => {
      setSnippets(rows)
      setLoading(false)
    })
    return unsub
  }, [])

  const filtered = useMemo(
    () => (kind ? snippets.filter((s) => s.kind === kind) : snippets),
    [snippets, kind],
  )

  return { snippets: filtered, all: snippets, loading }
}
