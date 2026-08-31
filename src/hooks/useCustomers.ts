import { useEffect, useState } from 'react'
import { subscribeToCustomers } from '../lib/db'
import { useTenantStore } from '../store/tenantStore'
import type { Customer } from '../types'

export function useCustomers() {
  const organizationId = useTenantStore((s) => s.activeOrganizationId)
  const instanceId = useTenantStore((s) => s.activeInstanceId)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!organizationId || !instanceId) {
      setCustomers([])
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = subscribeToCustomers({ organizationId, instanceId }, (data) => {
      setCustomers(data)
      setLoading(false)
    })
    return unsub
  }, [organizationId, instanceId])

  return { customers, loading }
}
