import { supabase } from './supabase'
import { normalizePhoneForStorage } from './phone'
import { requireTenantScope } from './tenant'
import { selectActiveInstance, useTenantStore } from '../store/tenantStore'

type EvoCfg = { apiUrl: string; apiKey: string; activeInstance: string }

function loadEvoCfgFromActiveInstance(): EvoCfg {
  const inst = selectActiveInstance(useTenantStore.getState())
  if (!inst) {
    throw new Error('No active instance selected.')
  }
  const evo = (inst.settings?.evolution ?? {}) as {
    apiUrl?: string
    apiKey?: string
    activeInstance?: string
  }
  const instanceName = inst.evolutionInstanceName || evo.activeInstance || ''
  if (!evo.apiUrl || !evo.apiKey || !instanceName) {
    throw new Error('Evolution API not configured for this instance. Go to Settings and save API URL, Key, and link an Evolution instance.')
  }
  return { apiUrl: evo.apiUrl, apiKey: evo.apiKey, activeInstance: instanceName }
}

async function evoPost(path: string, body: unknown, cfg?: EvoCfg) {
  const c = cfg ?? loadEvoCfgFromActiveInstance()
  const base = c.apiUrl.replace(/\/$/, '')
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { apikey: c.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Evolution API ${res.status}: ${text}`)
  }
  return res.json()
}

async function currentUser() {
  const { data } = await supabase.auth.getUser()
  return data.user?.email ?? data.user?.id ?? 'unknown'
}

// ── Send message (browser → Evolution directly) ───────────────────────────────

export async function sendMessageFn(body: {
  conversationId: string
  text?: string
  mediaUrl?: string
  mediaType?: string
}): Promise<{ ok: boolean; messageId: string }> {
  const scope = requireTenantScope()
  if (!scope) throw new Error('No active organization/instance')
  const cfg = loadEvoCfgFromActiveInstance()

  const { data: conv } = await supabase
    .from('conversations').select('customer_id').eq('id', body.conversationId).single()
  if (!conv) throw new Error('Conversation not found')

  const { data: customer } = await supabase
    .from('customers').select('phone').eq('id', conv.customer_id).single()
  if (!customer) throw new Error('Customer not found')

  const to = `${normalizePhoneForStorage(customer.phone)}@s.whatsapp.net`

  let evoMsgId: string
  if (body.mediaUrl && body.mediaType) {
    const res = await evoPost(`/message/sendMedia/${cfg.activeInstance}`, {
      number: to, mediatype: body.mediaType, media: body.mediaUrl, caption: body.text,
    }, cfg)
    evoMsgId = res?.key?.id ?? `local-${Date.now()}`
  } else if (body.text) {
    const res = await evoPost(`/message/sendText/${cfg.activeInstance}`, {
      number: to, text: body.text,
    }, cfg)
    evoMsgId = res?.key?.id ?? `local-${Date.now()}`
  } else {
    throw new Error('text or mediaUrl required')
  }

  await supabase.from('messages').upsert({
    id: evoMsgId,
    conversation_id: body.conversationId,
    sender: 'agent',
    type: body.mediaType ?? 'text',
    text: body.text ?? '',
    media: body.mediaUrl ?? null,
    status: 'sent',
    timestamp: new Date().toISOString(),
    organization_id: scope.organizationId,
    instance_id: scope.instanceId,
  }, { onConflict: 'id', ignoreDuplicates: true })

  await supabase.from('conversations').update({
    last_message: body.text ?? `[${body.mediaType}]`,
  }).eq('id', body.conversationId)

  return { ok: true, messageId: evoMsgId }
}

// ── Fetch media from Evolution API as base64 ─────────────────────────────────

export async function fetchMediaBase64(
  messageId: string,
  phone: string,
  msgType: string,
): Promise<string | null> {
  try {
    const cfg = loadEvoCfgFromActiveInstance()
    const jidPhone = normalizePhoneForStorage(phone)
    const res = await evoPost(
      `/chat/getBase64FromMediaMessage/${cfg.activeInstance}`,
      {
        message: {
          key: { id: messageId, fromMe: false, remoteJid: `${jidPhone}@s.whatsapp.net` },
          messageType: `${msgType}Message`,
        },
      },
      cfg,
    )
    const base64 = res?.base64 as string | undefined
    if (!base64) return null
    if (base64.startsWith('data:')) return base64
    const mimeFallback =
      msgType === 'image' ? 'image/jpeg'
      : msgType === 'audio' ? 'audio/ogg'
      : msgType === 'video' ? 'video/mp4'
      : 'application/octet-stream'
    const mime = (res?.mimetype as string | undefined) ?? mimeFallback
    return `data:${mime};base64,${base64}`
  } catch {
    return null
  }
}

// ── Assign enquiry (direct DB write) ─────────────────────────────────────────

export async function assignEnquiryFn(body: { enquiryId: string; assignTo: string; customerId?: string }) {
  const scope = requireTenantScope()
  const { data: current } = await supabase
    .from('enquiries')
    .select('status, customer_id')
    .eq('id', body.enquiryId)
    .maybeSingle()

  const enquiryPatch: Record<string, unknown> = {
    assigned_to: body.assignTo || null,
  }
  if (body.assignTo && current?.status === 'new_lead') {
    enquiryPatch.status = 'assigned'
    enquiryPatch.stage = 'assigned'
  }

  const { error } = await supabase
    .from('enquiries')
    .update(enquiryPatch)
    .eq('id', body.enquiryId)
  if (error) throw error

  const customerId = body.customerId ?? (current?.customer_id as string | undefined)
  if (customerId) {
    await supabase
      .from('customers')
      .update({ assigned_to: body.assignTo || null })
      .eq('id', customerId)
  }

  await supabase.from('activities').insert({
    enquiry_id: body.enquiryId,
    type: 'assigned',
    description: body.assignTo
      ? `Enquiry assigned to ${body.assignTo}`
      : 'Enquiry unassigned',
    created_by: await currentUser(),
    ...(scope
      ? { organization_id: scope.organizationId, instance_id: scope.instanceId }
      : {}),
  })

  return { ok: true }
}

// ── Update enquiry status (direct DB write) ───────────────────────────────────

export async function updateEnquiryStatusFn(body: { enquiryId: string; status: string }) {
  const scope = requireTenantScope()
  const { error } = await supabase
    .from('enquiries')
    .update({ status: body.status, stage: body.status })
    .eq('id', body.enquiryId)
  if (error) throw error

  await supabase.from('activities').insert({
    enquiry_id: body.enquiryId,
    type: 'status_changed',
    description: `Status changed to ${body.status.replace(/_/g, ' ')}`,
    created_by: await currentUser(),
    ...(scope
      ? { organization_id: scope.organizationId, instance_id: scope.instanceId }
      : {}),
  })

  return { ok: true }
}
