import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'

interface AuthState {
  user: User | null
  role: 'admin' | 'sales' | null
  isPlatformAdmin: boolean
  /** null = still checking profile; true = invited member; false = signed out / uninvited */
  member: boolean | null
  loading: boolean
  setUser: (user: User | null) => void
  setRole: (role: 'admin' | 'sales' | null) => void
  setIsPlatformAdmin: (v: boolean) => void
  setMember: (member: boolean | null) => void
  setLoading: (loading: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  role: null,
  isPlatformAdmin: false,
  member: null,
  loading: true,
  setUser: (user) => set({ user }),
  setRole: (role) => set({ role }),
  setIsPlatformAdmin: (isPlatformAdmin) => set({ isPlatformAdmin }),
  setMember: (member) => set({ member }),
  setLoading: (loading) => set({ loading }),
}))
