import { useEffect, useState } from 'react'
import { subscribeToActivities, logActivity } from '../lib/db'
import { useAuthStore } from '../store/authStore'
import { useTenantStore } from '../store/tenantStore'
import type { Activity } from '../types'

export function useActivities(enquiryId: string | null) {
  const [activities, setActivities] = useState<Activity[]>([])
  const user = useAuthStore((s) => s.user)
  const organizationId = useTenantStore((s) => s.activeOrganizationId)
  const instanceId = useTenantStore((s) => s.activeInstanceId)

  useEffect(() => {
    if (!enquiryId) return
    return subscribeToActivities(enquiryId, setActivities)
  }, [enquiryId])

  const log = (type: string, description: string) => {
    if (!enquiryId || !user || !organizationId || !instanceId) return
    return logActivity(
      { organizationId, instanceId },
      { enquiryId, type, description, createdBy: user.email ?? user.id },
    )
  }

  return { activities, log }
}
