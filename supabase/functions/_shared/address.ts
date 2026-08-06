import type { OrderCustomerDto } from './shopify.ts'

/**
 * Ensure Indian addresses have province/state for Shopify via OpenAI.
 * No hardcoded city/PIN maps — the model infers from address fields.
 */
export async function ensureProvince(
  customer: OrderCustomerDto,
  opts: { apiKey: string; model?: string },
): Promise<OrderCustomerDto> {
  const country = (customer.country || 'IN').toUpperCase()
  const normalizedCountry = country === 'INDIA' || country === 'IN' ? 'IN' : customer.country

  if (customer.province?.trim()) {
    return { ...customer, province: customer.province.trim(), country: normalizedCountry }
  }

  if (normalizedCountry !== 'IN') return { ...customer, country: normalizedCountry }
  if (!opts.apiKey) return customer

  const province = await openaiInferState(opts.apiKey, opts.model ?? 'gpt-4o-mini', customer)
  return {
    ...customer,
    country: 'IN',
    province: province || null,
  }
}

async function openaiInferState(
  apiKey: string,
  model: string,
  customer: OrderCustomerDto,
): Promise<string | null> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You complete shipping addresses for Shopify orders in India.

Given partial address fields (house, landmark, city, PIN/zip), return ONLY JSON:
{"province":"<full official English name of the Indian state or union territory>"}

Rules:
- province is REQUIRED whenever you can reasonably infer it from city, locality, district, or 6-digit PIN.
- Use Shopify-friendly full names (e.g. "Kerala", "Tamil Nadu", "Karnataka", "Maharashtra", "Delhi", "West Bengal").
- Infer from geography knowledge: e.g. Calicut/Kozhikode and PINs starting with 67 → Kerala; Bangalore/Bengaluru and 56xxxx → Karnataka; Chennai and 60xxxx → Tamil Nadu; Mumbai and 40xxxx → Maharashtra.
- Prefer the state that matches the PIN when city and PIN conflict.
- Never invent a random state. If truly impossible to determine, return {"province":null}.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            address1: customer.address1 ?? '',
            address2: customer.address2 ?? '',
            city: customer.city ?? '',
            zip: customer.zip ?? '',
            country: customer.country || 'IN',
          }),
        },
      ],
    }),
  })

  const data = await res.json()
  if (!res.ok) {
    console.error('openaiInferState failed', data)
    return null
  }

  try {
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}') as { province?: string | null }
    const p = typeof parsed.province === 'string' ? parsed.province.trim() : ''
    return p || null
  } catch {
    return null
  }
}
