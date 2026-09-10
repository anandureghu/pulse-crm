import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/authStore'
import { useTenantStore } from '../store/tenantStore'
import { loadTenantContext } from '../lib/tenant'
import { tenantKeys } from '../lib/queryKeys'

export function applyTenantContext(
  tenant: Awaited<ReturnType<typeof loadTenantContext>>,
  options?: { preserveSelection?: boolean },
) {
  const store = useTenantStore.getState()
  store.setOrganizations(tenant.organizations)
  store.setInstances(tenant.instances)

  if (!options?.preserveSelection) {
    store.setActiveOrganizationId(tenant.organizationId)
    store.setActiveInstanceId(tenant.instanceId)
    useAuthStore.getState().setRole(tenant.orgRole)
    store.setReady(true)
    return
  }

  const { activeOrganizationId, activeInstanceId } = store
  const activeOrgStillValid = tenant.organizations.some((o) => o.id === activeOrganizationId)

  if (!activeOrgStillValid) {
    store.setActiveOrganizationId(tenant.organizationId)
    store.setActiveInstanceId(tenant.instanceId)
  } else if (activeOrganizationId) {
    const activeInstStillValid = tenant.instances.some((i) => i.id === activeInstanceId)
    if (!activeInstStillValid) {
      const orgInstances = tenant.instances.filter((i) => i.organizationId === activeOrganizationId)
      store.setActiveInstanceId(orgInstances.length === 1 ? orgInstances[0].id : null)
    }
  }

  const org = tenant.organizations.find((o) => o.id === store.activeOrganizationId)
  if (org) useAuthStore.getState().setRole(org.role)

  store.setReady(true)
}

export function useTenantContextQuery(userId: string | undefined) {
  return useQuery({
    queryKey: tenantKeys.context(userId!),
    queryFn: () => loadTenantContext(userId!),
    enabled: Boolean(userId),
  })
}

export function useInvalidateTenantContext() {
  const queryClient = useQueryClient()
  return (userId: string) =>
    queryClient.invalidateQueries({ queryKey: tenantKeys.context(userId) })
}
