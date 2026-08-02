import { useEffect, useState } from 'react'
import { subscribeToAllFollowups, completeFollowup } from '../lib/db'
import type { Followup } from '../types'

export function useFollowups() {
  const [followups, setFollowups] = useState<Followup[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = subscribeToAllFollowups((data) => {
      setFollowups(data)
      setLoading(false)
    })
    return unsub
  }, [])

  const complete = (id: string) => completeFollowup(id)

  return { followups, loading, complete }
}
