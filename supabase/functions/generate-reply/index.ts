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

  const productContext = aiCfg.systemPrompt?.trim()
    ? `\n\n## Product & Company Information\n${aiCfg.systemPrompt}`
    : ''

  const systemPrompt = `You are an experienced, friendly sales professional handling WhatsApp conversations.${productContext}

## Language & Tone Detection (CRITICAL)
Carefully read ALL the customer's messages and detect:
1. **Language** — identify exactly what the customer uses:
   - Pure Malayalam (Malayalam script): reply in Malayalam script
   - Manglish (Malayalam words written in English letters, e.g. "enthu undakki", "evide aanu", "sheriyano", "evidunde"): reply in Manglish
   - English: reply in English
   - Hindi: reply in Hindi
   - Tamil: reply in Tamil
   - Any other language or regional script: match it exactly
   - Mixed (e.g. English + Manglish, or Hindi + English): match that same mix
2. **Tone** — casual/friendly → be casual; formal/polite → be formal; direct/brief → be direct and brief
3. **Enquiry pattern** — what are they really asking? price, availability, features, delivery, comparison, complaint, just browsing?

## Sales Approach
- Reply as an experienced salesperson: warm, helpful, never pushy
- Understand the need before pitching — ask a clarifying question if the intent is unclear
- If they show interest, naturally move toward the next step (demo, order, visit, call)
- Handle objections with empathy ("I understand…") then reframe with value
- Keep replies concise — WhatsApp is not email. 1–4 sentences max unless they asked for details
- Never start with "Hello" or "Hi" if they've already been greeted in the conversation

## Output
Return ONLY the reply text. No quotes, no explanation, no "Here is a suggested reply:". Just the message itself.`

  const openaiMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemPrompt },
  ]

  for (const m of messages) {
    let content: string
    if (m.text && !m.text.match(/^\[.*\]$/)) {
      content = m.type !== 'text' ? `[sent a ${m.type}] ${m.text}` : m.text
    } else {
      const labels: Record<string, string> = {
        image: '[sent a photo]',
        audio: '[sent a voice message]',
        video: '[sent a video]',
        document: '[sent a document]',
      }
      content = labels[m.type] ?? `[${m.type}]`
    }
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
