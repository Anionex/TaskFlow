import { api } from './client'
import type { UserProfile, UserStats, UserSettings } from '../types'

export const userApi = {
  profile: () => api.get<UserProfile>('/user/profile'),

  changePassword: (oldPassword: string, newPassword: string) =>
    api.put('/user/password', { old_password: oldPassword, new_password: newPassword }),

  stats: () => api.get<UserStats>('/user/stats'),

  getSettings: () => api.get<UserSettings>('/user/settings'),

  updateSettings: (settings: Partial<UserSettings>) =>
    api.put('/user/settings', settings),
}
