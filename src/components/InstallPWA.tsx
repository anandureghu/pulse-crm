import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const DISMISS_KEY = 'pwa-install-dismissed'

function isStandalone() {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  if (window.matchMedia('(display-mode: fullscreen)').matches) return true
  // iOS Safari
  if ((navigator as Navigator & { standalone?: boolean }).standalone) return true
  return false
}

function isIosSafari() {
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome|Chromium/.test(ua)
  return isIOS && isSafari
}

export default function InstallPWA() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosHint, setShowIosHint] = useState(false)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')

  useEffect(() => {
    if (isStandalone() || dismissed) return

    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }

    const onInstalled = () => {
      setDeferred(null)
      setShowIosHint(false)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)

    if (isIosSafari()) setShowIosHint(true)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [dismissed])

  const visible = !dismissed && !isStandalone() && (deferred !== null || showIosHint)
  if (!visible) return null

  async function handleInstall() {
    if (deferred) {
      await deferred.prompt()
      const { outcome } = await deferred.userChoice
      if (outcome === 'accepted') setDeferred(null)
      return
    }
    setShowIosHint(true)
  }

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  return (
    <div className="fixed z-40 bottom-20 right-4 md:bottom-6 md:right-6 flex flex-col items-end gap-2">
      {showIosHint && !deferred && (
        <div className="max-w-60 rounded-xl bg-gray-900 text-white text-xs px-3 py-2.5 shadow-lg">
          <p className="leading-relaxed">
            Tap <span className="font-semibold">Share</span> then{' '}
            <span className="font-semibold">Add to Home Screen</span> to install pulsrm.
          </p>
        </div>
      )}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={handleDismiss}
          className="h-8 w-8 rounded-full bg-white border border-gray-200 text-gray-400 hover:text-gray-600 shadow-md flex items-center justify-center"
          aria-label="Dismiss install"
        >
          ×
        </button>
        <button
          type="button"
          onClick={handleInstall}
          className="flex items-center gap-2 rounded-full bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-3 shadow-lg shadow-green-600/30 transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 3v10m0 0l-3.5-3.5M12 13l3.5-3.5M5 17.5V19a2 2 0 002 2h10a2 2 0 002-2v-1.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Install app
        </button>
      </div>
    </div>
  )
}
