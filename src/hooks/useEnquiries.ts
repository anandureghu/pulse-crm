import { useEffect, useState } from 'react'
import { subscribeToEnquiries, subscribeToEnquiriesByCustomer } from '../lib/db'
import type { Enquiry } from '../types'

export function useEnquiries() {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = subscribeToEnquiries((data) => {
      setEnquiries(data)
      setLoading(false)
    })
    return unsub
  }, [])

  return { enquiries, loading }
}

export function useEnquiriesByCustomer(customerId: string) {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([])

  useEffect(() => {
    if (!customerId) return
    const unsub = subscribeToEnquiriesByCustomer(customerId, setEnquiries)
    return unsub
  }, [customerId])

  return enquiries
}
