/** Shared modern chart primitives — SVG with gradients, no chart library. */

export interface ChartDatum {
  key: string
  label: string
  value: number
  color?: string
  gradient?: [string, string]
  secondary?: number
}

function uid() {
  return `g${Math.random().toString(36).slice(2, 9)}`
}

export function GradientBarChart({
  data,
  height = 220,
  valueSuffix = '',
  formatValue,
}: {
  data: ChartDatum[]
  height?: number
  valueSuffix?: string
  formatValue?: (n: number) => string
}) {
  const max = Math.max(...data.map((d) => d.value), 1)
  const fmt = formatValue ?? ((n: number) => `${n}${valueSuffix}`)
  const id = uid()

  if (!data.length) {
    return <EmptyChart label="No data for this range" />
  }

  return (
    <div className="w-full" style={{ height }}>
      <div className="flex items-end gap-2 h-full pb-6 relative">
        {data.map((d, i) => {
          const pct = (d.value / max) * 100
          const g0 = d.gradient?.[0] ?? d.color ?? '#34d399'
          const g1 = d.gradient?.[1] ?? d.color ?? '#059669'
          return (
            <div key={d.key} className="flex-1 min-w-0 h-full flex flex-col justify-end items-center group">
              <span className="text-[10px] font-semibold text-gray-600 mb-1 opacity-0 group-hover:opacity-100 transition-opacity truncate max-w-full">
                {fmt(d.value)}
              </span>
              <div className="w-full max-w-[48px] mx-auto relative flex-1 flex items-end">
                <div
                  className="w-full rounded-t-lg transition-all duration-700 ease-out shadow-sm"
                  style={{
                    height: `${Math.max(pct, d.value > 0 ? 4 : 0)}%`,
                    background: `linear-gradient(180deg, ${g0} 0%, ${g1} 100%)`,
                    boxShadow: `0 8px 20px -8px ${g1}88`,
                  }}
                  title={`${d.label}: ${fmt(d.value)}`}
                />
              </div>
              <span className="text-[10px] text-gray-400 mt-2 truncate w-full text-center leading-tight">
                {d.label}
              </span>
              {/* keep id used for a11y */}
              <span className="sr-only">{id}-{i}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function GradientAreaChart({
  series,
  height = 200,
  colors = {
    leads: ['#93c5fd', '#3b82f6'],
    sales: ['#86efac', '#16a34a'],
    revenue: ['#c4b5fd', '#7c3aed'],
  },
}: {
  series: { label: string; leads: number; sales: number; revenue: number }[]
  height?: number
  colors?: Record<string, [string, string]>
}) {
  if (!series.length) return <EmptyChart label="No trend data yet" />

  const w = 600
  const h = height
  const pad = { t: 16, r: 12, b: 28, l: 36 }
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b

  const maxY = Math.max(...series.flatMap((s) => [s.leads, s.sales, s.revenue / 1000]), 1)

  const xAt = (i: number) => pad.l + (series.length <= 1 ? innerW / 2 : (i / (series.length - 1)) * innerW)
  const yAt = (v: number) => pad.t + innerH - (v / maxY) * innerH

  const pathFor = (values: number[], close: boolean) => {
    if (!values.length) return ''
    const pts = values.map((v, i) => `${xAt(i)},${yAt(v)}`)
    let d = `M ${pts[0]}`
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1].split(',').map(Number)
      const [x1, y1] = pts[i].split(',').map(Number)
      const cx = (x0 + x1) / 2
      d += ` C ${cx},${y0} ${cx},${y1} ${x1},${y1}`
    }
    if (close) {
      d += ` L ${xAt(values.length - 1)},${pad.t + innerH} L ${xAt(0)},${pad.t + innerH} Z`
    }
    return d
  }

  const leads = series.map((s) => s.leads)
  const sales = series.map((s) => s.sales)
  const revenue = series.map((s) => s.revenue / 1000) // scale ₹000s for overlay

  const id = uid()

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[320px]" role="img">
        <defs>
          <linearGradient id={`${id}-leads`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.leads[0]} stopOpacity="0.45" />
            <stop offset="100%" stopColor={colors.leads[1]} stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id={`${id}-sales`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.sales[0]} stopOpacity="0.4" />
            <stop offset="100%" stopColor={colors.sales[1]} stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id={`${id}-rev`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.revenue[0]} stopOpacity="0.35" />
            <stop offset="100%" stopColor={colors.revenue[1]} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75, 1].map((p) => (
          <line
            key={p}
            x1={pad.l}
            x2={w - pad.r}
            y1={pad.t + innerH * (1 - p)}
            y2={pad.t + innerH * (1 - p)}
            stroke="#e5e7eb"
            strokeDasharray="4 4"
          />
        ))}

        <path d={pathFor(leads, true)} fill={`url(#${id}-leads)`} />
        <path d={pathFor(sales, true)} fill={`url(#${id}-sales)`} />
        <path d={pathFor(revenue, true)} fill={`url(#${id}-rev)`} />

        <path d={pathFor(leads, false)} fill="none" stroke={colors.leads[1]} strokeWidth="2.5" />
        <path d={pathFor(sales, false)} fill="none" stroke={colors.sales[1]} strokeWidth="2.5" />
        <path d={pathFor(revenue, false)} fill="none" stroke={colors.revenue[1]} strokeWidth="2.5" strokeDasharray="5 3" />

        {series.map((s, i) => (
          <text
            key={s.label}
            x={xAt(i)}
            y={h - 8}
            textAnchor="middle"
            className="fill-gray-400"
            style={{ fontSize: 10 }}
          >
            {s.label}
          </text>
        ))}
      </svg>
      <div className="flex flex-wrap gap-4 justify-center mt-1 text-xs text-gray-500">
        <LegendDot color={colors.leads[1]} label="New leads" />
        <LegendDot color={colors.sales[1]} label="Sales" />
        <LegendDot color={colors.revenue[1]} label="Revenue (₹k)" dashed />
      </div>
    </div>
  )
}

export function GradientDonut({
  data,
  size = 180,
  centerLabel,
  centerValue,
  formatValue,
}: {
  data: ChartDatum[]
  size?: number
  centerLabel?: string
  centerValue?: string
  formatValue?: (n: number) => string
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total <= 0) return <EmptyChart label="No breakdown yet" />

  const id = uid()
  const r = 64
  const c = 2 * Math.PI * r
  let offset = 0
  const fmt = formatValue ?? ((n: number) => String(n))

  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <svg width={size} height={size} viewBox="0 0 180 180" className="shrink-0">
        <defs>
          {data.map((d) => (
            <linearGradient key={d.key} id={`${id}-${d.key}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={d.gradient?.[0] ?? d.color ?? '#94a3b8'} />
              <stop offset="100%" stopColor={d.gradient?.[1] ?? d.color ?? '#64748b'} />
            </linearGradient>
          ))}
        </defs>
        <circle cx="90" cy="90" r={r} fill="none" stroke="#f3f4f6" strokeWidth="22" />
        {data.map((d) => {
          const len = (d.value / total) * c
          const el = (
            <circle
              key={d.key}
              cx="90"
              cy="90"
              r={r}
              fill="none"
              stroke={`url(#${id}-${d.key})`}
              strokeWidth="22"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              transform="rotate(-90 90 90)"
              className="transition-all duration-700"
            />
          )
          offset += len
          return el
        })}
        <text x="90" y="86" textAnchor="middle" className="fill-gray-800" style={{ fontSize: 18, fontWeight: 700 }}>
          {centerValue ?? fmt(total)}
        </text>
        {centerLabel && (
          <text x="90" y="104" textAnchor="middle" className="fill-gray-400" style={{ fontSize: 11 }}>
            {centerLabel}
          </text>
        )}
      </svg>
      <div className="space-y-2 min-w-0 flex-1">
        {data.map((d) => (
          <div key={d.key} className="flex items-center gap-2 text-sm">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: `linear-gradient(135deg, ${d.gradient?.[0] ?? d.color}, ${d.gradient?.[1] ?? d.color})` }}
            />
            <span className="text-gray-600 truncate flex-1">{d.label}</span>
            <span className="font-semibold text-gray-800 tabular-nums">{fmt(d.value)}</span>
            <span className="text-xs text-gray-400 w-10 text-right">{Math.round((d.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function HorizontalFunnel({
  data,
  formatValue,
}: {
  data: ChartDatum[]
  formatValue?: (n: number) => string
}) {
  const max = Math.max(...data.map((d) => d.value), 1)
  const fmt = formatValue ?? ((n: number) => String(n))
  if (!data.length) return <EmptyChart label="No pipeline data" />

  return (
    <div className="space-y-3">
      {data.map((d) => {
        const pct = (d.value / max) * 100
        const g0 = d.gradient?.[0] ?? '#86efac'
        const g1 = d.gradient?.[1] ?? '#16a34a'
        return (
          <div key={d.key}>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">{d.label}</span>
              <span className="font-semibold text-gray-800 tabular-nums">{fmt(d.value)}</span>
            </div>
            <div className="h-3.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${d.value > 0 ? Math.max(pct, 2) : 0}%`,
                  background: `linear-gradient(90deg, ${g0}, ${g1})`,
                  boxShadow: d.value > 0 ? `0 0 16px -2px ${g1}66` : undefined,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function LegendDot({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="w-3 h-0.5 rounded-full"
        style={{
          background: color,
          borderTop: dashed ? `2px dashed ${color}` : undefined,
          height: dashed ? 0 : 3,
        }}
      />
      {label}
    </span>
  )
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-40 flex items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gradient-to-br from-gray-50 to-white">
      <p className="text-sm text-gray-400">{label}</p>
    </div>
  )
}
