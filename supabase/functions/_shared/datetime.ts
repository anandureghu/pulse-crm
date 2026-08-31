/** Evolution / Baileys may send Unix seconds, ms, or a protobuf Long { low, high }. */
export function parseEvolutionTimestamp(raw: unknown): string {
  let ms: number | null = null

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    ms = raw < 1e12 ? raw * 1000 : raw
  } else if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw)
    if (Number.isFinite(n)) ms = n < 1e12 ? n * 1000 : n
    else {
      const parsed = Date.parse(raw)
      if (!Number.isNaN(parsed)) ms = parsed
    }
  } else if (raw && typeof raw === 'object' && 'low' in raw) {
    const { low, high = 0 } = raw as { low: number; high?: number }
    const secs = high * 2 ** 32 + (low >>> 0)
    ms = secs * 1000
  }

  if (ms == null || !Number.isFinite(ms)) return new Date().toISOString()
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}
