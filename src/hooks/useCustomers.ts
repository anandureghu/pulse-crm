import { useEffect, useState } from 'react'
import { subscribeToCustomers } from '../lib/db'
import { useTenantStore } from '../store/tenantStore'
import type { Customer } from '../types'

export function useCustomers() {
  const organizationId = useTenantStore((s) => s.activeOrganizationId)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!organizationId) {
      setCustomers([])
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = subscribeToCustomers({ organizationId }, (data) => {
      setCustomers(data)
      setLoading(false)
    })
    return unsub
  }, [organizationId])

  return { customers, loading }
}
