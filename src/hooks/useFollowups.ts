import { useEffect, useMemo, useState } from 'react'
import {
  subscribeToAllFollowups,
  completeFollowup,
  uncompleteFollowup,
  updateFollowup,
  deleteFollowup,
  enrichFollowups,
} from '../lib/db'
import type { EnrichedFollowup, Followup } from '../types'
import { toast } from '../components/Toast'

export function useFollowups() {
  const [all, setAll] = useState<Followup[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = subscribeToAllFollowups((data) => {
      setAll(data)
      setLoading(false)
    })
    return unsub
  }, [])

  const pending = useMemo(() => all.filter((f) => !f.completed), [all])
  const completed = useMemo(() => all.filter((f) => f.completed), [all])

  const complete = async (id: string) => {
    const { error } = await completeFollowup(id)
    if (error) {
      toast('Failed to complete follow-up', 'error')
      return false
    }
    return true
  }

  const uncomplete = async (id: string) => {
    const { error } = await uncompleteFollowup(id)
    if (error) {
      toast('Failed to restore follow-up', 'error')
      return false
    }
    toast('Follow-up restored to pending', 'success')
    return true
  }

  const update = async (
    id: string,
    data: Partial<Pick<Followup, 'note' | 'dueDate' | 'assignedTo'>>
  ) => {
    const { error } = await updateFollowup(id, data)
    if (error) {
      toast('Failed to update follow-up', 'error')
      return false
    }
    return true
  }

  const remove = async (id: string) => {
    const { error } = await deleteFollowup(id)
    if (error) {
      toast('Failed to delete follow-up', 'error')
      return false
    }
    toast('Follow-up deleted', 'success')
    return true
  }

  return {
    /** @deprecated prefer `pending` — kept for Dashboard/Calendar which expect incomplete items */
    followups: pending,
    pending,
    completed,
    all,
    loading,
    complete,
    uncomplete,
    update,
    remove,
  }
}

export function useEnrichedFollowups(followups: Followup[]) {
  const [enriched, setEnriched] = useState<EnrichedFollowup[]>([])
  const [enriching, setEnriching] = useState(false)

  useEffect(() => {
    if (!followups.length) {
      setEnriched([])
      return
    }
    let cancelled = false
    setEnriching(true)
    enrichFollowups(followups).then((res) => {
      if (!cancelled) {
        setEnriched(res)
        setEnriching(false)
      }
    })
    return () => { cancelled = true }
  }, [followups])

  return { enriched, enriching }
}
