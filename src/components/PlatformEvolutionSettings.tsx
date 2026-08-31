import { useEffect, useState } from 'react'
import { toast } from './Toast'
import {
  usePlatformEvolutionSettings,
  useSavePlatformEvolutionSettings,
} from '../hooks/usePlatformEvolutionSettings'

export default function PlatformEvolutionSettings() {
  const { data, isLoading } = usePlatformEvolutionSettings()
  const save = useSavePlatformEvolutionSettings()

  const [apiUrl, setApiUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')

  useEffect(() => {
    if (!data) return
    setApiUrl(data.apiUrl)
    setApiKey(data.apiKey)
    setWebhookUrl(data.webhookUrl)
  }, [data])

  const handleSave = async () => {
    try {
      await save.mutateAsync({ apiUrl, apiKey, webhookUrl })
      toast('Platform integration settings saved', 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  if (isLoading) {
    return <p className="text-sm text-gray-400 py-4">Loading platform settings…</p>
  }

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-1">Evolution API Connection</h3>
        <p className="text-sm text-gray-500 mb-4">
          Shared across all organizations and WhatsApp instances. Configure once here — org admins manage
          instance linking in Settings.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1" htmlFor="platform-evo-url">
              Evolution API URL
            </label>
            <input
              id="platform-evo-url"
              type="url"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://whatsappcrm.share.zrok.io"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="text-xs text-gray-400 mt-1">Base URL of your Evolution API server.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1" htmlFor="platform-evo-key">
              Evolution API Key
            </label>
            <input
              id="platform-evo-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="changeme123"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              Same as <code className="bg-gray-100 px-1 rounded">AUTHENTICATION_API_KEY</code> in docker-compose.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-1">Webhook Configuration</h3>
        <p className="text-sm text-gray-500 mb-4">
          Edge Function URL that receives WhatsApp events from Evolution API for every instance.
        </p>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-600 mb-1" htmlFor="platform-webhook-url">
            Evolution webhook URL (Supabase Edge Function)
          </label>
          <input
            id="platform-webhook-url"
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://YOUR-PROJECT.supabase.co/functions/v1/evolution-webhook"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono"
          />
          <p className="text-xs text-gray-400 mt-1">
            Used when applying webhooks to Evolution instances from Settings.
          </p>
        </div>

        <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-2 mb-4">
          <p className="font-medium text-gray-700">Deploy Supabase Edge Functions</p>
          <pre className="text-xs text-gray-600 bg-white rounded border border-gray-200 p-3 overflow-x-auto">{`supabase secrets set EVOLUTION_API_KEY=... EVOLUTION_API_URL=...
supabase functions deploy`}</pre>
          <p className="text-xs text-gray-400">
            After deploy, copy the <code className="bg-gray-100 px-1 rounded">evolution-webhook</code> URL above.
          </p>
        </div>

        <p className="text-xs text-gray-400 mb-4">
          Events: <code className="bg-gray-100 px-1 rounded">MESSAGES_UPSERT</code>{' '}
          <code className="bg-gray-100 px-1 rounded">MESSAGES_UPDATE</code>{' '}
          <code className="bg-gray-100 px-1 rounded">CONNECTION_UPDATE</code>
        </p>

        <button
          onClick={handleSave}
          disabled={save.isPending}
          className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save platform settings'}
        </button>
      </div>
    </div>
  )
}
