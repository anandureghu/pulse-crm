import { useEffect, useRef, useState } from 'react'

type SplashScreenProps = {
  /** When true, splash can finish (auth ready). */
  ready?: boolean
  /** Called after exit animation. */
  onDone?: () => void
  /** Minimum time on screen before allow dismiss (ms). */
  minMs?: number
}

const TIPS = [
  'WhatsApp CRM for modern sales teams',
  'Follow up faster. Close more deals.',
  'Contacts → pipeline → won',
]

export default function SplashScreen({ ready = false, onDone, minMs = 900 }: SplashScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [pointer, setPointer] = useState({ x: 0.5, y: 0.45 })
  const [pressed, setPressed] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [canContinue, setCanContinue] = useState(false)
  const [tipIdx, setTipIdx] = useState(0)
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([])
  const rippleId = useRef(0)
  const doneRef = useRef(false)

  useEffect(() => {
    const t = window.setTimeout(() => setCanContinue(true), minMs)
    return () => window.clearTimeout(t)
  }, [minMs])

  useEffect(() => {
    const id = window.setInterval(() => setTipIdx((i) => (i + 1) % TIPS.length), 2800)
    return () => window.clearInterval(id)
  }, [])

  // Auto-continue shortly after ready + min time
  useEffect(() => {
    if (!ready || !canContinue || exiting) return
    const t = window.setTimeout(() => finish(), 650)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, canContinue, exiting])

  const finish = () => {
    if (doneRef.current || exiting) return
    doneRef.current = true
    setExiting(true)
    window.setTimeout(() => onDone?.(), 420)
  }

  const tryContinue = () => {
    if (ready && canContinue) finish()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const el = rootRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPointer({
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
    })
  }

  const spawnRipple = (e: React.PointerEvent) => {
    const el = rootRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const id = ++rippleId.current
    setRipples((prev) => [...prev.slice(-4), { id, x: e.clientX - r.left, y: e.clientY - r.top }])
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((x) => x.id !== id))
    }, 700)
  }

  const px = (pointer.x - 0.5) * 28
  const py = (pointer.y - 0.5) * 22
  const glowX = pointer.x * 100
  const glowY = pointer.y * 100

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="pulsrm splash"
      aria-busy={!ready}
      tabIndex={0}
      onPointerMove={onPointerMove}
      onPointerDown={(e) => {
        setPressed(true)
        spawnRipple(e)
      }}
      onPointerUp={() => {
        setPressed(false)
        tryContinue()
      }}
      onPointerLeave={() => setPressed(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          tryContinue()
        }
      }}
      className={`fixed inset-0 z-[100] overflow-hidden select-none outline-none touch-manipulation transition-opacity duration-400 ${
        exiting ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      style={{
        background:
          'radial-gradient(1200px 800px at 20% 10%, #0f766e 0%, transparent 55%), radial-gradient(900px 700px at 90% 80%, #0369a1 0%, transparent 50%), linear-gradient(155deg, #064e3b 0%, #0f172a 48%, #082f49 100%)',
      }}
    >
      {/* Pointer glow */}
      <div
        className="pointer-events-none absolute w-[42vmin] h-[42vmin] rounded-full blur-3xl transition-transform duration-150 ease-out"
        style={{
          left: `calc(${glowX}% - 21vmin)`,
          top: `calc(${glowY}% - 21vmin)`,
          background: 'radial-gradient(circle, rgba(52,211,153,0.35), transparent 70%)',
          transform: `scale(${pressed ? 1.15 : 1})`,
        }}
      />

      {/* Soft grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          transform: `translate(${px * 0.15}px, ${py * 0.15}px)`,
        }}
      />

      {/* Floating orbs */}
      {[
        { size: 180, x: 12, y: 18, delay: '0s', drift: 0.4 },
        { size: 120, x: 78, y: 22, delay: '0.4s', drift: -0.55 },
        { size: 160, x: 70, y: 68, delay: '0.8s', drift: 0.35 },
        { size: 90, x: 18, y: 72, delay: '1.1s', drift: -0.45 },
      ].map((o, i) => (
        <div
          key={i}
          className="pointer-events-none absolute rounded-full splash-float border border-white/10"
          style={{
            width: o.size,
            height: o.size,
            left: `${o.x}%`,
            top: `${o.y}%`,
            animationDelay: o.delay,
            background: 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.02))',
            transform: `translate(${px * o.drift}px, ${py * o.drift}px)`,
            backdropFilter: 'blur(2px)',
          }}
        />
      ))}

      {/* Click ripples */}
      {ripples.map((r) => (
        <span
          key={r.id}
          className="pointer-events-none absolute rounded-full border border-emerald-300/50 splash-ripple"
          style={{ left: r.x, top: r.y, width: 12, height: 12, marginLeft: -6, marginTop: -6 }}
        />
      ))}

      <div
        className="relative z-10 flex min-h-full flex-col items-center justify-center px-6 text-center"
        style={{
          transform: `translate(${px * 0.2}px, ${py * 0.2}px) scale(${pressed ? 0.985 : 1})`,
          transition: 'transform 120ms ease-out',
        }}
      >
        {/* Interactive pulse mark */}
        <button
          type="button"
          aria-label="Continue"
          onClick={(e) => {
            e.stopPropagation()
            tryContinue()
          }}
          className="group relative mb-7"
        >
          <span className="absolute inset-0 -m-4 rounded-[1.75rem] bg-emerald-400/20 blur-xl opacity-70 group-hover:opacity-100 transition-opacity splash-pulse-glow" />
          <span
            className={`relative flex h-[4.75rem] w-[4.75rem] items-center justify-center rounded-[1.35rem] shadow-2xl shadow-emerald-950/40 transition-transform duration-200 ${
              pressed ? 'scale-95' : 'group-hover:scale-105'
            }`}
            style={{
              background: 'linear-gradient(145deg, #34d399, #059669 55%, #0f766e)',
            }}
          >
            <svg width="46" height="28" viewBox="0 0 46 28" fill="none" aria-hidden>
              <polyline
                className="splash-wave"
                points="2,14 9,14 13,4 18,24 23,8 28,20 33,14 44,14"
                stroke="white"
                strokeWidth="3.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </span>
        </button>

        <h1 className="font-display text-4xl sm:text-5xl tracking-tight text-white">
          puls<span className="text-emerald-300">rm</span>
        </h1>

        <p
          key={tipIdx}
          className="mt-3 max-w-xs text-sm text-emerald-50/80 splash-tip"
        >
          {TIPS[tipIdx]}
        </p>

        {/* Progress / CTA */}
        <div className="mt-10 flex flex-col items-center gap-3">
          <div className="h-1 w-36 overflow-hidden rounded-full bg-white/15">
            <div
              className={`h-full rounded-full bg-gradient-to-r from-emerald-300 to-sky-300 transition-all duration-500 ${
                ready && canContinue ? 'w-full' : 'splash-progress'
              }`}
            />
          </div>
          <p className="text-xs font-medium text-white/55 tracking-wide">
            {ready && canContinue
              ? 'Tap anywhere to continue'
              : 'Warming up your workspace…'}
          </p>
        </div>
      </div>
    </div>
  )
}
