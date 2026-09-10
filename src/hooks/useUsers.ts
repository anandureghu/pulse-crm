import { useEffect, useState } from 'react'
import { getUsers } from '../lib/db'
import { useTenantStore } from '../store/tenantStore'

export interface AppUser {
  id: string
  email: string
  username: string | null
  role: string
}

export function useUsers() {
  const organizationId = useTenantStore((s) => s.activeOrganizationId)
  const [users, setUsers] = useState<AppUser[]>([])

  useEffect(() => {
    if (!organizationId) {
      setUsers([])
      return
    }
    getUsers(organizationId).then(setUsers)
  }, [organizationId])

  return users
}
