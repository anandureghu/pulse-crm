import { useEffect, useState } from 'react'
import { subscribeToNotes, addNote, deleteNote } from '../lib/db'
import { useAuthStore } from '../store/authStore'
import { useTenantStore } from '../store/tenantStore'
import type { Note } from '../types'

export function useNotes(enquiryId: string | null) {
  const [notes, setNotes] = useState<Note[]>([])
  const user = useAuthStore((s) => s.user)
  const organizationId = useTenantStore((s) => s.activeOrganizationId)
  const instanceId = useTenantStore((s) => s.activeInstanceId)

  useEffect(() => {
    if (!enquiryId) return
    return subscribeToNotes(enquiryId, setNotes)
  }, [enquiryId])

  const add = (content: string) => {
    if (!enquiryId || !user || !organizationId || !instanceId) return
    return addNote(
      { organizationId, instanceId },
      { enquiryId, author: user.email ?? user.id, content },
    )
  }

  const remove = (id: string) => deleteNote(id)

  return { notes, add, remove }
}
