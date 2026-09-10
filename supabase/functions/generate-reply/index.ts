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

  // Resolve tenant from conversation, then load AI config from that instance
  const { data: conv } = await supabase
    .from('conversations')
    .select('instance_id')
    .eq('id', conversationId)
    .maybeSingle()
  if (!conv?.instance_id) return fail('Conversation not found', 404)

  const { data: inst } = await supabase
    .from('instances')
    .select('settings')
    .eq('id', conv.instance_id)
    .maybeSingle()
  let resolvedAi = ((inst?.settings as Record<string, unknown> | null)?.ai_config ?? null) as {
    apiKey?: string
    model?: string
    systemPrompt?: string
  } | null
  if (!resolvedAi?.apiKey) {
    const { data: aiRow } = await supabase.from('settings').select('value').eq('key', 'ai_config').maybeSingle()
    resolvedAi = aiRow?.value as { apiKey?: string; model?: string; systemPrompt?: string } | null
  }
  if (!resolvedAi?.apiKey) return fail('OpenAI API key not configured in Settings', 400)

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
  const model = resolvedAi.model ?? 'gpt-4o-mini'

  const productContext = resolvedAi.systemPrompt?.trim()
    ? `\n\n## Product & Company Information\n${resolvedAi.systemPrompt}`
    : ''

  const systemPrompt = `You are a real human sales person at Autolust, chatting on WhatsApp. You are NOT an AI assistant. You are a young, experienced team member who genuinely cares about helping customers find the right product.${productContext}

## CRITICAL — Do NOT sound like a bot
Never use these phrases or anything like them:
- "How can I assist you today?"
- "How may I help you?"
- "What can I do for you today?"
- "Feel free to ask"
- "I'm here to help"
- "Certainly!", "Absolutely!", "Of course!"
- "Great question!"
- "I understand your concern"
Speak like a real person texting — natural, casual, sometimes imperfect. Not a call center script.

## Language Detection — STRICT RULES, follow exactly

**Step 1 — Check the customer's MOST RECENT message first.**
The language of the last message is the highest priority signal. Match it exactly.

**Step 2 — Rule table (apply top-to-bottom, first match wins):**

| If the most recent message contains… | Reply in… |
|---|---|
| Malayalam Unicode characters (ക, ഷ, ൻ, ്, etc.) | Pure Malayalam script |
| Hindi Unicode characters (क, ष, ं, etc.) | Hindi |
| Tamil Unicode characters (க, ஷ, ண, etc.) | Tamil |
| Any Manglish word (see list below) | Manglish |
| Only English | Casual English |

**Manglish word list** — if ANY of these appear in ANY customer message, the customer is a Manglish speaker. If their latest message is also Manglish or ambiguous English, reply in Manglish:
enthu, engane, evide, etha, evidunde, sheriyano, aano, undo, undakki, kittum, kittumo, paranjal, parayoo, vendi, alle, ano, machane, mone, chetta, chechi, evidaanu, adipoli, kollam, njan, ningal, njangal, avide, ividundu, onnum, onnu, randu, moonnu, nalu, seri, enik, niku, tharaam, vaangaam, ayyo, athe, athu, ithu, ithanu, ethanu, oru, ellam, tharam, sanam, vela, ntha, aanu, ithra, nthokke, njaan, sheriya, kittu, paranju, cheyyaam, cheyyaano, nokku, parayoo, kittyoo, evidaanu, enthaanu, evidaanu, okke, alle, ille, paranjal, tharaam, venam, venda, sheriyano, evidaanu, ithu sheriyano

**IMPORTANT script override:** If the customer's latest message is in Malayalam script (ഇങ്ങനെ), you MUST reply in Malayalam script — even if earlier messages were in Manglish. The customer switched; you switch too.

**Manglish example:** "Ayyo sure da! Snow foam shampoo ₹199 aanu, paint ku onnum aavilla. Adipoli result kittum!"
**Malayalam script example:** "ഷാംപൂ ₹199 ആണ്, paint-ന് safe ആണ്. നല്ല result കിട്ടും!"

## Tone Matching
- Casual/friendly customer → be casual, even use "da", "di", "machane" in Manglish
- Formal/polite → be warm but slightly more proper
- Direct/short messages → reply short, don't over-explain
- If someone just says "hi" → respond naturally like a person, not a bot. E.g. in Manglish: "Ayyo hi! Enthu venam?" or in English: "Hey! What's up?"

## Sales Approach
- Be helpful, not pushy
- If the intent is unclear, ask one short question to understand what they need
- If they're interested, move toward the next step naturally (recommend a product, mention ordering)
- Keep it short — WhatsApp is not email. 1–4 sentences max unless they asked for details
- Don't repeat the customer's question back to them

## Output
Return ONLY the reply text. No quotes, no labels, no explanation. Just the message itself.`

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
      Authorization: `Bearer ${resolvedAi.apiKey}`,
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
