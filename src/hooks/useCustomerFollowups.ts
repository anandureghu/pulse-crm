import { useEffect, useState } from 'react'
import { subscribeToFollowupsForEnquiries, completeFollowup, uncompleteFollowup, deleteFollowup, updateFollowup } from '../lib/db'
import type { Followup } from '../types'
import { toast } from '../components/Toast'

export function useCustomerFollowups(enquiryIds: string[]) {
  const [followups, setFollowups] = useState<Followup[]>([])
  const [loading, setLoading] = useState(true)

  const key = enquiryIds.slice().sort().join(',')

  useEffect(() => {
    if (!enquiryIds.length) {
      setFollowups([])
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = subscribeToFollowupsForEnquiries(enquiryIds, (data) => {
      setFollowups(data)
      setLoading(false)
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const complete = async (id: string) => {
    const { error } = await completeFollowup(id)
    if (error) toast('Failed to complete follow-up', 'error')
    return !error
  }

  const uncomplete = async (id: string) => {
    const { error } = await uncompleteFollowup(id)
    if (error) toast('Failed to restore follow-up', 'error')
    else toast('Follow-up restored', 'success')
    return !error
  }

  const remove = async (id: string) => {
    const { error } = await deleteFollowup(id)
    if (error) toast('Failed to delete follow-up', 'error')
    else toast('Follow-up deleted', 'success')
    return !error
  }

  const update = async (
    id: string,
    data: Partial<Pick<Followup, 'note' | 'dueDate' | 'assignedTo'>>
  ) => {
    const { error } = await updateFollowup(id, data)
    if (error) toast('Failed to update follow-up', 'error')
    return !error
  }

  return {
    followups,
    pending: followups.filter((f) => !f.completed),
    completed: followups.filter((f) => f.completed),
    loading,
    complete,
    uncomplete,
    remove,
    update,
  }
}
