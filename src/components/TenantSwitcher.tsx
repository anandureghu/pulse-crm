import { useId } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAuthStore } from '../store/authStore'
import { useTenantStore, selectOrgInstances } from '../store/tenantStore'
import { switchInstance, switchOrganization } from '../lib/tenant'

export default function TenantSwitcher() {
  const uid = useId()
  const orgSelectId = `${uid}-org`
  const instanceSelectId = `${uid}-instance`
  const user = useAuthStore((s) => s.user)
  const setRole = useAuthStore((s) => s.setRole)
  const organizations = useTenantStore((s) => s.organizations)
  const activeOrganizationId = useTenantStore((s) => s.activeOrganizationId)
  const activeInstanceId = useTenantStore((s) => s.activeInstanceId)
  const orgInstances = useTenantStore(useShallow(selectOrgInstances))

  const onOrgChange = async (orgId: string) => {
    if (!user || !orgId) return
    const result = await switchOrganization(user.id, orgId)
    if (result?.orgRole) setRole(result.orgRole)
  }

  const onInstanceChange = async (instanceId: string) => {
    if (!user || !instanceId) return
    const result = await switchInstance(user.id, instanceId)
    if (result?.orgRole) setRole(result.orgRole)
  }

  if (!organizations.length) {
    return (
      <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        No organization membership. Ask a platform admin to add you.
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1 min-w-0">
        <label htmlFor={orgSelectId} className="text-[10px] font-medium text-gray-500 leading-none">
          Organization
        </label>
        <select
          id={orgSelectId}
          value={activeOrganizationId ?? ''}
          onChange={(e) => onOrgChange(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 max-w-[140px] w-full"
        >
          {!activeOrganizationId && <option value="">Select organization…</option>}
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1 min-w-0">
        <label htmlFor={instanceSelectId} className="text-[10px] font-medium text-gray-500 leading-none">
          WhatsApp instance
        </label>
        <select
          id={instanceSelectId}
          value={activeInstanceId ?? ''}
          onChange={(e) => onInstanceChange(e.target.value)}
          disabled={!activeOrganizationId || orgInstances.length === 0}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 max-w-[160px] w-full disabled:opacity-50"
        >
          {!activeInstanceId && <option value="">Select instance…</option>}
          {orgInstances.map((i) => (
            <option key={i.id} value={i.id}>{i.name}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
