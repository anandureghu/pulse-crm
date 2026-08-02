import { useEffect, useState } from 'react'
import { subscribeToConversations, subscribeToMessages } from '../lib/db'
import type { Conversation, Message } from '../types'

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = subscribeToConversations((convs) => {
      setConversations(convs)
      setLoading(false)
    })
    return unsub
  }, [])

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
