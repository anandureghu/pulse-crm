import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'

interface AuthState {
  user: User | null
  role: 'admin' | 'sales' | null
  /** null = still checking profile; true = invited member; false = signed out / uninvited */
  member: boolean | null
  loading: boolean
  setUser: (user: User | null) => void
  setRole: (role: 'admin' | 'sales' | null) => void
  setMember: (member: boolean | null) => void
  setLoading: (loading: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  role: null,
  member: null,
  loading: true,
  setUser: (user) => set({ user }),
  setRole: (role) => set({ role }),
  setMember: (member) => set({ member }),
  setLoading: (loading) => set({ loading }),
}))
