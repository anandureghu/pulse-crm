import { supabase } from './supabase'

export type OrgInstance = {
  id: string
  name: string
  evolution_instance_name: string | null
  active: boolean
}

export type AdminOrgRow = {
  id: string
  name: string
  slug: string
  active: boolean
  created_at: string
  memberCount: number
  instanceCount: number
  instances: OrgInstance[]
}

export async function invokeManageOrg(body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-org`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Request failed')
  return json
}

export async function fetchAdminOrganizations(): Promise<AdminOrgRow[]> {
  const data = await invokeManageOrg({ action: 'list' })
  return data.organizations ?? []
}
