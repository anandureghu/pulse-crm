export function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, '')
}

/** Display with a leading + (idempotent). */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone?.trim()) return ''
  const trimmed = phone.trim()
  if (trimmed.startsWith('+')) return trimmed
  const d = digitsOnly(trimmed)
  return d ? `+${d}` : trimmed
}

export function telHref(phone: string | null | undefined): string {
  const d = digitsOnly(phone ?? '')
  return d ? `tel:+${d}` : '#'
}

/** Normalize for storage / lookup (strip non-digits; drop leading 91 for 12-digit IN). */
export function normalizePhoneForStorage(phone: string): string {
  let d = digitsOnly(phone)
  if (d.startsWith('91') && d.length === 12) d = d.slice(2)
  return d
}
