import { useEffect, useState } from 'react'
import { subscribeToCustomers } from '../lib/db'
import type { Customer } from '../types'

export function useCustomers() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = subscribeToCustomers((data) => {
      setCustomers(data)
      setLoading(false)
    })
    return unsub
  }, [])

  return { customers, loading }
}
