import { api } from './client'
import type { Task } from '../types'

export const recycleApi = {
  list: () => api.get<Task[]>('/recycle'),
  restore: (id: string) => api.post(`/recycle/${id}/restore`),
  deletePermanent: (id: string) => api.delete(`/recycle/${id}`),
  clearAll: () => api.delete('/recycle'),
}
