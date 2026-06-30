import { api } from './client'
import type { CheckinStatus } from '../types'

export const checkinApi = {
  status: () => api.get<CheckinStatus>('/checkin/status'),
  checkin: () => api.post<{ current_streak: number; max_streak: number }>('/checkin'),
}
