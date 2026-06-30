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
