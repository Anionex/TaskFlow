export type Category = '学习' | '工作' | '生活' | '家庭' | '其他'
export type SortBy = 'created' | 'deadline' | 'star'
export type Tone = '温暖鼓励型' | '冷静督促型' | '简短效率型'
export type Frequency = 'daily' | 'weekly' | 'monthly'

export interface Task {
  id: string
  user_id: string
  parent_id: string | null
  title: string
  description: string
  completed: boolean
  category: Category
  star_rating: number
  sort_order: number
  start_date: string | null
  deadline: string | null
  deleted_at: string | null
  created_at: string
  completed_at: string | null
  // virtual: added by backend for task groups
  subtask_total?: number
  subtask_completed?: number
  subtasks?: Task[]
}

export interface TaskListResponse {
  items: Task[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

export interface TaskGroupPayload {
  parent: Partial<Task>
  subtasks: Array<{ title: string; sort_order: number; star_rating?: number }>
}

export interface ParsedTask {
  title: string
  description: string
  category: Category
  star_rating: number
  start_date: string | null
  deadline: string | null
  suggestion: string | null
}

export interface BraindumpResult {
  items: ParsedTask[]
}

export interface RewriteResult {
  actionable: boolean
  suggested_title: string
  reason: string
}

export interface DecomposeResult {
  is_big_task: boolean
  parent: { title: string; category: Category }
  subtasks: Array<{ title: string; sort_order: number; star_rating?: number }>
}

export interface SearchResult {
  items: Task[]
  explanation?: string
}

export interface MorningResult {
  recommendations: Array<{ task_id: string; title: string; reason: string }>
}

export interface EveningResult {
  summary: string
}

// ── Agent 模式 ──────────────────────────────────────────────────────────────

/** OpenAI 格式的对话历史条目，前端视为不透明令牌，原样回传后端。 */
export type AgentMessage = Record<string, unknown>

/** 本轮内发生的一步（工具调用或思考），默认折叠展示。 */
export interface AgentStep {
  kind: 'tool' | 'thinking'
  name?: string
  args?: unknown
  ok?: boolean
  result?: unknown
  text?: string
}

/** 待用户确认的写操作。 */
export interface AgentPending {
  tool_call_id: string
  tool: 'create_task' | 'update_task' | 'delete_task'
  summary: string
  preview: {
    action: 'create' | 'update' | 'delete'
    args: Record<string, unknown>
    current?: Record<string, unknown> | null
  }
}

export interface AgentTurn {
  messages: AgentMessage[]
  steps: AgentStep[]
  reply: string | null
  pending: AgentPending | null
}

export interface AgentDecision {
  tool_call_id: string
  approved: boolean
  note?: string
}

export interface UserProfile {
  phone: string
  summary_tone: Tone
}

export interface UserStats {
  total: number
  completed: number
  pending: number
  expired: number
  monthly_completed: [string, number][]
  // 近 54 周每日完成量（稀疏：仅含有完成记录的日期）
  daily_completed?: [string, number][]
}

export interface UserSettings {
  summary_tone: Tone
  // 大模型设置：账户级持久化，跨设备同步（空字符串=走服务端默认）
  llm_api_key?: string
  llm_model?: string
  llm_base_url?: string
}

export interface Template {
  id: string
  user_id: string
  title: string
  description: string
  category: Category
  star_rating: number
  frequency: Frequency
  generate_day: number
  generate_time: string
  deadline_day: number
  deadline_time: string
  last_generated: string | null
  created_at: string
}

export interface CheckinStatus {
  last_checkin_date: string | null
  current_streak: number
  max_streak: number
  today_checked: boolean
}
