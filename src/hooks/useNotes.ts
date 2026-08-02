import { useEffect, useState } from 'react'
import { subscribeToNotes, addNote, deleteNote } from '../lib/db'
import { useAuthStore } from '../store/authStore'
import type { Note } from '../types'

export function useNotes(enquiryId: string | null) {
  const [notes, setNotes] = useState<Note[]>([])
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    if (!enquiryId) return
    return subscribeToNotes(enquiryId, setNotes)
  }, [enquiryId])

  const add = (content: string) => {
    if (!enquiryId || !user) return
    return addNote({ enquiryId, author: user.email ?? user.id, content })
  }

  const remove = (id: string) => deleteNote(id)

  return { notes, add, remove }
}
