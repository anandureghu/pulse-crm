/**
 * Indian mobile helpers.
 *
 * Canonical forms (no spaces):
 * - local:     10 digits          e.g. 9876543210
 * - with CC:   12 digits          e.g. 919876543210
 * - display:   13 chars with +    e.g. +919876543210
 */

export function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, '')
}

/**
 * Extract the 10-digit Indian mobile subscriber number.
 * Accepts: 10 / 91+10 / +91+10 / leading 0+10.
 * Returns null if it cannot be reduced to exactly 10 digits.
 */
export function indianLocal10(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null
  let d = digitsOnly(phone)

  // 0XXXXXXXXXX (11) — trunk prefix
  if (d.length === 11 && d.startsWith('0')) {
    d = d.slice(1)
  }

  // 91XXXXXXXXXX (12)
  if (d.length === 12 && d.startsWith('91')) {
    d = d.slice(2)
  }

  // +91 already stripped by digitsOnly; 13 was +91… → 12 digits handled above.
  // Accidental 9191XXXXXXXX (14): strip one 91 if remainder is 10.
  if (d.length === 14 && d.startsWith('91')) {
    const rest = d.slice(2)
    if (rest.length === 12 && rest.startsWith('91')) d = rest.slice(2)
  }

  if (d.length !== 10) return null
  // Indian mobiles start with 6–9
  if (!/^[6-9]\d{9}$/.test(d)) return null
  return d
}

/** True when input is a valid Indian mobile (after normalizing). */
export function isValidIndianMobile(phone: string | null | undefined): boolean {
  return indianLocal10(phone) !== null
}

/**
 * Digits for storage / WhatsApp JID: 91 + 10-digit local (length 12).
 * Falls back to digits-only if not a valid IN mobile.
 */
export function normalizePhoneForStorage(phone: string): string {
  const local = indianLocal10(phone)
  if (local) return `91${local}`
  return digitsOnly(phone)
}

/**
 * Display form: +91XXXXXXXXXX (length 13, no spaces).
 * If already +91… and valid, returns that; if only 91… or 10 digits, prefixes correctly.
 * Invalid numbers: best-effort +digits (still no spaces).
 */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone?.trim()) return ''
  const local = indianLocal10(phone)
  if (local) return `+91${local}`

  const d = digitsOnly(phone)
  if (!d) return phone.trim().replace(/\s+/g, '')
  return d.startsWith('91') ? `+${d}` : `+${d}`
}

/** tel: link using E.164 (+91XXXXXXXXXX when valid). */
export function telHref(phone: string | null | undefined): string {
  const local = indianLocal10(phone)
  if (local) return `tel:+91${local}`
  const d = digitsOnly(phone ?? '')
  return d ? `tel:+${d}` : '#'
}

/** E.164 string +91XXXXXXXXXX, or null if invalid. */
export function toE164(phone: string | null | undefined): string | null {
  const local = indianLocal10(phone)
  return local ? `+91${local}` : null
}
