import { create } from 'zustand'
import { categoriesApi } from '@/api/tasks'
import { mergeCategories } from '@/lib/categories'

export type Theme = 'light' | 'sepia' | 'dark'

/** 从「今日」一键去「习惯」创建时携带的预填数据（Issue #12.4）。 */
export interface HabitPrefill {
  title: string
  description?: string
  category?: string
  star_rating?: number
}

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

  // 分类（默认 5 类 ∪ 用户已用过的分类），跨页共享（Issue #9）。
  categories: string[]
  refreshCategories: () => Promise<void>

  // 跨页导航意图 + 习惯预填（Issue #12.4）。AppPage 订阅 navTarget 切换页面。
  navTarget: string | null
  navigateTo: (section: string) => void
  consumeNav: () => void
  habitPrefill: HabitPrefill | null
  setHabitPrefill: (h: HabitPrefill | null) => void
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

  categories: mergeCategories([]),
  refreshCategories: async () => {
    const res = await categoriesApi.list()
    if (res.success && res.data) {
      set({ categories: mergeCategories(res.data.items ?? []) })
    }
  },

  navTarget: null,
  navigateTo: (section) => set({ navTarget: section }),
  consumeNav: () => set({ navTarget: null }),
  habitPrefill: null,
  setHabitPrefill: (h) => set({ habitPrefill: h }),
}))

// Apply saved theme on load
const savedTheme = (saved('theme') as Theme) ?? 'light'
document.documentElement.setAttribute('data-theme', savedTheme)
