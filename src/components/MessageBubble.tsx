import { useRef, useState } from 'react'
import type { Message } from '../types'
import { fetchMediaBase64 } from '../lib/functions'

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function realCaption(text: string | undefined): string | null {
  if (!text) return null
  if (/^\[.*\]$/.test(text.trim())) return null
  return text
}

export function MessageBubble({ msg, customerPhone }: { msg: Message; customerPhone?: string }) {
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
    <div className={`flex ${isAgent ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`px-3 py-2 rounded-2xl text-sm max-w-xs shadow-sm ${
          isAgent
            ? 'bg-green-600 text-white rounded-br-none'
            : 'bg-white text-gray-800 rounded-bl-none'
        }`}
      >
        <MediaContent msg={msg} isAgent={isAgent} customerPhone={customerPhone} />
        <div
          className={`text-xs mt-1 flex items-center gap-1 justify-end ${
            isAgent ? 'text-green-200' : 'text-gray-400'
          }`}
        >
          <span>{msg.timestamp ? formatTime(msg.timestamp) : ''}</span>
          {isAgent && tick}
        </div>
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

  if (failed) return <MediaFallbackLink href={msg.media!} msgType="image" isAgent={isAgent} />

  return (
    <div>
      {fetching ? (
        <div className="w-48 h-24 rounded-lg bg-black/10 flex items-center justify-center text-xs opacity-60">
          Loading…
        </div>
      ) : (
        <a href={src} target="_blank" rel="noreferrer">
          <img
            src={src}
            alt="photo"
            onError={onError}
            className="rounded-lg max-w-full max-h-60 object-cover mb-1 cursor-pointer hover:opacity-90 transition-opacity"
          />
        </a>
      )}
      {caption && <p className={`text-xs ${captionCls}`}>{caption}</p>}
    </div>
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
