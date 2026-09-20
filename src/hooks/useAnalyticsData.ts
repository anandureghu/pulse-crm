import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useTenantStore } from '../store/tenantStore'
import type { PaymentRow, ActivityRow } from '../lib/analytics'

export function usePayments() {
  const organizationId = useTenantStore((s) => s.activeOrganizationId)
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!organizationId) {
      setPayments([])
      setLoading(false)
      return
    }

    const fetch = () =>
      supabase
        .from('payments')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .then(({ data }) => {
          setPayments(
            (data ?? []).map((r) => ({
              id: r.id as string,
              customerId: r.customer_id as string,
              amount: Number(r.amount) || 0,
              currency: (r.currency as string) || 'INR',
              method: (r.method as string) || '',
              status: (r.status as string) || 'pending',
              recordedBy: (r.recorded_by as string) || '',
              createdAt: (r.created_at as string) || '',
            }))
          )
          setLoading(false)
        })

    fetch()
    const channel = supabase
      .channel(`analytics-payments:${organizationId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, fetch)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [organizationId])

  return { payments, loading }
}

export function useRecentActivities(limit = 1500) {
  const organizationId = useTenantStore((s) => s.activeOrganizationId)
  const [activities, setActivities] = useState<ActivityRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!organizationId) {
      setActivities([])
      setLoading(false)
      return
    }
    supabase
      .from('activities')
      .select('id, enquiry_id, type, description, created_at')
      .eq('organization_id', organizationId)
      .eq('type', 'status_changed')
      .order('created_at', { ascending: false })
      .limit(limit)
      .then(({ data }) => {
        setActivities(
          (data ?? []).map((r) => ({
            id: r.id as string,
            enquiryId: r.enquiry_id as string,
            type: r.type as string,
            description: r.description as string,
            createdAt: r.created_at as string,
          }))
        )
        setLoading(false)
      })
  }, [limit, organizationId])

  return { activities, loading }
}
