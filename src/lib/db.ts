import { supabase } from './supabase'
import type { Customer, Enquiry, Conversation, Message, Note, Activity, Followup } from '../types'

type Unsubscribe = () => void

// ── camelCase ↔ snake_case mapping ───────────────────────────────────────────

function fromRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    const camel = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
    out[camel] = v
  }
  return out as T
}

function toRow(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    const snake = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
    out[snake] = v
  }
  return out
}

// ── Customers ────────────────────────────────────────────────────────────────

export async function getCustomerByPhone(phone: string): Promise<Customer | null> {
  const { data } = await supabase
    .from('customers')
    .select('*')
    .eq('phone', phone)
    .limit(1)
    .maybeSingle()
  return data ? fromRow<Customer>(data) : null
}

export async function createCustomer(data: Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>): Promise<Customer> {
  const { data: row, error } = await supabase
    .from('customers')
    .insert(toRow(data as Record<string, unknown>))
    .select('*')
    .single()
  if (error || !row) throw error ?? new Error('Failed to create customer')
  return fromRow<Customer>(row)
}

export async function ensureConversation(customerId: string): Promise<string> {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('customer_id', customerId)
    .maybeSingle()
  if (existing?.id) return existing.id as string

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({ customer_id: customerId, last_message: '', unread_count: 0 })
    .select('id')
    .single()
  if (error || !created) throw error ?? new Error('Failed to create conversation')
  return created.id as string
}

export async function updateCustomer(id: string, data: Partial<Customer>) {
  return supabase.from('customers').update(toRow(data as Record<string, unknown>)).eq('id', id)
}

export function subscribeToCustomers(onData: (customers: Customer[]) => void): Unsubscribe {
  const fetch = () =>
    supabase
      .from('customers')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => onData((data ?? []).map(fromRow<Customer>)))

  fetch()

  const channel = supabase
    .channel(`customers:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, fetch)
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const { data } = await supabase.from('customers').select('*').eq('id', id).maybeSingle()
  return data ? fromRow<Customer>(data) : null
}

// ── Enquiries ────────────────────────────────────────────────────────────────

export async function createEnquiry(data: Omit<Enquiry, 'id' | 'createdAt'>) {
  return supabase.from('enquiries').insert(toRow(data as Record<string, unknown>))
}

export async function updateEnquiry(id: string, data: Partial<Enquiry>) {
  return supabase.from('enquiries').update(toRow(data as Record<string, unknown>)).eq('id', id)
}

export function subscribeToEnquiries(onData: (enquiries: Enquiry[]) => void): Unsubscribe {
  const fetch = () =>
    supabase
      .from('enquiries')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => onData((data ?? []).map(fromRow<Enquiry>)))

  fetch()

  const channel = supabase
    .channel(`enquiries:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'enquiries' }, fetch)
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

export function subscribeToEnquiriesByCustomer(
  customerId: string,
  onData: (enquiries: Enquiry[]) => void
): Unsubscribe {
  const fetch = () =>
    supabase
      .from('enquiries')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .then(({ data }) => onData((data ?? []).map(fromRow<Enquiry>)))

  fetch()

  const channel = supabase
    .channel(`enquiries:${customerId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'enquiries', filter: `customer_id=eq.${customerId}` },
      fetch
    )
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

export async function getEnquiry(id: string): Promise<Enquiry | null> {
  const { data } = await supabase.from('enquiries').select('*').eq('id', id).maybeSingle()
  return data ? fromRow<Enquiry>(data) : null
}

// ── Conversations ─────────────────────────────────────────────────────────────

export async function getConversationByCustomer(customerId: string): Promise<Conversation | null> {
  const { data } = await supabase
    .from('conversations')
    .select('*')
    .eq('customer_id', customerId)
    .maybeSingle()
  return data ? fromRow<Conversation>(data) : null
}

export async function createConversation(data: Omit<Conversation, 'id' | 'updatedAt'>) {
  return supabase.from('conversations').insert(toRow(data as Record<string, unknown>))
}

export async function updateConversation(id: string, data: Partial<Conversation>) {
  return supabase.from('conversations').update(toRow(data as Record<string, unknown>)).eq('id', id)
}

export function subscribeToConversations(onData: (convs: Conversation[]) => void): Unsubscribe {
  const fetch = () =>
    supabase
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false })
      .then(({ data }) => onData((data ?? []).map(fromRow<Conversation>)))

  fetch()

  // Unique channel name — Layout + Inbox both subscribe; reusing 'conversations' breaks after subscribe()
  const channel = supabase
    .channel(`conversations:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, fetch)
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

// ── Messages ──────────────────────────────────────────────────────────────────

export function subscribeToMessages(
  conversationId: string,
  onData: (messages: Message[]) => void
): Unsubscribe {
  const fetch = () =>
    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('timestamp', { ascending: true })
      .then(({ data }) => onData((data ?? []).map(fromRow<Message>)))

  fetch()

  const channel = supabase
    .channel(`messages:${conversationId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      fetch
    )
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

export async function addMessage(data: Omit<Message, 'id'> & { id: string }) {
  return supabase.from('messages').insert(toRow(data as Record<string, unknown>))
}

export async function updateMessageStatus(id: string, status: Message['status']) {
  return supabase.from('messages').update({ status }).eq('id', id)
}

export async function starMessage(id: string, starred: boolean) {
  return supabase.from('messages').update({ starred }).eq('id', id)
}

export async function clearConversationMessages(conversationId: string): Promise<number> {
  // Fetch non-starred messages that have media in our Supabase Storage
  const { data: toDelete } = await supabase
    .from('messages')
    .select('id, media')
    .eq('conversation_id', conversationId)
    .eq('starred', false)

  if (!toDelete?.length) return 0

  // Remove files from storage for messages with Supabase Storage media URLs
  const storagePaths = toDelete
    .map((m) => {
      if (!m.media) return null
      const marker = '/object/public/whatsapp-media/'
      const idx = m.media.indexOf(marker)
      return idx !== -1 ? m.media.slice(idx + marker.length) : null
    })
    .filter((p): p is string => p !== null)

  if (storagePaths.length) {
    await supabase.storage.from('whatsapp-media').remove(storagePaths)
  }

  // Delete non-starred messages from DB
  await supabase
    .from('messages')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('starred', false)

  return toDelete.length
}

// ── Notes ─────────────────────────────────────────────────────────────────────

export function subscribeToNotes(enquiryId: string, onData: (notes: Note[]) => void): Unsubscribe {
  const fetch = () =>
    supabase
      .from('notes')
      .select('*')
      .eq('enquiry_id', enquiryId)
      .order('created_at', { ascending: false })
      .then(({ data }) => onData((data ?? []).map(fromRow<Note>)))

  fetch()

  const channel = supabase
    .channel(`notes:${enquiryId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notes', filter: `enquiry_id=eq.${enquiryId}` },
      fetch
    )
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

export async function addNote(data: Omit<Note, 'id' | 'createdAt'>) {
  return supabase.from('notes').insert(toRow(data as Record<string, unknown>))
}

export async function deleteNote(id: string) {
  return supabase.from('notes').delete().eq('id', id)
}

// ── Activities ────────────────────────────────────────────────────────────────

export function subscribeToActivities(
  enquiryId: string,
  onData: (activities: Activity[]) => void
): Unsubscribe {
  const fetch = () =>
    supabase
      .from('activities')
      .select('*')
      .eq('enquiry_id', enquiryId)
      .order('created_at', { ascending: false })
      .then(({ data }) => onData((data ?? []).map(fromRow<Activity>)))

  fetch()

  const channel = supabase
    .channel(`activities:${enquiryId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'activities', filter: `enquiry_id=eq.${enquiryId}` },
      fetch
    )
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

export async function logActivity(data: Omit<Activity, 'id' | 'createdAt'>) {
  return supabase.from('activities').insert(toRow(data as Record<string, unknown>))
}

// ── Follow-ups ────────────────────────────────────────────────────────────────

export function subscribeToFollowups(
  assignedTo: string,
  onData: (followups: Followup[]) => void
): Unsubscribe {
  const fetch = () =>
    supabase
      .from('followups')
      .select('*')
      .eq('assigned_to', assignedTo)
      .eq('completed', false)
      .then(({ data }) => {
        const items = (data ?? []).map(fromRow<Followup>)
        items.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
        onData(items)
      })

  fetch()

  const channel = supabase
    .channel(`followups:${assignedTo}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'followups' }, fetch)
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

export function subscribeToAllFollowups(onData: (followups: Followup[]) => void): Unsubscribe {
  const fetch = () =>
    supabase
      .from('followups')
      .select('*')
      .eq('completed', false)
      .then(({ data }) => {
        const items = (data ?? []).map(fromRow<Followup>)
        items.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
        onData(items)
      })

  fetch()

  const channel = supabase
    .channel(`followups:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'followups' }, fetch)
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

export async function createFollowup(data: Omit<Followup, 'id'>) {
  return supabase.from('followups').insert(toRow(data as Record<string, unknown>))
}

export async function completeFollowup(id: string) {
  return supabase.from('followups').update({ completed: true }).eq('id', id)
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function getUsers(): Promise<Array<{ id: string; email: string; username: string | null; role: string }>> {
  const { data } = await supabase.from('users').select('id, email, username, role').order('email')
  return (data ?? []).map((u) => ({
    id: u.id as string,
    email: u.email as string,
    username: (u.username as string | null) ?? null,
    role: u.role as string,
  }))
}

export function userLabel(u: { username?: string | null; email: string }): string {
  return (u.username?.trim() || u.email)
}
