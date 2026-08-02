import { useEffect, useState } from 'react'
import { subscribeToActivities, logActivity } from '../lib/db'
import { useAuthStore } from '../store/authStore'
import type { Activity } from '../types'

export function useActivities(enquiryId: string | null) {
  const [activities, setActivities] = useState<Activity[]>([])
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    if (!enquiryId) return
    return subscribeToActivities(enquiryId, setActivities)
  }, [enquiryId])

  const log = (type: string, description: string) => {
    if (!enquiryId || !user) return
    return logActivity({ enquiryId, type, description, createdBy: user.email ?? user.id })
  }

  return { activities, log }
}
