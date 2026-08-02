import { create } from 'zustand'

interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

interface ToastStore {
  toasts: ToastItem[]
  push: (message: string, type: ToastItem['type']) => void
  dismiss: (id: number) => void
}

let _id = 0

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push(message, type) {
    const id = ++_id
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000)
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))

export function toast(message: string, type: ToastItem['type'] = 'info') {
  useToastStore.getState().push(message, type)
}

export function Toaster() {
  const { toasts, dismiss } = useToastStore()
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm text-white cursor-pointer pointer-events-auto max-w-sm ${
            t.type === 'error'
              ? 'bg-red-500'
              : t.type === 'success'
              ? 'bg-green-600'
              : 'bg-gray-700'
          }`}
        >
          <span className="flex-1">{t.message}</span>
          <span className="text-xs opacity-60">×</span>
        </div>
      ))}
    </div>
  )
}
