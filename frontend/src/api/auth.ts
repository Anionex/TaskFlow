import { api } from './client'

export const authApi = {
  register: (phone: string, password: string) =>
    api.post('/register', { phone, password }),

  login: (phone: string, password: string) =>
    api.post<string>('/login', { phone, password }),

  logout: () => api.post('/logout'),

  checkSession: () => api.get<string>('/session'),
}
