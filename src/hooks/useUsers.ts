import { useEffect, useState } from 'react'
import { getUsers } from '../lib/db'

export interface AppUser {
  id: string
  email: string
  username: string | null
  role: string
}

export function useUsers() {
  const [users, setUsers] = useState<AppUser[]>([])

  useEffect(() => {
    getUsers().then(setUsers)
  }, [])

  return users
}
