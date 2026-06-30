import { api } from './client'
import type { Template } from '../types'

export const templatesApi = {
  list: () => api.get<Template[]>('/templates'),
  create: (t: Partial<Template>) => api.post<Template>('/templates', t),
  update: (id: string, t: Partial<Template>) => api.put<Template>(`/templates/${id}`, t),
  delete: (id: string) => api.delete(`/templates/${id}`),
  // Backend immediately generates tasks from all templates and returns a count.
  generate: () => api.post<{ count: number } | number>('/templates/generate'),
}
