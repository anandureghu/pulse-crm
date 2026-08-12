import { createFollowup } from '../lib/db'
import { useAuthStore } from '../store/authStore'

export function useCreateFollowup() {
  const user = useAuthStore((s) => s.user)

  const create = (
    enquiryId: string,
    note: string,
    dueDate: Date,
    assignedTo?: string
  ) => {
    return createFollowup({
      enquiryId,
      note,
      dueDate: dueDate.toISOString(),
      completed: false,
      assignedTo: assignedTo || user?.email || user?.id || '',
    })
  }

  return { create }
}
