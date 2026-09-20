import { useEffect, useState } from 'react'
import { subscribeToConversations, subscribeToMessages } from '../lib/db'
import { useTenantStore } from '../store/tenantStore'
import type { Conversation, Message } from '../types'

export function useConversations() {
  const organizationId = useTenantStore((s) => s.activeOrganizationId)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!organizationId) {
      setConversations([])
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = subscribeToConversations({ organizationId }, (convs) => {
      setConversations(convs)
      setLoading(false)
    })
    return unsub
  }, [organizationId])

  return { conversations, loading }
}

export function useMessages(conversationId: string | null) {
  const [messages, setMessages] = useState<Message[]>([])

  useEffect(() => {
    if (!conversationId) {
      setMessages([])
      return
    }
    setMessages([])
    const unsub = subscribeToMessages(conversationId, setMessages)
    return unsub
  }, [conversationId])

  return messages
}
