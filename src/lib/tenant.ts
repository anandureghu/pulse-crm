import { supabase } from './supabase'
import {
  useTenantStore,
  type TenantInstance,
  type TenantOrg,
} from '../store/tenantStore'

function fromInstanceRow(row: Record<string, unknown>): TenantInstance {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    name: row.name as string,
    evolutionInstanceName: (row.evolution_instance_name as string | null) ?? null,
    settings: (row.settings as Record<string, unknown>) ?? {},
    active: Boolean(row.active),
  }
}

/** Load memberships + instances and resolve active org/instance (last-used or sole). */
export async function loadTenantContext(userId: string): Promise<{
  organizations: TenantOrg[]
  instances: TenantInstance[]
  organizationId: string | null
  instanceId: string | null
  orgRole: 'admin' | 'sales' | null
  isPlatformAdmin: boolean
}> {
  const { data: profile } = await supabase
    .from('users')
    .select('is_platform_admin, last_organization_id, last_instance_id, role')
    .eq('id', userId)
    .maybeSingle()

  if (!profile) {
    return {
      organizations: [],
      instances: [],
      organizationId: null,
      instanceId: null,
      orgRole: null,
      isPlatformAdmin: false,
    }
  }

  const isPlatformAdmin = Boolean(profile.is_platform_admin)

  const { data: memberships } = await supabase
    .from('organization_members')
    .select('role, organization_id, organizations(id, name, slug, active)')
    .eq('user_id', userId)

  const organizations: TenantOrg[] = []
  for (const m of memberships ?? []) {
    const org = m.organizations as unknown as {
      id: string
      name: string
      slug: string
      active: boolean
    } | null
    if (!org || !org.active) continue
    organizations.push({
      id: org.id,
      name: org.name,
      slug: org.slug,
      active: org.active,
      role: m.role as 'admin' | 'sales',
    })
  }

  // Platform admins also see all orgs for /admin, but CRM switcher only lists memberships
  const orgIds = organizations.map((o) => o.id)
  let instances: TenantInstance[] = []
  if (orgIds.length) {
    const { data: instRows } = await supabase
      .from('instances')
      .select('*')
      .in('organization_id', orgIds)
      .eq('active', true)
      .order('name')
    instances = (instRows ?? []).map((r) => fromInstanceRow(r as Record<string, unknown>))
  }

  let organizationId: string | null = null
  let instanceId: string | null = null

  const lastOrg = profile.last_organization_id as string | null
  const lastInst = profile.last_instance_id as string | null

  if (lastOrg && organizations.some((o) => o.id === lastOrg)) {
    organizationId = lastOrg
  } else if (organizations.length === 1) {
    organizationId = organizations[0].id
  }

  if (organizationId) {
    const orgInstances = instances.filter((i) => i.organizationId === organizationId)
    if (lastInst && orgInstances.some((i) => i.id === lastInst)) {
      instanceId = lastInst
    } else if (orgInstances.length === 1) {
      instanceId = orgInstances[0].id
    }
  }

  const orgRole =
    organizations.find((o) => o.id === organizationId)?.role
    ?? (organizations[0]?.role ?? null)

  return {
    organizations,
    instances,
    organizationId,
    instanceId,
    orgRole,
    isPlatformAdmin,
  }
}

export async function persistLastTenant(userId: string, organizationId: string, instanceId: string) {
  await supabase
    .from('users')
    .update({
      last_organization_id: organizationId,
      last_instance_id: instanceId,
    })
    .eq('id', userId)
}

export async function switchOrganization(userId: string, organizationId: string) {
  const store = useTenantStore.getState()
  const orgInstances = store.instances.filter((i) => i.organizationId === organizationId && i.active)
  let instanceId: string | null = null
  if (orgInstances.length === 1) instanceId = orgInstances[0].id

  store.setActiveOrganizationId(organizationId)
  store.setActiveInstanceId(instanceId)

  const org = store.organizations.find((o) => o.id === organizationId)
  if (instanceId) {
    await persistLastTenant(userId, organizationId, instanceId)
  }
  return { organizationId, instanceId, orgRole: org?.role ?? null }
}

export async function switchInstance(userId: string, instanceId: string) {
  const store = useTenantStore.getState()
  const inst = store.instances.find((i) => i.id === instanceId)
  if (!inst) return null

  store.setActiveOrganizationId(inst.organizationId)
  store.setActiveInstanceId(instanceId)
  await persistLastTenant(userId, inst.organizationId, instanceId)
  const org = store.organizations.find((o) => o.id === inst.organizationId)
  return { organizationId: inst.organizationId, instanceId, orgRole: org?.role ?? null }
}

export async function reloadInstancesForOrgs(orgIds: string[]) {
  if (!orgIds.length) {
    useTenantStore.getState().setInstances([])
    return
  }
  const { data: instRows } = await supabase
    .from('instances')
    .select('*')
    .in('organization_id', orgIds)
    .eq('active', true)
    .order('name')
  useTenantStore
    .getState()
    .setInstances((instRows ?? []).map((r) => fromInstanceRow(r as Record<string, unknown>)))
}

export type TenantScope = { organizationId: string; instanceId: string }

export function requireTenantScope(): TenantScope | null {
  const { activeOrganizationId, activeInstanceId } = useTenantStore.getState()
  if (!activeOrganizationId || !activeInstanceId) return null
  return { organizationId: activeOrganizationId, instanceId: activeInstanceId }
}
