import { api } from './client'
import type { Task, TaskListResponse, TaskGroupPayload } from '../types'

export const tasksApi = {
  list: (params: {
    sort_by?: string
    category?: string
    search?: string
    page?: number
    per_page?: number
    status?: string
  } = {}) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') qs.append(k, String(v))
    }
    const q = qs.toString()
    return api.get<TaskListResponse>(`/tasks${q ? '?' + q : ''}`)
  },

  create: (task: Partial<Task>) => api.post<Task>('/tasks', task),

  update: (id: string, changes: Partial<Task>) =>
    api.put<Task>(`/tasks/${id}`, changes),

  delete: (id: string) => api.delete(`/tasks/${id}`),

  toggle: (id: string) => api.post(`/tasks/${id}/toggle`),

  batchDelete: (taskIds: string[]) =>
    api.post('/tasks/batch-delete', { task_ids: taskIds }),

  clear: (status: 'pending' | 'completed' | 'expired') =>
    api.delete(`/tasks/clear?status=${status}`),

  createGroup: (payload: TaskGroupPayload) =>
    api.post<{ parent_id: string }>('/tasks/group', payload),
}
