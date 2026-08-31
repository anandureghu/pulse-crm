import { supabase } from './supabase'

export type PlatformEvolutionSettings = {
  apiUrl: string
  apiKey: string
  webhookUrl: string
}

const EVOLUTION_KEY = 'evolution'

export async function fetchPlatformEvolutionSettings(): Promise<PlatformEvolutionSettings> {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', EVOLUTION_KEY)
    .maybeSingle()
  if (error) throw error

  const value = (data?.value ?? {}) as Partial<PlatformEvolutionSettings>
  return {
    apiUrl: value.apiUrl ?? '',
    apiKey: value.apiKey ?? '',
    webhookUrl: value.webhookUrl ?? '',
  }
}

export async function savePlatformEvolutionSettings(
  settings: PlatformEvolutionSettings,
): Promise<PlatformEvolutionSettings> {
  const { data: existing, error: readErr } = await supabase
    .from('settings')
    .select('value')
    .eq('key', EVOLUTION_KEY)
    .maybeSingle()
  if (readErr) throw readErr

  const prev = (existing?.value ?? {}) as Record<string, unknown>
  const next = {
    ...prev,
    apiUrl: settings.apiUrl.trim(),
    apiKey: settings.apiKey.trim(),
    webhookUrl: settings.webhookUrl.trim(),
  }

  const { error } = await supabase
    .from('settings')
    .upsert({ key: EVOLUTION_KEY, value: next }, { onConflict: 'key' })
  if (error) throw error

  return {
    apiUrl: next.apiUrl as string,
    apiKey: next.apiKey as string,
    webhookUrl: next.webhookUrl as string,
  }
}
