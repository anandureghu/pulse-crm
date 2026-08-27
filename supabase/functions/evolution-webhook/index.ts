import { makeServiceClient, json, err } from '../_shared/supabase.ts'
import type { EvolutionWebhookMessage, EvolutionWebhookStatus } from '../_shared/types.ts'

type TenantInstance = {
  id: string
  organization_id: string
  evolution_instance_name: string | null
  settings: Record<string, unknown>
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return err('Method Not Allowed', 405)

  let payload: EvolutionWebhookMessage | EvolutionWebhookStatus
  try {
    payload = await req.json()
  } catch {
    return err('Invalid JSON', 400)
  }

  const supabase = makeServiceClient()
  const event = (payload.event ?? '').toLowerCase().replace(/_/g, '.')
  const evoName = (payload as { instance?: string }).instance?.trim()
  if (!evoName) {
    console.warn('Webhook missing instance name — ignoring')
    return json({ ok: true, ignored: 'no_instance' })
  }

  const tenant = await resolveTenantInstance(supabase, evoName)
  if (!tenant) {
    console.warn(`Unknown Evolution instance "${evoName}" — ignoring`)
    return json({ ok: true, ignored: 'unknown_instance' })
  }

  try {
    switch (event) {
      case 'messages.upsert': {
        const msgs = Array.isArray((payload as any).data)
          ? (payload as any).data
          : [(payload as any).data]
        for (const item of msgs) {
          await handleMessageUpsert(supabase, tenant, { ...payload, data: item } as EvolutionWebhookMessage)
        }
        break
      }
      case 'messages.update': {
        const updates = Array.isArray((payload as any).data)
          ? (payload as any).data
          : [(payload as any).data]
        for (const item of updates) {
          await handleMessageStatus(supabase, tenant, { ...payload, data: item } as EvolutionWebhookStatus)
        }
        break
      }
      default:
        break
    }
    return json({ ok: true })
  } catch (e) {
    console.error('Webhook error:', e)
    return json({ ok: false }, 500)
  }
})

async function resolveTenantInstance(
  supabase: ReturnType<typeof makeServiceClient>,
  evoName: string,
): Promise<TenantInstance | null> {
  const { data } = await supabase
    .from('instances')
    .select('id, organization_id, evolution_instance_name, settings')
    .eq('evolution_instance_name', evoName)
    .eq('active', true)
    .maybeSingle()
  return (data as TenantInstance | null) ?? null
}

function phoneFromJid(jid: string): string {
  const raw = jid.replace(/@s\.whatsapp\.net$/, '').replace(/@.*$/, '')
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return digits
  if (digits.length === 11 && digits.startsWith('0') && /^[6-9]/.test(digits.slice(1))) {
    return `91${digits.slice(1)}`
  }
  return digits
}

function extractText(data: EvolutionWebhookMessage['data']): string {
  const msg = data.message
  if (!msg) return ''
  if (msg.conversation) return msg.conversation
  if (msg.imageMessage?.caption) return msg.imageMessage.caption
  if (msg.videoMessage?.caption) return msg.videoMessage.caption
  if (msg.documentMessage?.title) return msg.documentMessage.title
  return ''
}

function messageType(data: EvolutionWebhookMessage['data']): string {
  const msg = data.message
  if (!msg) return 'text'
  if (msg.imageMessage) return 'image'
  if (msg.audioMessage) return 'audio'
  if (msg.videoMessage) return 'video'
  if (msg.documentMessage) return 'document'
  return 'text'
}

function evoCfgFromInstance(tenant: TenantInstance): { apiUrl: string; apiKey: string; activeInstance: string } | null {
  const evo = (tenant.settings?.evolution ?? {}) as {
    apiUrl?: string
    apiKey?: string
    activeInstance?: string
  }
  const activeInstance = tenant.evolution_instance_name || evo.activeInstance || ''
  if (!evo.apiUrl || !evo.apiKey || !activeInstance) return null
  return { apiUrl: evo.apiUrl, apiKey: evo.apiKey, activeInstance }
}

async function storeMedia(
  supabase: ReturnType<typeof makeServiceClient>,
  messageId: string,
  remoteJid: string,
  msgType: string,
  cfg: { apiUrl: string; apiKey: string; activeInstance: string },
  fromMe = false,
): Promise<string | null> {
  try {
    const base = cfg.apiUrl.replace(/\/$/, '')
    const res = await fetch(`${base}/chat/getBase64FromMediaMessage/${cfg.activeInstance}`, {
      method: 'POST',
      headers: { apikey: cfg.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          key: { id: messageId, fromMe, remoteJid },
          messageType: `${msgType}Message`,
        },
      }),
    })
    if (!res.ok) return null

    const data = await res.json()
    const b64: string | undefined = data.base64
    if (!b64) return null

    let mimeType = 'application/octet-stream'
    let b64Data = b64
    const match = b64.match(/^data:([^;]+);base64,(.+)$/)
    if (match) {
      mimeType = match[1]
      b64Data = match[2]
    }

    const ext = mimeType.split('/')[1]?.split(';')[0]?.replace('+', '') ?? 'bin'
    const bytes = Uint8Array.from(atob(b64Data), (c) => c.charCodeAt(0))
    const path = `${cfg.activeInstance}/${messageId}.${ext}`

    const { error } = await supabase.storage
      .from('whatsapp-media')
      .upload(path, bytes, { contentType: mimeType, upsert: true })

    if (error) {
      console.error('Storage upload error:', error.message)
      return null
    }

    const { data: { publicUrl } } = supabase.storage.from('whatsapp-media').getPublicUrl(path)
    return publicUrl
  } catch (e) {
    console.error('storeMedia error:', e)
    return null
  }
}

async function handleMessageUpsert(
  supabase: ReturnType<typeof makeServiceClient>,
  tenant: TenantInstance,
  payload: EvolutionWebhookMessage,
) {
  const { data } = payload
  const remoteJid = data.key.remoteJid ?? ''

  if (remoteJid.includes('@g.us') || remoteJid.includes('@broadcast')) return

  const fromMe = Boolean(data.key.fromMe)
  const phone = phoneFromJid(remoteJid)
  if (!phone || phone.length < 8) return

  const text = extractText(data)
  const type = messageType(data)
  const timestamp = new Date(
    (typeof data.messageTimestamp === 'number' ? data.messageTimestamp : Number(data.messageTimestamp)) * 1000,
  ).toISOString()
  const messageId = data.key.id
  if (!messageId) return

  const orgId = tenant.organization_id
  const instanceId = tenant.id

  let media: string | null = null
  if (type !== 'text') {
    const cfg = evoCfgFromInstance(tenant)
    if (cfg) {
      media = await storeMedia(supabase, messageId, remoteJid, type, cfg, fromMe)
    }
    if (!media) {
      const msg = data.message
      media =
        msg?.imageMessage?.url ??
        msg?.audioMessage?.url ??
        msg?.videoMessage?.url ??
        msg?.documentMessage?.url ??
        null
    }
  }

  const { data: existingCustomer } = await supabase
    .from('customers')
    .select('id, name')
    .eq('instance_id', instanceId)
    .eq('phone', phone)
    .maybeSingle()

  let customerId: string
  let isNewCustomer = false

  if (existingCustomer) {
    customerId = existingCustomer.id
    if (!fromMe && data.pushName && existingCustomer.name === phone) {
      await supabase.from('customers').update({ name: data.pushName }).eq('id', customerId)
    }
  } else {
    isNewCustomer = true
    const { data: newCustomer, error } = await supabase
      .from('customers')
      .insert({
        phone,
        name: data.pushName ?? phone,
        assigned_to: null,
        tags: [],
        organization_id: orgId,
        instance_id: instanceId,
      })
      .select('id')
      .single()
    if (error || !newCustomer) throw error ?? new Error('Failed to create customer')
    customerId = newCustomer.id
  }

  const { data: existingConv } = await supabase
    .from('conversations')
    .select('id')
    .eq('instance_id', instanceId)
    .eq('customer_id', customerId)
    .maybeSingle()

  let conversationId: string
  const lastMsg = text || (media ? `[${type}]` : '')
  const sender = fromMe ? 'agent' : 'customer'

  if (existingConv) {
    conversationId = existingConv.id
    if (fromMe) {
      await supabase.from('conversations').update({
        last_message: lastMsg,
      }).eq('id', conversationId)
    } else {
      const { data: conv } = await supabase.from('conversations').select('unread_count').eq('id', conversationId).single()
      await supabase.from('conversations').update({
        last_message: lastMsg,
        unread_count: (conv?.unread_count ?? 0) + 1,
      }).eq('id', conversationId)
    }
  } else {
    const { data: newConv, error } = await supabase
      .from('conversations')
      .insert({
        customer_id: customerId,
        last_message: lastMsg,
        unread_count: fromMe ? 0 : 1,
        organization_id: orgId,
        instance_id: instanceId,
      })
      .select('id')
      .single()
    if (error || !newConv) throw error ?? new Error('Failed to create conversation')
    conversationId = newConv.id
  }

  await supabase.from('messages').upsert(
    {
      id: messageId,
      conversation_id: conversationId,
      sender,
      type,
      text,
      media,
      status: fromMe ? 'sent' : 'delivered',
      timestamp,
      organization_id: orgId,
      instance_id: instanceId,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  )

  if (fromMe) return

  const activityDesc = text
    ? `Customer sent message: "${text.slice(0, 100)}"`
    : `Customer sent ${type}`

  if (isNewCustomer) {
    const { data: enq } = await supabase
      .from('enquiries')
      .insert({
        customer_id: customerId,
        status: 'new_lead',
        stage: 'new_lead',
        assigned_to: null,
        value: 0,
        organization_id: orgId,
        instance_id: instanceId,
      })
      .select('id')
      .single()
    if (enq) {
      await supabase.from('activities').insert({
        enquiry_id: enq.id,
        type: 'message_received',
        description: activityDesc,
        created_by: 'system',
        organization_id: orgId,
        instance_id: instanceId,
      })
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    fetch(`${supabaseUrl}/functions/v1/notify-team`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'new_lead',
        data: { customerName: data.pushName ?? phone, customerPhone: phone },
        instanceId,
      }),
    }).catch(() => {})
  } else {
    const { data: enq } = await supabase
      .from('enquiries')
      .select('id')
      .eq('instance_id', instanceId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (enq) {
      await supabase.from('activities').insert({
        enquiry_id: enq.id,
        type: 'message_received',
        description: activityDesc,
        created_by: 'system',
        organization_id: orgId,
        instance_id: instanceId,
      })
    }
  }
}

async function handleMessageStatus(
  supabase: ReturnType<typeof makeServiceClient>,
  tenant: TenantInstance,
  payload: EvolutionWebhookStatus,
) {
  const statusMap: Record<string, string> = {
    DELIVERY_ACK: 'delivered',
    READ: 'read',
    PLAYED: 'read',
  }
  const status = statusMap[payload.data.status]
  if (!status) return

  await supabase
    .from('messages')
    .update({ status })
    .eq('id', payload.data.key.id)
    .eq('instance_id', tenant.id)
}
