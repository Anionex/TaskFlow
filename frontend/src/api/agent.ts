import { api } from './client'
import type { AgentMessage, AgentTurn, AgentDecision } from '../types'

interface AgentPayload {
  messages: AgentMessage[]
  user_input?: string
  decision?: AgentDecision
}

export const agentApi = {
  // 走 LLM 头（自带 key/模型/base url）。messages 为前端持有的不透明对话历史。
  chat: (payload: AgentPayload) =>
    api.postAi<AgentTurn>('/ai/agent', payload),
}
