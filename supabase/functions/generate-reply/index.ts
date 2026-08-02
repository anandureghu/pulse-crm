import { makeServiceClient } from '../_shared/supabase.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
}

const ok = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })

const fail = (message: string, status = 400) =>
  new Response(JSON.stringify({ error: message }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return fail('Method Not Allowed', 405)

  let body: { conversationId?: string }
  try { body = await req.json() } catch { return fail('Invalid JSON', 400) }

  const { conversationId } = body
  if (!conversationId) return fail('conversationId required', 400)

  const supabase = makeServiceClient()

  // Load AI config
  const { data: aiRow } = await supabase.from('settings').select('value').eq('key', 'ai_config').single()
  const aiCfg = aiRow?.value as { apiKey?: string; model?: string; systemPrompt?: string } | null
  if (!aiCfg?.apiKey) return fail('OpenAI API key not configured in Settings', 400)

  // Load recent messages (last 30)
  const { data: rows } = await supabase
    .from('messages')
    .select('sender, text, type, timestamp')
    .eq('conversation_id', conversationId)
    .order('timestamp', { ascending: false })
    .limit(30)

  const messages = (rows ?? []).reverse()
  if (messages.length === 0) return fail('No messages in conversation', 400)

  // Build OpenAI messages array
  const model = aiCfg.model ?? 'gpt-4o-mini'
  const systemPrompt = aiCfg.systemPrompt?.trim()
    ? `You are a helpful sales assistant. When replying, be professional, concise, and friendly.\n\nProduct & company information:\n${aiCfg.systemPrompt}`
    : 'You are a helpful sales assistant. Respond professionally, concisely, and helpfully to the customer.'

  const openaiMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemPrompt + '\n\nGenerate ONLY the reply text — no preamble, no quotes, no explanation.' },
  ]

  for (const m of messages) {
    const content = m.text && !m.text.match(/^\[.*\]$/)
      ? m.text
      : `[${m.type} message]`
    openaiMessages.push({
      role: m.sender === 'agent' ? 'assistant' : 'user',
      content,
    })
  }

  // Call OpenAI
  const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${aiCfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: openaiMessages,
      max_tokens: 300,
      temperature: 0.7,
    }),
  })

  if (!oaiRes.ok) {
    const errText = await oaiRes.text().catch(() => oaiRes.statusText)
    return fail(`OpenAI error: ${errText}`, 502)
  }

  const oaiData = await oaiRes.json()
  const reply = oaiData.choices?.[0]?.message?.content?.trim()
  if (!reply) return fail('No reply generated', 502)

  return ok({ reply })
})
