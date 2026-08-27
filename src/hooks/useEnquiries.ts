import { useEffect, useState } from 'react'
import { subscribeToEnquiries, subscribeToEnquiriesByCustomer } from '../lib/db'
import { useTenantStore } from '../store/tenantStore'
import type { Enquiry } from '../types'

export function useEnquiries() {
  const organizationId = useTenantStore((s) => s.activeOrganizationId)
  const instanceId = useTenantStore((s) => s.activeInstanceId)
  const [enquiries, setEnquiries] = useState<Enquiry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!organizationId || !instanceId) {
      setEnquiries([])
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = subscribeToEnquiries({ organizationId, instanceId }, (data) => {
      setEnquiries(data)
      setLoading(false)
    })
    return unsub
  }, [organizationId, instanceId])

  return { enquiries, loading }
}

export function useEnquiriesByCustomer(customerId: string) {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!customerId) {
      setEnquiries([])
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = subscribeToEnquiriesByCustomer(customerId, (data) => {
      setEnquiries(data)
      setLoading(false)
    })
    return unsub
  }, [customerId])

  return { enquiries, loading }
}
