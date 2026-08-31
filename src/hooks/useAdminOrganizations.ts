import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/authStore'
import { adminKeys, tenantKeys } from '../lib/queryKeys'
import {
  fetchAdminOrganizations,
  invokeManageOrg,
  type AdminOrgRow,
} from '../lib/manageOrg'

export function useAdminOrganizations() {
  return useQuery({
    queryKey: adminKeys.organizations(),
    queryFn: fetchAdminOrganizations,
  })
}

export function useCreateOrganization() {
  const queryClient = useQueryClient()
  const userId = useAuthStore((s) => s.user?.id)

  return useMutation({
    mutationFn: (input: { name: string; slug?: string; adminEmail: string }) =>
      invokeManageOrg({
        action: 'create',
        name: input.name,
        slug: input.slug,
        adminEmail: input.adminEmail,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.organizations() })
      if (userId) {
        queryClient.invalidateQueries({ queryKey: tenantKeys.context(userId) })
      }
    },
  })
}

export function useSetOrganizationActive() {
  const queryClient = useQueryClient()
  const userId = useAuthStore((s) => s.user?.id)

  return useMutation({
    mutationFn: (input: { organizationId: string; active: boolean }) =>
      invokeManageOrg({
        action: 'set_active',
        organizationId: input.organizationId,
        active: input.active,
      }),
    onMutate: async ({ organizationId, active }) => {
      await queryClient.cancelQueries({ queryKey: adminKeys.organizations() })
      const previous = queryClient.getQueryData<AdminOrgRow[]>(adminKeys.organizations())
      queryClient.setQueryData<AdminOrgRow[]>(adminKeys.organizations(), (old) =>
        old?.map((org) => (org.id === organizationId ? { ...org, active } : org)),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(adminKeys.organizations(), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.organizations() })
      if (userId) {
        queryClient.invalidateQueries({ queryKey: tenantKeys.context(userId) })
      }
    },
  })
}
