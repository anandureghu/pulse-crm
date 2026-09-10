import { createFollowup } from '../lib/db'
import { useAuthStore } from '../store/authStore'
import { useTenantStore } from '../store/tenantStore'

export function useCreateFollowup() {
  const user = useAuthStore((s) => s.user)
  const organizationId = useTenantStore((s) => s.activeOrganizationId)
  const instanceId = useTenantStore((s) => s.activeInstanceId)

  const create = (
    enquiryId: string,
    note: string,
    dueDate: Date,
    assignedTo?: string
  ) => {
    if (!organizationId || !instanceId) {
      return Promise.resolve({ error: new Error('No active instance') })
    }
    return createFollowup(
      { organizationId, instanceId },
      {
        enquiryId,
        note,
        dueDate: dueDate.toISOString(),
        completed: false,
        assignedTo: assignedTo || user?.email || user?.id || '',
      },
    )
  }

  return { create }
}
