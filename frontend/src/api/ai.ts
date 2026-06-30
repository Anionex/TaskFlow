import { api } from './client'
import type { ParsedTask, BraindumpResult, RewriteResult, DecomposeResult, SearchResult, MorningResult, EveningResult } from '../types'

export const aiApi = {
  parse: (text: string) =>
    api.postAi<ParsedTask>('/ai/parse', { text }),

  braindump: (text: string) =>
    api.postAi<BraindumpResult>('/ai/braindump', { text }),

  rewrite: (title: string, description: string) =>
    api.postAi<RewriteResult>('/ai/rewrite', { title, description }),

  decompose: (title: string, description: string) =>
    api.postAi<DecomposeResult>('/ai/decompose', { title, description }),

  search: (query: string) =>
    api.postAi<SearchResult>('/ai/search', { query }),

  morning: () => api.getAi<MorningResult>('/ai/morning'),

  evening: () => api.getAi<EveningResult>('/ai/evening'),
}
