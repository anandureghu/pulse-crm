import { useEffect, useRef } from 'react'
import { useAuthStore } from '../store/authStore'
import { useTenantStore } from '../store/tenantStore'
import { applyTenantContext, useTenantContextQuery } from '../hooks/useTenantContext'

/** Keeps Zustand tenant state in sync with the React Query tenant context cache. */
export default function TenantSync() {
  const user = useAuthStore((s) => s.user)
  const member = useAuthStore((s) => s.member)
  const setLoading = useAuthStore((s) => s.setLoading)
  const setIsPlatformAdmin = useAuthStore((s) => s.setIsPlatformAdmin)
  const setReady = useTenantStore((s) => s.setReady)
  const hydrated = useRef(false)

  const { data, isError, isFetched } = useTenantContextQuery(member ? user?.id : undefined)

  useEffect(() => {
    if (!member || !user || !data) return

    applyTenantContext(data, { preserveSelection: hydrated.current })
    setIsPlatformAdmin(data.isPlatformAdmin)
    hydrated.current = true
    setLoading(false)
  }, [member, user, data, setIsPlatformAdmin, setLoading])

  useEffect(() => {
    if (!member || !isFetched) return
    if (isError) {
      setReady(true)
      setLoading(false)
    }
  }, [member, isFetched, isError, setReady, setLoading])

  return null
}
