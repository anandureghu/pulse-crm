import { useEffect, useRef, useState } from 'react'
import type { Message } from '../types'
import { fetchMediaBase64 } from '../lib/functions'

import { formatMessageTime } from '../lib/datetime'

function realCaption(text: string | undefined): string | null {
  if (!text) return null
  if (/^\[.*\]$/.test(text.trim())) return null
  return text
}

export function MessageBubble({
  msg,
  customerPhone,
  isGroup,
  onStar,
}: {
  msg: Message
  customerPhone?: string
  isGroup?: boolean
  onStar?: (id: string, starred: boolean) => void
}) {
  const isAgent = msg.sender === 'agent'

  const tick =
    msg.status === 'read' ? (
      <span className="text-blue-300 font-bold">✓✓</span>
    ) : msg.status === 'delivered' ? (
      <span className="opacity-60">✓✓</span>
    ) : (
      <span className="opacity-60">✓</span>
    )

  return (
    <div className={`group flex items-end gap-1 ${isAgent ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Star button — visible on hover or when starred */}
      {onStar && (
        <button
          onClick={() => onStar(msg.id, !msg.starred)}
          title={msg.starred ? 'Unstar message' : 'Star message'}
          className={`flex-shrink-0 text-base leading-none transition-opacity mb-2 ${
            msg.starred ? 'opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
          }`}
        >
          {msg.starred ? '⭐' : '☆'}
        </button>
      )}

      <div
        className={`px-3 py-2 rounded-2xl text-sm max-w-xs shadow-sm ${
          msg.type === 'sticker'
            ? 'bg-transparent shadow-none px-0 py-0'
            : isAgent
            ? 'bg-green-600 text-white rounded-br-none'
            : 'bg-white text-gray-800 rounded-bl-none'
        }`}
      >
        {isGroup && !isAgent && msg.senderName && (
          <p className="text-xs font-semibold text-green-700 mb-0.5">{msg.senderName}</p>
        )}
        <MediaContent msg={msg} isAgent={isAgent} customerPhone={customerPhone} />
        {msg.type !== 'sticker' && (
          <div
            className={`text-xs mt-1 flex items-center gap-1 justify-end ${
              isAgent ? 'text-green-200' : 'text-gray-400'
            }`}
          >
            <span>{formatMessageTime(msg.timestamp)}</span>
            {isAgent && tick}
          </div>
        )}
      </div>
    </div>
  )
}

function MediaContent({
  msg,
  isAgent,
  customerPhone,
}: {
  msg: Message
  isAgent: boolean
  customerPhone?: string
}) {
  const captionCls = isAgent ? 'text-green-100' : 'text-gray-500'
  const caption = realCaption(msg.text)

  if (msg.type === 'image' && msg.media) {
    return <ImageMessage msg={msg} isAgent={isAgent} captionCls={captionCls} caption={caption} customerPhone={customerPhone} />
  }

  if (msg.type === 'sticker' && msg.media) {
    return <StickerMessage msg={msg} customerPhone={customerPhone} />
  }

  if (msg.type === 'audio' && msg.media) {
    return <AudioMessage msg={msg} isAgent={isAgent} customerPhone={customerPhone} />
  }

  if (msg.type === 'video' && msg.media) {
    return <VideoMessage msg={msg} isAgent={isAgent} captionCls={captionCls} caption={caption} customerPhone={customerPhone} />
  }

  if (msg.type === 'document' && msg.media) {
    return (
      <a
        href={msg.media}
        target="_blank"
        rel="noreferrer"
        className={`flex items-center gap-2 ${isAgent ? 'text-green-100 hover:text-white' : 'text-blue-600 hover:text-blue-800'}`}
      >
        <span className="text-xl flex-shrink-0">📄</span>
        <span className="text-sm underline truncate max-w-[180px]">{caption || 'Document'}</span>
      </a>
    )
  }

  return <span>{caption || (msg.media ? '📎 Attachment' : `[${msg.type}]`)}</span>
}

// ── Shared hook for fetching media via Evolution API on CDN failure ────────────

function useEvoSrc(msg: Message, msgType: string, customerPhone?: string) {
  const [src, setSrc] = useState<string>(msg.media!)
  const [fetching, setFetching] = useState(false)
  const [failed, setFailed] = useState(false)
  // ref so the guard is never stale across async calls
  const tried = useRef(false)

  const onError = async () => {
    if (tried.current) { setFailed(true); return }
    tried.current = true
    if (!customerPhone) { setFailed(true); return }
    setFetching(true)
    const base64 = await fetchMediaBase64(msg.id, customerPhone, msgType)
    setFetching(false)
    if (base64) setSrc(base64)
    else setFailed(true)
  }

  return { src, fetching, failed, onError }
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function downloadSrc(src: string, filename = 'image') {
  if (src.startsWith('data:')) {
    const mimeMatch = src.match(/^data:([^;]+);/)
    const mime = mimeMatch?.[1] ?? 'image/jpeg'
    const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
    const base64 = src.split(',')[1]
    const bytes = atob(base64)
    const arr = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
    const blob = new Blob([arr], { type: mime })
    triggerDownload(URL.createObjectURL(blob), `${filename}.${ext}`)
  } else {
    fetch(src)
      .then(r => r.blob())
      .then(blob => {
        const mime = blob.type === 'application/octet-stream' ? 'image/jpeg' : blob.type
        const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
        const fixedBlob = new Blob([blob], { type: mime })
        triggerDownload(URL.createObjectURL(fixedBlob), `${filename}.${ext}`)
      })
      .catch(() => {
        const a = document.createElement('a')
        a.href = src
        a.download = filename
        a.click()
      })
  }
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col items-center max-w-[90vw] max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        <img
          src={src}
          alt="full size"
          className="max-w-full max-h-[85vh] object-contain rounded-lg"
        />
        <div className="absolute top-2 right-2 flex gap-2">
          <button
            onClick={() => downloadSrc(src)}
            className="bg-black/60 hover:bg-black/80 text-white rounded-full w-8 h-8 flex items-center justify-center text-base"
            title="Download"
          >
            ↓
          </button>
          <button
            onClick={onClose}
            className="bg-black/60 hover:bg-black/80 text-white rounded-full w-8 h-8 flex items-center justify-center text-base"
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}

function MediaFallbackLink({
  href,
  msgType,
  isAgent,
}: {
  href: string
  msgType: string
  isAgent: boolean
}) {
  const icon = msgType === 'image' ? '🖼️' : msgType === 'audio' ? '🎵' : msgType === 'video' ? '🎬' : '📎'
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`flex items-center gap-2 py-1 ${
        isAgent ? 'text-green-100 hover:text-white' : 'text-blue-600 hover:text-blue-800'
      }`}
    >
      <span className="text-xl">{icon}</span>
      <span className="text-sm underline">View {msgType}</span>
    </a>
  )
}

// ── Image ─────────────────────────────────────────────────────────────────────

function ImageMessage({
  msg,
  isAgent,
  captionCls,
  caption,
  customerPhone,
}: {
  msg: Message
  isAgent: boolean
  captionCls: string
  caption: string | null
  customerPhone?: string
}) {
  const { src, fetching, failed, onError } = useEvoSrc(msg, 'image', customerPhone)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  if (failed) return <MediaFallbackLink href={msg.media!} msgType="image" isAgent={isAgent} />

  return (
    <div>
      {fetching ? (
        <div className="w-48 h-24 rounded-lg bg-black/10 flex items-center justify-center text-xs opacity-60">
          Loading…
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className="block p-0 border-0 bg-transparent cursor-zoom-in"
        >
          <img
            src={src}
            alt="photo"
            onError={onError}
            className="rounded-lg max-w-full max-h-60 object-cover mb-1 hover:opacity-90 transition-opacity"
          />
        </button>
      )}
      {caption && <p className={`text-xs ${captionCls}`}>{caption}</p>}
      {lightboxOpen && <Lightbox src={src} onClose={() => setLightboxOpen(false)} />}
    </div>
  )
}

// ── Sticker ───────────────────────────────────────────────────────────────────

function StickerMessage({
  msg,
  customerPhone,
}: {
  msg: Message
  customerPhone?: string
}) {
  const { src, fetching, failed, onError } = useEvoSrc(msg, 'sticker', customerPhone)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  if (failed) return <span className="text-2xl">🎭</span>

  if (fetching) {
    return (
      <div className="w-24 h-24 rounded-lg bg-black/10 flex items-center justify-center text-xs opacity-60">
        Loading…
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        className="block p-0 border-0 bg-transparent cursor-zoom-in"
      >
        <img
          src={src}
          alt="sticker"
          onError={onError}
          className="w-28 h-28 object-contain hover:scale-105 transition-transform"
        />
      </button>
      {lightboxOpen && <Lightbox src={src} onClose={() => setLightboxOpen(false)} />}
    </>
  )
}

// ── Audio ─────────────────────────────────────────────────────────────────────

function AudioMessage({
  msg,
  isAgent,
  customerPhone,
}: {
  msg: Message
  isAgent: boolean
  customerPhone?: string
}) {
  const { src, fetching, failed, onError } = useEvoSrc(msg, 'audio', customerPhone)

  if (failed) return <MediaFallbackLink href={msg.media!} msgType="audio" isAgent={isAgent} />

  if (fetching) {
    return (
      <div className="w-48 h-8 rounded bg-black/10 flex items-center justify-center text-xs opacity-60">
        Loading…
      </div>
    )
  }

  return (
    <audio
      controls
      src={src}
      onError={onError}
      className="max-w-[220px] h-8 rounded"
      style={{ filter: isAgent ? 'invert(1)' : 'none' }}
    />
  )
}

// ── Video ─────────────────────────────────────────────────────────────────────

function VideoMessage({
  msg,
  isAgent,
  captionCls,
  caption,
  customerPhone,
}: {
  msg: Message
  isAgent: boolean
  captionCls: string
  caption: string | null
  customerPhone?: string
}) {
  const { src, fetching, failed, onError } = useEvoSrc(msg, 'video', customerPhone)

  if (failed) return <MediaFallbackLink href={msg.media!} msgType="video" isAgent={isAgent} />

  return (
    <div>
      {fetching ? (
        <div className="w-48 h-24 rounded-lg bg-black/10 flex items-center justify-center text-xs opacity-60">
          Loading…
        </div>
      ) : (
        <video
          controls
          src={src}
          onError={onError}
          className="rounded-lg max-w-full max-h-48"
          preload="metadata"
        />
      )}
      {caption && <p className={`text-xs mt-1 ${captionCls}`}>{caption}</p>}
    </div>
  )
}
