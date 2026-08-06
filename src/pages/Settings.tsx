import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

interface AiConfig {
  apiKey: string
  model: string
  systemPrompt: string
  enabled: boolean
}

interface ShopifyConfig {
  shopDomain: string
  clientId: string
  clientSecret: string
  apiVersion: string
}

interface EvolutionSettings {
  apiUrl: string
  activeInstance: string
  apiKey: string
  webhookUrl: string
  displayNames?: Record<string, string>
}

interface Instance {
  instanceName: string
  instanceId?: string
  connectionStatus?: string
  ownerJid?: string
  profileName?: string
  profilePicUrl?: string
  integration?: string
  webhookConfigured?: boolean
}

type InstanceAction = { name: string; op: string }

type RenameState = { name: string; value: string } | null

const STATUS_COLOR: Record<string, string> = {
  open: 'bg-green-500',
  connected: 'bg-green-500',
  close: 'bg-gray-300',
  closed: 'bg-gray-300',
  connecting: 'bg-yellow-400',
  qrcode: 'bg-yellow-400',
  error: 'bg-red-400',
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Connected',
  connected: 'Connected',
  close: 'Disconnected',
  closed: 'Disconnected',
  connecting: 'Connecting…',
  qrcode: 'Waiting for QR scan',
  error: 'Error',
}

export default function Settings() {
  const [settings, setSettings] = useState<EvolutionSettings>({
    apiUrl: '', activeInstance: '', apiKey: '', webhookUrl: '',
  })
  const [aiConfig, setAiConfig] = useState<AiConfig>({
    apiKey: '', model: 'gpt-4o-mini', systemPrompt: '', enabled: false,
  })
  const [aiSaved, setAiSaved] = useState(false)
  const [aiSaving, setAiSaving] = useState(false)
  const [shopifyConfig, setShopifyConfig] = useState<ShopifyConfig>({
    shopDomain: '', clientId: '', clientSecret: '', apiVersion: '2024-10',
  })
  const [shopifySaved, setShopifySaved] = useState(false)
  const [shopifySaving, setShopifySaving] = useState(false)
  const settingsRef = useRef(settings)
  useEffect(() => { settingsRef.current = settings }, [settings])

  const [saved, setSaved] = useState(false)
  const [instances, setInstances] = useState<Instance[]>([])
  const [loadingInstances, setLoadingInstances] = useState(false)
  const [instanceAction, setInstanceAction] = useState<InstanceAction | null>(null)
  const [renaming, setRenaming] = useState<RenameState>(null)
  const [newInstanceName, setNewInstanceName] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [qrModal, setQrModal] = useState<{ name: string; src: string } | null>(null)
  const [qrCountdown, setQrCountdown] = useState(60)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // ── Load from Supabase ─────────────────────────────────────────────────────
  useEffect(() => {
    supabase.from('settings').select('value').eq('key', 'evolution').maybeSingle().then(({ data }) => {
      if (data?.value) {
        const d = data.value as {
          apiUrl?: string
          activeInstance?: string
          instanceName?: string
          apiKey?: string
          webhookUrl?: string
          displayNames?: Record<string, string>
        }
        setSettings({
          apiUrl: d.apiUrl ?? '',
          activeInstance: d.activeInstance ?? d.instanceName ?? '',
          apiKey: d.apiKey ?? '',
          webhookUrl: d.webhookUrl ?? '',
          displayNames: d.displayNames ?? {},
        })
      }
    })
    supabase.from('settings').select('value').eq('key', 'ai_config').maybeSingle().then(({ data }) => {
      if (data?.value) {
        const d = data.value as Record<string, string | boolean>
        setAiConfig({
          apiKey: (d.apiKey as string) ?? '',
          model: (d.model as string) ?? 'gpt-4o-mini',
          systemPrompt: (d.systemPrompt as string) ?? '',
          enabled: (d.enabled as boolean) ?? false,
        })
      }
    })
    supabase.from('settings').select('value').eq('key', 'shopify_config').maybeSingle().then(({ data }) => {
      if (data?.value) {
        const d = data.value as unknown as Record<string, string>
        setShopifyConfig({
          shopDomain: d.shopDomain ?? '',
          clientId: d.clientId ?? '',
          clientSecret: d.clientSecret ?? '',
          apiVersion: d.apiVersion ?? '2024-10',
        })
      }
    })
  }, [])

  // ── Evolution API helper ───────────────────────────────────────────────────
  const evo = useCallback(async (method: string, path: string, body?: unknown) => {
    const { apiUrl, apiKey } = settingsRef.current
    if (!apiUrl || !apiKey) throw new Error('Set API URL and API Key first, then Save.')
    const base = apiUrl.replace(/\/$/, '')
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { apikey: apiKey, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`${res.status}: ${text}`)
    }
    return res.json()
  }, [])

  // ── Load instances ─────────────────────────────────────────────────────────
  const loadInstances = useCallback(async () => {
    if (!settingsRef.current.apiUrl || !settingsRef.current.apiKey) return
    setLoadingInstances(true)
    setError(null)
    try {
      const data = await evo('GET', '/instance/fetchInstances')
      const raw: any[] = Array.isArray(data) ? data : data?.instances ?? []

      const list: Instance[] = raw.map((item: any) => {
        // nested shape: { instance: { instanceName, ... } }
        if (item?.instance?.instanceName) {
          return {
            instanceName: item.instance.instanceName,
            instanceId: item.instance.instanceId ?? item.instance.id,
            connectionStatus: item.instance.connectionStatus ?? item.instance.status,
            ownerJid: item.instance.ownerJid,
            profileName: item.instance.profileName,
            profilePicUrl: item.instance.profilePicUrl,
            integration: item.instance.integration,
          }
        }
        // flat shape: { name, connectionStatus, ... }
        return {
          instanceName: item.instanceName ?? item.name,
          instanceId: item.instanceId ?? item.id,
          connectionStatus: item.connectionStatus ?? item.status,
          ownerJid: item.ownerJid,
          profileName: item.profileName,
          profilePicUrl: item.profilePicUrl,
          integration: item.integration,
        }
      }).filter((inst) => !!inst.instanceName)

      // Check webhook status for each instance
      const withWebhook = await Promise.all(
        list.map(async (inst) => {
          try {
            const wh = await evo('GET', `/webhook/find/${inst.instanceName}`)
            const url = wh?.url ?? wh?.webhook?.url ?? ''
            const enabled = wh?.enabled ?? wh?.webhook?.enabled ?? false
            return { ...inst, webhookConfigured: !!(url && enabled) }
          } catch {
            return { ...inst, webhookConfigured: false }
          }
        })
      )

      setInstances(withWebhook)
    } catch (e) {
      setError(`Could not load instances: ${(e as Error).message}`)
    } finally {
      setLoadingInstances(false)
    }
  }, [evo])

  const apiUrl = settings.apiUrl
  const apiKey = settings.apiKey
  useEffect(() => {
    if (apiUrl && apiKey) loadInstances()
  }, [apiUrl, apiKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    await supabase.from('settings').upsert({ key: 'evolution', value: settings })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const flash = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(null), 3000)
  }

  // ── Switch active instance ─────────────────────────────────────────────────
  const switchInstance = async (name: string) => {
    const updated = { ...settings, activeInstance: name }
    setSettings(updated)
    await supabase.from('settings').upsert({ key: 'evolution', value: updated })
    flash(`Active instance switched to "${name}"`)
  }

  // ── Set webhook on instance ────────────────────────────────────────────────
  const setWebhook = async (name: string) => {
    const webhookUrl = settingsRef.current.webhookUrl.trim()
    if (!webhookUrl) {
      setError('Enter your Edge Function webhook URL in the Webhook Configuration section first.')
      return
    }
    setInstanceAction({ name, op: 'webhook' })
    setError(null)
    try {
      await evo('POST', `/webhook/set/${name}`, {
        webhook: {
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: false,
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
        },
      })
      flash(`Webhook configured for "${name}"`)
      await loadInstances()
    } catch (e) {
      setError(`Webhook setup failed: ${(e as Error).message}`)
    } finally {
      setInstanceAction(null)
    }
  }

  // ── Create instance ────────────────────────────────────────────────────────
  const createInstance = async () => {
    if (!newInstanceName.trim()) return
    setInstanceAction({ name: newInstanceName, op: 'create' })
    setError(null)
    try {
      await evo('POST', '/instance/create', {
        instanceName: newInstanceName.trim(),
        integration: 'WHATSAPP-BAILEYS',
      })
      setNewInstanceName('')
      setShowCreate(false)
      await loadInstances()
    } catch (e) {
      setError(`Create failed: ${(e as Error).message}`)
    } finally {
      setInstanceAction(null)
    }
  }

  // ── Delete instance ────────────────────────────────────────────────────────
  const deleteInstance = async (name: string) => {
    if (!confirm(`Delete instance "${name}"? This will disconnect WhatsApp.`)) return
    setInstanceAction({ name, op: 'delete' })
    setError(null)
    try {
      await evo('DELETE', `/instance/delete/${name}`)
      if (settings.activeInstance === name) {
        const updated = { ...settings, activeInstance: '' }
        setSettings(updated)
        await supabase.from('settings').upsert({ key: 'evolution', value: updated })
      }
      await loadInstances()
    } catch (e) {
      setError(`Delete failed: ${(e as Error).message}`)
    } finally {
      setInstanceAction(null)
    }
  }

  // ── Rename instance (display name only, stored in settings table) ─────────
  const renameInstance = async (instanceName: string, displayName: string) => {
    const trimmed = displayName.trim()
    if (!trimmed) { setRenaming(null); return }
    setInstanceAction({ name: instanceName, op: 'rename' })
    try {
      const updated = {
        ...settingsRef.current,
        displayNames: { ...(settingsRef.current.displayNames ?? {}), [instanceName]: trimmed },
      }
      await supabase.from('settings').upsert({ key: 'evolution', value: updated })
      setSettings(updated)
      setRenaming(null)
    } catch (e) {
      setError(`Rename failed: ${(e as Error).message}`)
    } finally {
      setInstanceAction(null)
    }
  }

  // ── Logout ─────────────────────────────────────────────────────────────────
  const logoutInstance = async (name: string) => {
    setInstanceAction({ name, op: 'logout' })
    setError(null)
    try {
      await evo('DELETE', `/instance/logout/${name}`)
      await loadInstances()
    } catch (e) {
      setError(`Logout failed: ${(e as Error).message}`)
    } finally {
      setInstanceAction(null)
    }
  }

  // ── Get QR ─────────────────────────────────────────────────────────────────
  const getQR = async (name: string) => {
    setInstanceAction({ name, op: 'qr' })
    setError(null)
    try {
      const data = await evo('GET', `/instance/connect/${name}`)
      const base64 = data?.base64 ?? data?.qrcode?.base64 ?? null
      if (!base64) {
        setError(`No QR returned — "${name}" may already be connected.`)
      } else {
        setQrCountdown(60)
        setQrModal({ name, src: base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}` })
      }
    } catch (e) {
      setError(`QR failed: ${(e as Error).message}`)
    } finally {
      setInstanceAction(null)
    }
  }

  // QR countdown — starts when modal opens, auto-refreshes at 0
  useEffect(() => {
    if (!qrModal) return
    setQrCountdown(60)
    const tick = setInterval(() => {
      setQrCountdown((n) => {
        if (n <= 1) {
          clearInterval(tick)
          // auto-refresh
          getQR(qrModal.name)
          return 60
        }
        return n - 1
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [qrModal?.name, qrModal?.src]) // reset whenever a new QR image arrives

  const _isBusy = (name: string, op?: string) =>
    instanceAction?.name === name && (!op || instanceAction.op === op)
  void _isBusy

  const handleSaveShopify = async () => {
    setShopifySaving(true)
    await supabase.from('settings').upsert({
      key: 'shopify_config',
      value: shopifyConfig as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    setShopifySaving(false)
    setShopifySaved(true)
    setTimeout(() => setShopifySaved(false), 2000)
  }

  const handleSaveAi = async () => {
    setAiSaving(true)
    await supabase.from('settings').upsert({ key: 'ai_config', value: aiConfig as unknown as Record<string, unknown> })
    setAiSaving(false)
    setAiSaved(true)
    setTimeout(() => setAiSaved(false), 2000)
  }

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold text-gray-800 mb-6">Settings</h2>
      <div className="max-w-2xl space-y-5">

        {/* ── API Connection ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-700 mb-4">Evolution API Connection</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">API URL</label>
              <input
                type="text"
                value={settings.apiUrl}
                onChange={(e) => setSettings((s) => ({ ...s, apiUrl: e.target.value }))}
                placeholder="https://whatsappcrm.share.zrok.io"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">API Key</label>
              <input
                type="password"
                value={settings.apiKey}
                onChange={(e) => setSettings((s) => ({ ...s, apiKey: e.target.value }))}
                placeholder="changeme123"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                <code className="bg-gray-100 px-1 rounded">AUTHENTICATION_API_KEY</code> in docker-compose
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSave} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700">
                {saved ? '✓ Saved' : 'Save'}
              </button>
              <button
                onClick={loadInstances}
                disabled={loadingInstances}
                className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-40"
              >
                {loadingInstances ? 'Loading…' : 'Refresh Instances'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Alerts ── */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600 flex items-start gap-2">
            <span className="mt-0.5 flex-shrink-0">⚠</span>
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 flex-shrink-0">✕</button>
          </div>
        )}
        {successMsg && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700 flex items-center gap-2">
            <span>✓</span> {successMsg}
          </div>
        )}

        {/* ── Instances ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-700">WhatsApp Instances</h3>
            <button
              onClick={() => setShowCreate((v) => !v)}
              className="text-sm bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700"
            >
              + New Instance
            </button>
          </div>

          {showCreate && (
            <div className="mb-4 flex gap-2">
              <input
                type="text"
                value={newInstanceName}
                onChange={(e) => setNewInstanceName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createInstance()}
                placeholder="Instance name (e.g. mystore)"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                autoFocus
              />
              <button
                onClick={createInstance}
                disabled={!newInstanceName.trim() || !!instanceAction}
                className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-40"
              >
                {instanceAction?.op === 'create' ? 'Creating…' : 'Create'}
              </button>
              <button
                onClick={() => { setShowCreate(false); setNewInstanceName('') }}
                className="border border-gray-300 text-gray-500 px-3 py-2 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          )}

          {loadingInstances && (
            <div className="text-sm text-gray-400 py-4 text-center">Loading instances…</div>
          )}

          {!loadingInstances && instances.length === 0 && (
            <div className="text-sm text-gray-400 py-6 text-center border-2 border-dashed border-gray-200 rounded-lg">
              No instances found. Create one to get started.
            </div>
          )}

          <div className="space-y-3">
            {instances.map((inst) => {
              const isActive = settings.activeInstance === inst.instanceName
              const status = (inst.connectionStatus ?? 'unknown').toLowerCase()
              const isConnected = status === 'open' || status === 'connected'
              const busy = instanceAction?.name === inst.instanceName

              return (
                <div
                  key={inst.instanceName}
                  className={`rounded-xl border-2 p-4 transition-colors ${
                    isActive ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  {/* Top row: avatar + info + action buttons */}
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden flex-shrink-0 flex items-center justify-center text-gray-400 text-lg">
                      {inst.profilePicUrl
                        ? <img src={inst.profilePicUrl} alt="" className="w-full h-full object-cover" />
                        : '📱'}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {renaming?.name === inst.instanceName ? (
                          <form
                            className="flex items-center gap-1"
                            onSubmit={(e) => { e.preventDefault(); renameInstance(inst.instanceName, renaming.value) }}
                          >
                            <input
                              autoFocus
                              value={renaming.value}
                              onChange={(e) => setRenaming({ name: inst.instanceName, value: e.target.value })}
                              className="border border-green-400 rounded px-2 py-0.5 text-sm font-medium w-36 focus:outline-none focus:ring-2 focus:ring-green-400"
                            />
                            <button type="submit" disabled={!!instanceAction} className="text-xs bg-green-600 text-white px-2 py-0.5 rounded hover:bg-green-700 disabled:opacity-40">
                              {instanceAction?.op === 'rename' ? '…' : 'Save'}
                            </button>
                            <button type="button" onClick={() => setRenaming(null)} className="text-xs text-gray-400 hover:text-gray-600 px-1">✕</button>
                          </form>
                        ) : (
                          <button
                            onClick={() => setRenaming({ name: inst.instanceName, value: settings.displayNames?.[inst.instanceName] ?? inst.instanceName })}
                            className="font-medium text-gray-800 text-sm hover:text-green-700 hover:underline decoration-dotted"
                            title="Click to rename"
                          >
                            {settings.displayNames?.[inst.instanceName] ?? inst.instanceName}
                          </button>
                        )}
                        {isActive && (
                          <span className="text-xs bg-green-600 text-white px-1.5 py-0.5 rounded-full">Active</span>
                        )}
                        {/* Webhook badge */}
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                          inst.webhookConfigured
                            ? 'bg-blue-100 text-blue-600'
                            : 'bg-gray-100 text-gray-400'
                        }`}>
                          {inst.webhookConfigured ? '⚡ Webhook on' : '⚡ No webhook'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLOR[status] ?? 'bg-gray-300'}`} />
                        <span className="text-xs text-gray-500">{STATUS_LABEL[status] ?? status}</span>
                        {inst.profileName && (
                          <span className="text-xs text-gray-400">· {inst.profileName}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                      {!isActive && (
                        <button
                          onClick={() => switchInstance(inst.instanceName)}
                          className="text-xs border border-green-500 text-green-600 px-2.5 py-1 rounded-lg hover:bg-green-50"
                        >
                          Use
                        </button>
                      )}
                      {!isConnected && (
                        <button
                          onClick={() => getQR(inst.instanceName)}
                          disabled={busy}
                          className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-40"
                        >
                          {busy && instanceAction?.op === 'qr' ? '…' : 'QR'}
                        </button>
                      )}
                      {isConnected && (
                        <button
                          onClick={() => logoutInstance(inst.instanceName)}
                          disabled={busy}
                          className="text-xs border border-orange-400 text-orange-500 px-2.5 py-1 rounded-lg hover:bg-orange-50 disabled:opacity-40"
                        >
                          {busy && instanceAction?.op === 'logout' ? '…' : 'Logout'}
                        </button>
                      )}
                      <button
                        onClick={() => deleteInstance(inst.instanceName)}
                        disabled={busy}
                        className="text-xs border border-red-300 text-red-500 px-2.5 py-1 rounded-lg hover:bg-red-50 disabled:opacity-40"
                      >
                        {busy && instanceAction?.op === 'delete' ? '…' : 'Delete'}
                      </button>
                    </div>
                  </div>

                  {/* Webhook row */}
                  <div className={`mt-3 pt-3 border-t flex items-center gap-2 ${
                    isActive ? 'border-green-200' : 'border-gray-200'
                  }`}>
                    <span className="text-xs text-gray-500 flex-1">
                      {inst.webhookConfigured
                        ? 'Webhook active — incoming messages will reach the database'
                        : 'Webhook not set — messages will not appear in the CRM'}
                    </span>
                    <button
                      onClick={() => setWebhook(inst.instanceName)}
                      disabled={busy || !settings.webhookUrl}
                      className={`text-xs px-2.5 py-1 rounded-lg disabled:opacity-40 ${
                        inst.webhookConfigured
                          ? 'border border-gray-300 text-gray-500 hover:bg-gray-50'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {busy && instanceAction?.op === 'webhook'
                        ? 'Setting…'
                        : inst.webhookConfigured ? 'Re-apply Webhook' : 'Set Webhook'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Webhook Configuration ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-700 mb-3">Webhook Configuration</h3>
          <p className="text-sm text-gray-600 mb-3">
            This URL receives WhatsApp events from Evolution API.
            Deploy Supabase Edge Functions first, then paste the URL here.
          </p>

          <div className="mb-3">
            <label className="block text-sm text-gray-600 mb-1">Edge Function URL</label>
            <input
              type="text"
              value={settings.webhookUrl}
              onChange={(e) => setSettings((s) => ({ ...s, webhookUrl: e.target.value }))}
              placeholder="https://YOUR-PROJECT.supabase.co/functions/v1/evolution-webhook"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono"
            />
          </div>

          <button onClick={handleSave} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 mb-4">
            {saved ? '✓ Saved' : 'Save'}
          </button>

          <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-2">
            <p className="font-medium text-gray-700">Deploy Supabase Edge Functions</p>
            <pre className="text-xs text-gray-600 bg-white rounded border border-gray-200 p-3 overflow-x-auto">{`supabase secrets set EVOLUTION_API_KEY=... EVOLUTION_API_URL=... EVOLUTION_INSTANCE=...
supabase functions deploy`}</pre>
            <p className="text-xs text-gray-400">
              After deploy, copy the <code className="bg-gray-100 px-1 rounded">evolution-webhook</code> URL and paste above.
            </p>
          </div>

          <div className="mt-3 text-xs text-gray-400">
            Events configured: <code className="bg-gray-100 px-1 rounded">MESSAGES_UPSERT</code>{' '}
            <code className="bg-gray-100 px-1 rounded">MESSAGES_UPDATE</code>{' '}
            <code className="bg-gray-100 px-1 rounded">CONNECTION_UPDATE</code>
          </div>
        </div>

        {/* ── Shopify ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-700 mb-1">Shopify</h3>
          <p className="text-xs text-gray-400 mb-4">
            Use Dev Dashboard app credentials (Client ID + Client secret). Tokens are fetched automatically.
            Scopes:{' '}
            <code className="bg-gray-100 px-1 rounded">read_products</code>{' '}
            <code className="bg-gray-100 px-1 rounded">read_customers</code>{' '}
            <code className="bg-gray-100 px-1 rounded">write_customers</code>{' '}
            <code className="bg-gray-100 px-1 rounded">write_orders</code>
            . Install the app on your store first.
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Shop domain</label>
              <input
                type="text"
                value={shopifyConfig.shopDomain}
                onChange={(e) => setShopifyConfig((c) => ({ ...c, shopDomain: e.target.value }))}
                placeholder="autolust-9782.myshopify.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Client ID</label>
              <input
                type="text"
                value={shopifyConfig.clientId}
                onChange={(e) => setShopifyConfig((c) => ({ ...c, clientId: e.target.value }))}
                placeholder="From Dev Dashboard → Settings"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Client secret</label>
              <input
                type="password"
                value={shopifyConfig.clientSecret}
                onChange={(e) => setShopifyConfig((c) => ({ ...c, clientSecret: e.target.value }))}
                placeholder="From Dev Dashboard → Settings"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">API version</label>
              <input
                type="text"
                value={shopifyConfig.apiVersion}
                onChange={(e) => setShopifyConfig((c) => ({ ...c, apiVersion: e.target.value }))}
                placeholder="2024-10"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <button
              onClick={handleSaveShopify}
              disabled={shopifySaving}
              className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
            >
              {shopifySaved ? '✓ Saved' : shopifySaving ? 'Saving…' : 'Save Shopify settings'}
            </button>
          </div>
        </div>

        {/* ── AI Configuration ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-gray-700">AI Assistant</h3>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-xs text-gray-500">Enabled</span>
              <div
                onClick={() => setAiConfig((c) => ({ ...c, enabled: !c.enabled }))}
                className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${aiConfig.enabled ? 'bg-green-500' : 'bg-gray-200'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${aiConfig.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
            </label>
          </div>
          <p className="text-xs text-gray-400 mb-4">
            Powers AI suggested replies in the Inbox using <code className="bg-gray-100 px-1 rounded">gpt-4o-mini</code>.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">OpenAI API Key</label>
              <input
                type="password"
                value={aiConfig.apiKey}
                onChange={(e) => setAiConfig((c) => ({ ...c, apiKey: e.target.value }))}
                placeholder="sk-..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                Get your key at <span className="font-mono">platform.openai.com/api-keys</span>
              </p>
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">Product & company knowledge</label>
              <textarea
                value={aiConfig.systemPrompt}
                onChange={(e) => setAiConfig((c) => ({ ...c, systemPrompt: e.target.value }))}
                rows={6}
                placeholder={`Describe your products, services, pricing, policies, and tone of voice. The AI uses this to generate relevant replies.\n\nExample:\nWe sell handmade leather goods. Our flagship product is...\nPricing: wallets from ₹1200, bags from ₹3500.\nWe offer free shipping above ₹2000.`}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
              />
            </div>

            <button
              onClick={handleSaveAi}
              disabled={aiSaving}
              className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
            >
              {aiSaved ? '✓ Saved' : aiSaving ? 'Saving…' : 'Save AI settings'}
            </button>
          </div>
        </div>

      </div>

      {/* ── QR Modal ── */}
      {qrModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setQrModal(null)}>
          <div className="bg-white rounded-2xl p-6 shadow-2xl max-w-xs w-full mx-4 text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-800 mb-1">Scan to connect</h3>
            <p className="text-sm text-gray-500 mb-4">
              Instance: <span className="font-mono">{qrModal.name}</span>
            </p>
            <div className="relative w-56 h-56 mx-auto">
              <img src={qrModal.src} alt="WhatsApp QR code" className="w-full h-full rounded-xl border border-gray-200" />
              {qrCountdown <= 10 && (
                <div className="absolute inset-0 bg-white/80 rounded-xl flex items-center justify-center">
                  <p className="text-red-500 font-bold text-lg">Refreshing…</p>
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center justify-center gap-2">
              <div className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                qrCountdown <= 15 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
              }`}>
                {qrCountdown}s
              </div>
              <p className="text-xs text-gray-400">QR refreshes automatically</p>
            </div>
            <button
              onClick={() => getQR(qrModal.name)}
              className="mt-2 text-sm text-green-600 hover:text-green-700 underline block mx-auto"
            >
              Refresh QR now
            </button>
            <button
              onClick={() => setQrModal(null)}
              className="mt-2 w-full border border-gray-200 text-gray-500 py-2 rounded-lg text-sm hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
