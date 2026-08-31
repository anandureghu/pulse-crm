import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTenantStore, selectActiveInstance, selectOrgInstances } from '../store/tenantStore'
import { reloadInstancesForOrgs } from '../lib/tenant'
import { usePlatformEvolutionSettings } from '../hooks/usePlatformEvolutionSettings'

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
}

interface InstanceEvolutionSettings {
  activeInstance: string
  displayNames?: Record<string, string>
}

type EvoRuntimeSettings = InstanceEvolutionSettings & {
  apiUrl: string
  apiKey: string
  webhookUrl: string
}

interface Instance {
  instanceName: string
  displayName: string
  crmInstanceId?: string
  instanceId?: string
  connectionStatus?: string
  ownerJid?: string
  profileName?: string
  profilePicUrl?: string
  integration?: string
  webhookConfigured?: boolean
}

function newEvolutionInstanceName(): string {
  return crypto.randomUUID()
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
  const activeOrganizationId = useTenantStore((s) => s.activeOrganizationId)
  const activeInstanceId = useTenantStore((s) => s.activeInstanceId)
  const orgIds = useTenantStore(useShallow((s) => s.organizations.map((o) => o.id)))
  const orgCrmInstances = useTenantStore(useShallow(selectOrgInstances))
  const crmInstance = useTenantStore(selectActiveInstance)
  const { data: platformEvo } = usePlatformEvolutionSettings()

  const [instanceEvo, setInstanceEvo] = useState<InstanceEvolutionSettings>({
    activeInstance: '',
    displayNames: {},
  })
  const [aiConfig, setAiConfig] = useState<AiConfig>({
    apiKey: '', model: 'gpt-4o-mini', systemPrompt: '', enabled: false,
  })
  const [aiSaved, setAiSaved] = useState(false)
  const [aiSaving, setAiSaving] = useState(false)
  const [shopifyConfig, setShopifyConfig] = useState<ShopifyConfig>({
    shopDomain: '', clientId: '', clientSecret: '',
  })
  const [shopifySaved, setShopifySaved] = useState(false)
  const [shopifySaving, setShopifySaving] = useState(false)
  const settings = useMemo<EvoRuntimeSettings>(() => ({
    apiUrl: platformEvo?.apiUrl ?? '',
    apiKey: platformEvo?.apiKey ?? '',
    webhookUrl: platformEvo?.webhookUrl ?? '',
    activeInstance: instanceEvo.activeInstance,
    displayNames: instanceEvo.displayNames,
  }), [platformEvo, instanceEvo])

  const orgLinkedEvoNames = useMemo(
    () => orgCrmInstances
      .map((i) => i.evolutionInstanceName)
      .filter((name): name is string => Boolean(name)),
    [orgCrmInstances],
  )

  const settingsRef = useRef(settings)
  useEffect(() => { settingsRef.current = settings }, [settings])

  const [instances, setInstances] = useState<Instance[]>([])
  const [loadingInstances, setLoadingInstances] = useState(false)
  const [instanceAction, setInstanceAction] = useState<InstanceAction | null>(null)
  const [renaming, setRenaming] = useState<RenameState>(null)
  const [newInstanceName, setNewInstanceName] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [qrModal, setQrModal] = useState<{ evoName: string; displayName: string; src: string } | null>(null)
  const [qrCountdown, setQrCountdown] = useState(60)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const persistInstanceSettings = async (patch: {
    evolution?: InstanceEvolutionSettings
    ai_config?: AiConfig
    shopify_config?: ShopifyConfig
    evolutionInstanceName?: string | null
    name?: string
  }) => {
    if (!activeInstanceId || !crmInstance) throw new Error('No active instance')
    const nextSettings = {
      ...crmInstance.settings,
      ...(patch.evolution ? { evolution: patch.evolution } : {}),
      ...(patch.ai_config ? { ai_config: patch.ai_config } : {}),
      ...(patch.shopify_config ? { shopify_config: patch.shopify_config } : {}),
    }
    const row: Record<string, unknown> = { settings: nextSettings }
    if (patch.evolutionInstanceName !== undefined) {
      row.evolution_instance_name = patch.evolutionInstanceName
    }
    if (patch.name) row.name = patch.name
    const { error: upErr } = await supabase.from('instances').update(row).eq('id', activeInstanceId)
    if (upErr) throw upErr
    await reloadInstancesForOrgs(orgIds)
  }

  // ── Load from active CRM instance ──────────────────────────────────────────
  useEffect(() => {
    if (!crmInstance) return
    const evo = (crmInstance.settings.evolution ?? {}) as Partial<InstanceEvolutionSettings & { activeInstance?: string }>
    setInstanceEvo({
      activeInstance: crmInstance.evolutionInstanceName ?? evo.activeInstance ?? '',
      displayNames: evo.displayNames ?? {},
    })
    const ai = (crmInstance.settings.ai_config ?? {}) as Partial<AiConfig>
    setAiConfig({
      apiKey: ai.apiKey ?? '',
      model: ai.model ?? 'gpt-4o-mini',
      systemPrompt: ai.systemPrompt ?? '',
      enabled: ai.enabled ?? false,
    })
    const shop = (crmInstance.settings.shopify_config ?? {}) as Partial<ShopifyConfig>
    setShopifyConfig({
      shopDomain: shop.shopDomain ?? '',
      clientId: shop.clientId ?? '',
      clientSecret: shop.clientSecret ?? '',
    })
  }, [crmInstance])

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
    if (!activeOrganizationId) {
      setInstances([])
      return
    }

    const orgCrm = useTenantStore.getState()
      .instances
      .filter((i) => i.organizationId === activeOrganizationId && i.active && i.evolutionInstanceName)
    if (orgCrm.length === 0) {
      setInstances([])
      return
    }

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
            displayName: item.instance.instanceName,
            instanceId: item.instance.instanceId ?? item.instance.id,
            connectionStatus: item.instance.connectionStatus ?? item.instance.status,
            ownerJid: item.instance.ownerJid,
            profileName: item.instance.profileName,
            profilePicUrl: item.instance.profilePicUrl,
            integration: item.instance.integration,
          }
        }
        // flat shape: { name, connectionStatus, ... }
        const instanceName = item.instanceName ?? item.name
        return {
          instanceName,
          displayName: instanceName,
          instanceId: item.instanceId ?? item.id,
          connectionStatus: item.connectionStatus ?? item.status,
          ownerJid: item.ownerJid,
          profileName: item.profileName,
          profilePicUrl: item.profilePicUrl,
          integration: item.integration,
        }
      }).filter((inst) => !!inst.instanceName)

      const byName = new Map(list.map((inst) => [inst.instanceName, inst]))
      const orgList = orgCrm.map((crm) => {
        const evoName = crm.evolutionInstanceName as string
        const found = byName.get(evoName)
        return {
          ...(found ?? { instanceName: evoName, connectionStatus: 'close' }),
          displayName: crm.name,
          crmInstanceId: crm.id,
        }
      })

      // Check webhook status for each org-linked instance
      const withWebhook = await Promise.all(
        orgList.map(async (inst) => {
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
  }, [evo, activeOrganizationId])

  const apiUrl = settings.apiUrl
  const apiKey = settings.apiKey
  useEffect(() => {
    if (apiUrl && apiKey && activeOrganizationId) loadInstances()
    else setInstances([])
  }, [apiUrl, apiKey, activeOrganizationId, orgLinkedEvoNames, loadInstances])

  // ── Save instance display names ────────────────────────────────────────────
  const flash = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(null), 3000)
  }

  // ── Link Evolution WA instance to this CRM instance ────────────────────────
  const switchInstance = async (evoName: string) => {
    const displayName = instances.find((i) => i.instanceName === evoName)?.displayName ?? evoName
    const updated = { ...instanceEvo, activeInstance: evoName }
    setInstanceEvo(updated)
    try {
      await persistInstanceSettings({
        evolution: updated,
        evolutionInstanceName: evoName,
      })
      flash(`Linked "${displayName}" to this workspace`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // ── Set webhook on instance ────────────────────────────────────────────────
  const setWebhook = async (evoName: string) => {
    const displayName = instances.find((i) => i.instanceName === evoName)?.displayName ?? evoName
    const webhookUrl = settingsRef.current.webhookUrl.trim()
    if (!webhookUrl) {
      setError('Webhook URL is not configured. Ask a platform admin to set it under Admin → Platform integration.')
      return
    }
    setInstanceAction({ name: evoName, op: 'webhook' })
    setError(null)
    try {
      await evo('POST', `/webhook/set/${evoName}`, {
        webhook: {
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: false,
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
        },
      })
      flash(`Webhook configured for "${displayName}"`)
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
    if (!activeOrganizationId) {
      setError('Select an organization first')
      return
    }
    const displayName = newInstanceName.trim()
    const evoName = newEvolutionInstanceName()
    setInstanceAction({ name: evoName, op: 'create' })
    setError(null)
    try {
      await evo('POST', '/instance/create', {
        instanceName: evoName,
        integration: 'WHATSAPP-BAILEYS',
      })
      const { error: insErr } = await supabase.from('instances').insert({
        organization_id: activeOrganizationId,
        name: displayName,
        evolution_instance_name: evoName,
        settings: {
          evolution: { activeInstance: evoName },
          ai_config: aiConfig,
          shopify_config: shopifyConfig,
        },
        active: true,
      })
      if (insErr) throw insErr
      await reloadInstancesForOrgs(orgIds)
      setNewInstanceName('')
      setShowCreate(false)
      flash(`Created WhatsApp instance "${displayName}" — switch to it in the header`)
      await loadInstances()
    } catch (e) {
      setError(`Create failed: ${(e as Error).message}`)
    } finally {
      setInstanceAction(null)
    }
  }

  // ── Delete instance ────────────────────────────────────────────────────────
  const deleteInstance = async (evoName: string) => {
    const displayName = instances.find((i) => i.instanceName === evoName)?.displayName ?? evoName
    if (!confirm(`Delete instance "${displayName}"? This will disconnect WhatsApp.`)) return
    setInstanceAction({ name: evoName, op: 'delete' })
    setError(null)
    try {
      await evo('DELETE', `/instance/delete/${evoName}`)
      if (instanceEvo.activeInstance === evoName) {
        const updated = { ...instanceEvo, activeInstance: '' }
        setInstanceEvo(updated)
        await persistInstanceSettings({ evolution: updated, evolutionInstanceName: null })
      }
      // Soft-deactivate matching CRM instances in this org
      if (activeOrganizationId) {
        await supabase
          .from('instances')
          .update({ active: false, evolution_instance_name: null })
          .eq('organization_id', activeOrganizationId)
          .eq('evolution_instance_name', evoName)
        await reloadInstancesForOrgs(orgIds)
      }
      await loadInstances()
    } catch (e) {
      setError(`Delete failed: ${(e as Error).message}`)
    } finally {
      setInstanceAction(null)
    }
  }

  // ── Rename instance (display name only) ────────────────────────────────────
  const renameInstance = async (evoInstanceName: string, displayName: string) => {
    const trimmed = displayName.trim()
    if (!trimmed || !activeOrganizationId) { setRenaming(null); return }
    setInstanceAction({ name: evoInstanceName, op: 'rename' })
    try {
      const { error: upErr } = await supabase
        .from('instances')
        .update({ name: trimmed })
        .eq('organization_id', activeOrganizationId)
        .eq('evolution_instance_name', evoInstanceName)
      if (upErr) throw upErr
      await reloadInstancesForOrgs(orgIds)
      await loadInstances()
      setRenaming(null)
      flash(`Renamed to "${trimmed}"`)
    } catch (e) {
      setError((e as Error).message)
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
  const getQR = async (evoName: string) => {
    const displayName = instances.find((i) => i.instanceName === evoName)?.displayName ?? evoName
    setInstanceAction({ name: evoName, op: 'qr' })
    setError(null)
    try {
      const data = await evo('GET', `/instance/connect/${evoName}`)
      const base64 = data?.base64 ?? data?.qrcode?.base64 ?? null
      if (!base64) {
        setError(`No QR returned — "${displayName}" may already be connected.`)
      } else {
        setQrCountdown(60)
        setQrModal({
          evoName,
          displayName,
          src: base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`,
        })
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
          getQR(qrModal.evoName)
          return 60
        }
        return n - 1
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [qrModal?.evoName, qrModal?.src]) // reset whenever a new QR image arrives

  const _isBusy = (name: string, op?: string) =>
    instanceAction?.name === name && (!op || instanceAction.op === op)
  void _isBusy

  const handleSaveShopify = async () => {
    setShopifySaving(true)
    try {
      await persistInstanceSettings({ shopify_config: shopifyConfig })
      setShopifySaved(true)
      setTimeout(() => setShopifySaved(false), 2000)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setShopifySaving(false)
    }
  }

  const handleSaveAi = async () => {
    setAiSaving(true)
    try {
      await persistInstanceSettings({ ai_config: aiConfig })
      setAiSaved(true)
      setTimeout(() => setAiSaved(false), 2000)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setAiSaving(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-full min-w-0">
      <h2 className="text-xl font-semibold text-gray-800 mb-6">Settings</h2>
      <p className="text-sm text-gray-500 mb-4 max-w-2xl">
        Configuring the active CRM instance
        {crmInstance ? ` “${crmInstance.name}”` : ''}. Switch instances from the header.
        Evolution API credentials are managed globally under{' '}
        <Link to="/admin" className="text-green-600 hover:text-green-700 underline">Admin → Platform integration</Link>.
      </p>
      <div className="max-w-2xl space-y-5">

        {(!platformEvo?.apiUrl || !platformEvo?.apiKey) && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            Evolution API URL and key are not configured yet. A platform admin must set them under{' '}
            <Link to="/admin" className="font-medium underline">Admin → Platform integration</Link>{' '}
            before WhatsApp instances can be managed here.
          </div>
        )}

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
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h3 className="font-semibold text-gray-700">WhatsApp Instances</h3>
            <div className="flex gap-2">
              <button
                onClick={loadInstances}
                disabled={loadingInstances || !settings.apiUrl || !settings.apiKey}
                className="border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-40"
              >
                {loadingInstances ? 'Loading…' : 'Refresh instances'}
              </button>
              <button
                onClick={() => setShowCreate((v) => !v)}
                disabled={!settings.apiUrl || !settings.apiKey}
                className="text-sm bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-40"
              >
                + New Instance
              </button>
            </div>
          </div>

          {showCreate && (
            <div className="mb-4 flex gap-2">
              <input
                type="text"
                value={newInstanceName}
                onChange={(e) => setNewInstanceName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createInstance()}
                placeholder="Display name (e.g. Personal, Autolust)"
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
              No WhatsApp instances for this organization yet. Create one to get started.
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
                            onClick={() => setRenaming({ name: inst.instanceName, value: inst.displayName })}
                            className="font-medium text-gray-800 text-sm hover:text-green-700 hover:underline decoration-dotted"
                            title="Click to rename"
                          >
                            {inst.displayName}
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
                          Link
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

        {/* ── Shopify ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-700 mb-1">Shopify</h3>
          <p className="text-xs text-gray-400 mb-4">
            Use Dev Dashboard app credentials (Client ID + Client secret). Tokens are fetched automatically.
            Scopes:{' '}
            <code className="bg-gray-100 px-1 rounded">read_products</code>{' '}
            <code className="bg-gray-100 px-1 rounded">read_customers</code>{' '}
            <code className="bg-gray-100 px-1 rounded">write_customers</code>{' '}
            <code className="bg-gray-100 px-1 rounded">read_orders</code>{' '}
            <code className="bg-gray-100 px-1 rounded">write_orders</code>
            . Install the app on your store first. After changing scopes, reinstall.
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
              Instance: <span className="font-medium">{qrModal.displayName}</span>
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
              onClick={() => getQR(qrModal.evoName)}
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
