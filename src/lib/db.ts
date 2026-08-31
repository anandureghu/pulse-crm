import { supabase } from './supabase'
import type { Customer, Enquiry, Conversation, Message, Note, Activity, Followup, EnrichedFollowup } from '../types'
import type { TenantScope } from './tenant'

type Unsubscribe = () => void

function tenantCols(scope: TenantScope) {
  return { organization_id: scope.organizationId, instance_id: scope.instanceId }
}

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

export async function getCustomerByPhone(scope: TenantScope, phone: string): Promise<Customer | null> {
  const { data } = await supabase
    .from('customers')
    .select('*')
    .eq('instance_id', scope.instanceId)
    .eq('phone', phone)
    .limit(1)
    .maybeSingle()
  return data ? fromRow<Customer>(data) : null
}

export async function createCustomer(
  scope: TenantScope,
  data: Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'organizationId' | 'instanceId'>
): Promise<Customer> {
  const { data: row, error } = await supabase
    .from('customers')
    .insert({ ...toRow(data as Record<string, unknown>), ...tenantCols(scope) })
    .select('*')
    .single()
  if (error || !row) throw error ?? new Error('Failed to create customer')
  return fromRow<Customer>(row)
}

export async function ensureConversation(scope: TenantScope, customerId: string): Promise<string> {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('instance_id', scope.instanceId)
    .eq('customer_id', customerId)
    .maybeSingle()
  if (existing?.id) return existing.id as string

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      customer_id: customerId,
      last_message: '',
      unread_count: 0,
      ...tenantCols(scope),
    })
    .select('id')
    .single()
  if (error || !created) throw error ?? new Error('Failed to create conversation')
  return created.id as string
}

export async function updateCustomer(id: string, data: Partial<Customer>) {
  return supabase.from('customers').update(toRow(data as Record<string, unknown>)).eq('id', id)
}

export function subscribeToCustomers(
  scope: TenantScope,
  onData: (customers: Customer[]) => void
): Unsubscribe {
  const fetch = async () => {
    const [{ data: rows }, { data: enquiries }] = await Promise.all([
      supabase
        .from('customers')
        .select('*')
        .eq('organization_id', scope.organizationId)
        .eq('instance_id', scope.instanceId)
        .order('created_at', { ascending: false }),
      supabase
        .from('enquiries')
        .select('customer_id, assigned_to, created_at')
        .eq('organization_id', scope.organizationId)
        .eq('instance_id', scope.instanceId)
        .order('created_at', { ascending: false }),
    ])

    // Latest enquiry assignee per customer (assignments often lived only on enquiries)
    const latestAssign = new Map<string, string>()
    for (const e of enquiries ?? []) {
      const cid = e.customer_id as string | null
      const assigned = (e.assigned_to as string | null)?.trim()
      if (!cid || !assigned || latestAssign.has(cid)) continue
      latestAssign.set(cid, assigned)
    }

    onData(
      (rows ?? []).map((row) => {
        const c = fromRow<Customer>(row as Record<string, unknown>)
        if (!c.assignedTo?.trim()) {
          c.assignedTo = latestAssign.get(c.id) ?? null
        }
        return c
      }),
    )
  }

  fetch()

  const channel = supabase
    .channel(`customers:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => { fetch() })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'enquiries' }, () => { fetch() })
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const { data } = await supabase.from('customers').select('*').eq('id', id).maybeSingle()
  return data ? fromRow<Customer>(data) : null
}

// ── Enquiries ────────────────────────────────────────────────────────────────

export async function createEnquiry(
  scope: TenantScope,
  data: Omit<Enquiry, 'id' | 'createdAt' | 'organizationId' | 'instanceId'>
): Promise<{ data: Enquiry | null; error: Error | null }> {
  const { data: row, error } = await supabase
    .from('enquiries')
    .insert({ ...toRow(data as Record<string, unknown>), ...tenantCols(scope) })
    .select('*')
    .single()
  if (error || !row) return { data: null, error: error ?? new Error('Failed to create enquiry') }
  return { data: fromRow<Enquiry>(row), error: null }
}

/** Latest enquiry for a customer, or a new new_lead if none exists (needed for follow-ups). */
export async function ensureEnquiryForCustomer(
  scope: TenantScope,
  customerId: string,
  assignedTo?: string | null
): Promise<{ data: Enquiry | null; error: Error | null }> {
  const { data: existing } = await supabase
    .from('enquiries')
    .select('*')
    .eq('instance_id', scope.instanceId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing) return { data: fromRow<Enquiry>(existing), error: null }

  return createEnquiry(scope, {
    customerId,
    status: 'new_lead',
    stage: 'new_lead',
    assignedTo: assignedTo ?? null,
    value: 0,
  })
}

export async function updateEnquiry(id: string, data: Partial<Enquiry>) {
  return supabase.from('enquiries').update(toRow(data as Record<string, unknown>)).eq('id', id)
}

export function subscribeToEnquiries(
  scope: TenantScope,
  onData: (enquiries: Enquiry[]) => void
): Unsubscribe {
  const fetch = () =>
    supabase
      .from('enquiries')
      .select('*')
      .eq('organization_id', scope.organizationId)
      .eq('instance_id', scope.instanceId)
      .order('created_at', { ascending: false })
      .then(({ data }) => onData((data ?? []).map(fromRow<Enquiry>)))

  fetch()

  const channel = supabase
    .channel(`enquiries:${scope.instanceId}:${crypto.randomUUID()}`)
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

  // Unique channel name — CustomerDetail + FollowupFormModal both subscribe
  const channel = supabase
    .channel(`enquiries:${customerId}:${crypto.randomUUID()}`)
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

export async function createConversation(
  scope: TenantScope,
  data: Omit<Conversation, 'id' | 'updatedAt' | 'organizationId' | 'instanceId'>
) {
  return supabase.from('conversations').insert({
    ...toRow(data as Record<string, unknown>),
    ...tenantCols(scope),
  })
}

export async function updateConversation(id: string, data: Partial<Conversation>) {
  return supabase.from('conversations').update(toRow(data as Record<string, unknown>)).eq('id', id)
}

export function subscribeToConversations(
  scope: TenantScope,
  onData: (convs: Conversation[]) => void
): Unsubscribe {
  const fetch = async () => {
    const { data: rows } = await supabase
      .from('conversations')
      .select('*')
      .eq('organization_id', scope.organizationId)
      .eq('instance_id', scope.instanceId)
      .order('updated_at', { ascending: false })

    const convRows = rows ?? []
    if (convRows.length === 0) {
      onData([])
      return
    }

    const ids = convRows.map((r) => r.id as string)
    const { data: msgRows } = await supabase
      .from('messages')
      .select('conversation_id, timestamp')
      .in('conversation_id', ids)
      .order('timestamp', { ascending: false })

    const lastMsgAt = new Map<string, string>()
    for (const m of msgRows ?? []) {
      const cid = m.conversation_id as string
      const ts = m.timestamp as string
      if (!lastMsgAt.has(cid) && ts) lastMsgAt.set(cid, ts)
    }

    const convs = convRows.map((row) => {
      const conv = fromRow<Conversation>(row as Record<string, unknown>)
      const latest = lastMsgAt.get(conv.id)
      if (latest) conv.updatedAt = latest
      return conv
    })

    convs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    onData(convs)
  }

  fetch()

  // Unique channel name — Layout + Inbox both subscribe; reusing 'conversations' breaks after subscribe()
  const channel = supabase
    .channel(`conversations:${scope.instanceId}:${crypto.randomUUID()}`)
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
    .channel(`messages:${conversationId}:${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      fetch
    )
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

export async function addMessage(
  scope: TenantScope,
  data: Omit<Message, 'id' | 'organizationId' | 'instanceId'> & { id: string }
) {
  return supabase.from('messages').insert({
    ...toRow(data as Record<string, unknown>),
    ...tenantCols(scope),
  })
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
    .channel(`notes:${enquiryId}:${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notes', filter: `enquiry_id=eq.${enquiryId}` },
      fetch
    )
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

export async function addNote(
  scope: TenantScope,
  data: Omit<Note, 'id' | 'createdAt' | 'organizationId' | 'instanceId'>
) {
  return supabase.from('notes').insert({
    ...toRow(data as Record<string, unknown>),
    ...tenantCols(scope),
  })
}

export async function deleteNote(id: string) {
  return supabase.from('notes').delete().eq('id', id)
}

export async function getNotesForEnquiry(enquiryId: string): Promise<Note[]> {
  const { data } = await supabase
    .from('notes')
    .select('*')
    .eq('enquiry_id', enquiryId)
    .order('created_at', { ascending: false })
  return (data ?? []).map(fromRow<Note>)
}

/** All notes across every enquiry for a customer. */
export async function getNotesForCustomer(customerId: string): Promise<Note[]> {
  const { data: enquiries } = await supabase
    .from('enquiries')
    .select('id')
    .eq('customer_id', customerId)
  const ids = (enquiries ?? []).map((e) => e.id as string)
  if (!ids.length) return []
  const { data } = await supabase
    .from('notes')
    .select('*')
    .in('enquiry_id', ids)
    .order('created_at', { ascending: false })
  return (data ?? []).map(fromRow<Note>)
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
    .channel(`activities:${enquiryId}:${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'activities', filter: `enquiry_id=eq.${enquiryId}` },
      fetch
    )
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

export async function logActivity(
  scope: TenantScope,
  data: Omit<Activity, 'id' | 'createdAt' | 'organizationId' | 'instanceId'>
) {
  return supabase.from('activities').insert({
    ...toRow(data as Record<string, unknown>),
    ...tenantCols(scope),
  })
}

// ── Follow-ups ────────────────────────────────────────────────────────────────

function sortFollowups(items: Followup[]): Followup[] {
  return items.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1
    if (a.completed && b.completed) {
      const aDone = a.completedAt ? new Date(a.completedAt).getTime() : 0
      const bDone = b.completedAt ? new Date(b.completedAt).getTime() : 0
      if (aDone !== bDone) return bDone - aDone
    }
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
  })
}

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
        onData(sortFollowups((data ?? []).map(fromRow<Followup>)))
      })

  fetch()

  const channel = supabase
    .channel(`followups:${assignedTo}:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'followups' }, fetch)
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

/** All follow-ups (pending + completed) for the Follow-ups page tabs. */
export function subscribeToAllFollowups(
  scope: TenantScope,
  onData: (followups: Followup[]) => void
): Unsubscribe {
  const fetch = () =>
    supabase
      .from('followups')
      .select('*')
      .eq('organization_id', scope.organizationId)
      .eq('instance_id', scope.instanceId)
      .order('due_date', { ascending: true })
      .then(({ data }) => {
        onData(sortFollowups((data ?? []).map(fromRow<Followup>)))
      })

  fetch()

  const channel = supabase
    .channel(`followups:${scope.instanceId}:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'followups' }, fetch)
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

export function subscribeToFollowupsForEnquiries(
  enquiryIds: string[],
  onData: (followups: Followup[]) => void
): Unsubscribe {
  if (!enquiryIds.length) {
    onData([])
    return () => {}
  }

  const fetch = () =>
    supabase
      .from('followups')
      .select('*')
      .in('enquiry_id', enquiryIds)
      .then(({ data }) => {
        onData(sortFollowups((data ?? []).map(fromRow<Followup>)))
      })

  fetch()

  const channel = supabase
    .channel(`followups:enquiries:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'followups' }, fetch)
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

export async function enrichFollowups(followups: Followup[]): Promise<EnrichedFollowup[]> {
  if (!followups.length) return []

  const enquiryIds = [...new Set(followups.map((f) => f.enquiryId))]
  const { data: enquiryRows } = await supabase
    .from('enquiries')
    .select('id, customer_id')
    .in('id', enquiryIds)

  const enquiryToCustomer = new Map<string, string>()
  for (const row of enquiryRows ?? []) {
    enquiryToCustomer.set(row.id as string, row.customer_id as string)
  }

  const customerIds = [...new Set([...enquiryToCustomer.values()])]
  const customerMap = new Map<string, { name: string; phone: string }>()
  if (customerIds.length) {
    const { data: customerRows } = await supabase
      .from('customers')
      .select('id, name, phone')
      .in('id', customerIds)
    for (const row of customerRows ?? []) {
      customerMap.set(row.id as string, {
        name: (row.name as string) || 'Unknown',
        phone: (row.phone as string) || '',
      })
    }
  }

  return followups.map((f) => {
    const customerId = enquiryToCustomer.get(f.enquiryId) ?? null
    const customer = customerId ? customerMap.get(customerId) : null
    return {
      ...f,
      customerId,
      customerName: customer?.name ?? f.enquiryId,
      customerPhone: customer?.phone ?? null,
    }
  })
}

export async function createFollowup(
  scope: TenantScope,
  data: Omit<Followup, 'id' | 'completedAt' | 'createdAt' | 'organizationId' | 'instanceId'>
) {
  return supabase.from('followups').insert({
    ...toRow(data as Record<string, unknown>),
    ...tenantCols(scope),
  })
}

export async function updateFollowup(
  id: string,
  data: Partial<Pick<Followup, 'note' | 'dueDate' | 'assignedTo' | 'completed' | 'completedAt'>>
) {
  return supabase.from('followups').update(toRow(data as Record<string, unknown>)).eq('id', id)
}

export async function completeFollowup(id: string) {
  const withAt = await supabase
    .from('followups')
    .update({ completed: true, completed_at: new Date().toISOString() })
    .eq('id', id)
  if (!withAt.error) return withAt
  // Fallback before completed_at migration is applied
  return supabase.from('followups').update({ completed: true }).eq('id', id)
}

export async function uncompleteFollowup(id: string) {
  const withAt = await supabase
    .from('followups')
    .update({ completed: false, completed_at: null })
    .eq('id', id)
  if (!withAt.error) return withAt
  return supabase.from('followups').update({ completed: false }).eq('id', id)
}

export async function deleteFollowup(id: string) {
  return supabase.from('followups').delete().eq('id', id)
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function getUsers(
  organizationId?: string
): Promise<Array<{ id: string; email: string; username: string | null; role: string }>> {
  if (organizationId) {
    const { data } = await supabase
      .from('organization_members')
      .select('role, users(id, email, username)')
      .eq('organization_id', organizationId)
    return (data ?? []).map((row) => {
      const u = row.users as unknown as { id: string; email: string; username: string | null }
      return {
        id: u.id,
        email: u.email,
        username: u.username ?? null,
        role: row.role as string,
      }
    }).sort((a, b) => a.email.localeCompare(b.email))
  }

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
