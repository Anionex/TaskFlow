import { create } from 'zustand'

export type Theme = 'light' | 'sepia' | 'dark'

interface AppStore {
  theme: Theme
  setTheme: (t: Theme) => void

  sessionId: string | null
  phone: string | null
  setSession: (id: string, phone: string) => void
  clearSession: () => void

  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

export interface Toast {
  id: string
  type: 'success' | 'error' | 'info'
  message: string
}

const saved = (k: string) => localStorage.getItem(k)

export const useAppStore = create<AppStore>((set, get) => ({
  theme: (saved('theme') as Theme) ?? 'light',
  setTheme: (theme) => {
    localStorage.setItem('theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  },

  sessionId: saved('session_id'),
  phone: saved('phone'),
  setSession: (id, phone) => {
    localStorage.setItem('session_id', id)
    localStorage.setItem('phone', phone)
    set({ sessionId: id, phone })
  },
  clearSession: () => {
    localStorage.removeItem('session_id')
    localStorage.removeItem('phone')
    set({ sessionId: null, phone: null })
  },

  toasts: [],
  addToast: (toast) => {
    const id = Math.random().toString(36).slice(2)
    const full = { ...toast, id }
    set((s) => ({ toasts: [...s.toasts, full] }))
    setTimeout(() => get().removeToast(id), 4000)
  },
  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

// Apply saved theme on load
const savedTheme = (saved('theme') as Theme) ?? 'light'
document.documentElement.setAttribute('data-theme', savedTheme)
