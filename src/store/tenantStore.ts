import { create } from 'zustand'

export interface TenantOrg {
  id: string
  name: string
  slug: string
  active: boolean
  role: 'admin' | 'sales'
}

export interface TenantInstance {
  id: string
  organizationId: string
  name: string
  evolutionInstanceName: string | null
  settings: Record<string, unknown>
  active: boolean
}

interface TenantState {
  organizations: TenantOrg[]
  instances: TenantInstance[]
  activeOrganizationId: string | null
  activeInstanceId: string | null
  ready: boolean
  setOrganizations: (orgs: TenantOrg[]) => void
  setInstances: (instances: TenantInstance[]) => void
  setActiveOrganizationId: (id: string | null) => void
  setActiveInstanceId: (id: string | null) => void
  setReady: (ready: boolean) => void
  reset: () => void
}

const empty = {
  organizations: [] as TenantOrg[],
  instances: [] as TenantInstance[],
  activeOrganizationId: null as string | null,
  activeInstanceId: null as string | null,
  ready: false,
}

export const useTenantStore = create<TenantState>((set) => ({
  ...empty,
  setOrganizations: (organizations) => set({ organizations }),
  setInstances: (instances) => set({ instances }),
  setActiveOrganizationId: (activeOrganizationId) => set({ activeOrganizationId }),
  setActiveInstanceId: (activeInstanceId) => set({ activeInstanceId }),
  setReady: (ready) => set({ ready }),
  reset: () => set({ ...empty }),
}))

export function selectActiveOrg(state: TenantState): TenantOrg | null {
  return state.organizations.find((o) => o.id === state.activeOrganizationId) ?? null
}

export function selectActiveInstance(state: TenantState): TenantInstance | null {
  return state.instances.find((i) => i.id === state.activeInstanceId) ?? null
}

export function selectOrgInstances(state: TenantState): TenantInstance[] {
  if (!state.activeOrganizationId) return []
  return state.instances.filter((i) => i.organizationId === state.activeOrganizationId && i.active)
}
