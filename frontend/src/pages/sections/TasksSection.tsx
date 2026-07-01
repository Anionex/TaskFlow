import { useState, useEffect, useCallback } from 'react'
import {
  ChevronDown, ChevronRight, Plus, Trash2, CheckSquare, Square,
  Edit2, Sparkles, X
} from 'lucide-react'
import { StarRating } from '@/components/ui/StarRating'
import { Spinner } from '@/components/ui/Spinner'
import { Modal, ModalFooter } from '@/components/ui/Modal'
import { confirm } from '@/components/ui/ConfirmDialog'
import { PageContainer } from '@/components/layout/PageContainer'
import { TaskForm, emptyDraft } from '@/components/task/TaskForm'
import { tasksApi } from '@/api/tasks'
import { aiApi } from '@/api/ai'
import { useAppStore } from '@/store'
import type { Task, Category, SortBy, DecomposeResult } from '@/types'
const STATUS_TABS = [
  { id: 'pending', label: '待办' },
  // 未完成 = 待办 + 已过期 合并，后端按 completed=false 过滤
  { id: 'incomplete', label: '未完成' },
  { id: 'completed', label: '已完成' },
  { id: 'expired', label: '已过期' },
] as const

type StatusTab = typeof STATUS_TABS[number]['id']

function formatDate(d: string | null | undefined) {
  if (!d) return ''
  return d.slice(0, 10)
}

function isOverdue(task: Task) {
  if (!task.deadline || task.completed) return false
  return new Date(task.deadline) < new Date()
}

// 乐观翻转某任务的完成态：命中顶层任务直接翻转；命中子任务则翻转并同步父任务进度计数。
function flipCompleted(list: Task[], id: string): Task[] {
  return list.map((t) => {
    if (t.id === id) return { ...t, completed: !t.completed }
    if (t.subtasks?.some((s) => s.id === id)) {
      const subtasks = t.subtasks.map((s) =>
        s.id === id ? { ...s, completed: !s.completed } : s
      )
      return { ...t, subtasks, subtask_completed: subtasks.filter((s) => s.completed).length }
    }
    return t
  })
}

function CategoryPill({ cat }: { cat: Category }) {
  return (
    <span style={{
      fontSize: 'var(--text-2xs)',
      color: 'var(--text-muted)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-pill)',
      padding: '1px 7px',
    }}>
      {cat}
    </span>
  )
}

function ProgressMeter({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
      <div style={{ flex: 1, height: 3, background: 'var(--border-strong)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: 2 }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        {done}/{total}
      </span>
    </div>
  )
}

export function TasksSection() {
  const { addToast } = useAppStore()
  const [tab, setTab] = useState<StatusTab>('pending')
  // 当前状态标签（待办/已完成/已过期），供清空确认与按钮文案复用。
  const statusLabel = STATUS_TABS.find((t) => t.id === tab)!.label
  const [category, setCategory] = useState<Category | ''>('')
  const [sortBy, setSortBy] = useState<SortBy>('created')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchMode, setSearchMode] = useState<'exact' | 'semantic'>('exact')
  const [semanticActive, setSemanticActive] = useState(false)
  const [semanticLoading, setSemanticLoading] = useState(false)
  const [semanticResults, setSemanticResults] = useState<Task[]>([])
  const [semanticExplanation, setSemanticExplanation] = useState<string | undefined>(undefined)
  const [committedQuery, setCommittedQuery] = useState('')
  const [page, setPage] = useState(1)
  const [tasks, setTasks] = useState<Task[]>([])
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  // Batch selection
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)
  // 多选模式：关闭时行点击进入编辑，选择框隐藏；开启时行点击切换选中，显示批量工具栏
  const [selectMode, setSelectMode] = useState(false)

  // Collapse state for task groups
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  // Modals
  const [showCreate, setShowCreate] = useState(false)
  const [createDraft, setCreateDraft] = useState(emptyDraft())
  const [createLoading, setCreateLoading] = useState(false)

  const [editTask, setEditTask] = useState<Task | null>(null)
  const [editDraft, setEditDraft] = useState(emptyDraft())

  // 改写建议：现由编辑卡内触发，作用于 editTask，结果内联显示在编辑卡中
  const [rewriteLoading, setRewriteLoading] = useState(false)
  const [rewriteResult, setRewriteResult] = useState<{ actionable: boolean; suggested_title: string; reason: string } | null>(null)

  const [decomposeTask, setDecomposeTask] = useState<Task | null>(null)
  const [decomposeLoading, setDecomposeLoading] = useState(false)
  const [decomposeResult, setDecomposeResult] = useState<DecomposeResult | null>(null)
  const [decomposeConfirming, setDecomposeConfirming] = useState(false)

  const loadTasks = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    setSelected(new Set())
    try {
      const res = await tasksApi.list({
        status: tab,
        category: category || undefined,
        sort_by: sortBy,
        search: search || undefined,
        page,
        per_page: 20,
      })
      if (res.success && res.data) {
        setTasks(res.data.items)
        setTotalPages(res.data.total_pages)
        setTotal(res.data.total)
      }
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [tab, category, sortBy, search, page])

  // 同步更新普通列表与语义检索结果两处，避免语义模式下操作不生效。
  const patchLists = useCallback((fn: (list: Task[]) => Task[]) => {
    setTasks(fn)
    setSemanticResults(fn)
  }, [])

  useEffect(() => { loadTasks() }, [loadTasks])

  // Search on enter / debounce
  function handleSearchKey(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return
    if (searchMode === 'semantic') {
      runSemanticSearch()
    } else {
      setSearch(searchInput); setPage(1)
    }
  }

  async function runSemanticSearch(queryOverride?: string) {
    const q = (queryOverride ?? searchInput).trim()
    if (!q) { setSemanticActive(false); setSemanticResults([]); setSemanticExplanation(undefined); setCommittedQuery(''); return }
    setCommittedQuery(q)
    setSemanticLoading(true)
    setSemanticActive(true)
    setSelected(new Set())
    try {
      // 把当前筛选选择器（状态 + 分类）作为检索上下文一并传给后端。
      const res = await aiApi.search(q, { status: tab, category: category || undefined })
      if (res.success && res.data) {
        setSemanticResults(res.data.items)
        setSemanticExplanation(res.data.explanation)
      } else {
        setSemanticResults([])
        setSemanticExplanation(undefined)
        addToast({ type: 'error', message: res.message || 'AI 服务暂时不可用' })
      }
    } catch {
      setSemanticResults([])
      setSemanticExplanation(undefined)
      addToast({ type: 'error', message: 'AI 服务暂时不可用' })
    } finally {
      setSemanticLoading(false)
    }
  }

  // 语义模式下，改动状态/分类筛选器时，自动用已提交的查询重新检索（选择器作为检索上下文）。
  useEffect(() => {
    if (searchMode === 'semantic' && committedQuery.trim()) {
      runSemanticSearch(committedQuery)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, category])

  function switchSearchMode(mode: 'exact' | 'semantic') {
    setSearchMode(mode)
    setSelected(new Set())
    if (mode === 'exact') {
      // Restore normal filtered listing
      setSemanticActive(false)
      setSemanticResults([])
      setSemanticExplanation(undefined)
      setCommittedQuery('')
    }
  }

  async function toggleTask(id: string) {
    // 乐观翻转：勾选后留在原地只划线；失败再翻回并提示。
    patchLists((l) => flipCompleted(l, id))
    const res = await tasksApi.toggle(id)
    if (!res.success) {
      patchLists((l) => flipCompleted(l, id))
      addToast({ type: 'error', message: res.message || '操作失败' })
    }
  }

  // 把某任务按原下标插回列表；下标越界（并发下前面的行已变动）时退化为追加，保证行不丢失。
  function insertAt(list: Task[], task: Task, index: number): Task[] {
    if (list.some((t) => t.id === task.id)) return list
    const next = list.slice()
    next.splice(Math.min(index, next.length), 0, task)
    return next
  }

  async function deleteTask(id: string) {
    // 乐观移除该行；失败时只把这一行按原位插回（函数式更新，可与并发操作叠加而不覆写整表）。
    const removedTasks = tasks.find((t) => t.id === id)
    const removedTasksIdx = tasks.findIndex((t) => t.id === id)
    const removedSemantic = semanticResults.find((t) => t.id === id)
    const removedSemanticIdx = semanticResults.findIndex((t) => t.id === id)
    patchLists((l) => l.filter((t) => t.id !== id))
    setTotal((n) => Math.max(0, n - 1))
    const res = await tasksApi.delete(id)
    if (res.success) {
      addToast({ type: 'success', message: '已移至回收站' })
    } else {
      addToast({ type: 'error', message: '删除失败' })
      if (removedTasks) setTasks((prev) => insertAt(prev, removedTasks, removedTasksIdx))
      if (removedSemantic) setSemanticResults((prev) => insertAt(prev, removedSemantic, removedSemanticIdx))
      setTotal((n) => n + 1)
    }
  }

  async function handleBatchDelete() {
    if (selected.size === 0) return
    const ids = Array.from(selected)
    setBatchDeleting(true)
    // 失败时逐条把被删的行按原位插回（函数式更新，与并发操作叠加而不覆写整表）。
    // 记录被删任务及其原下标，升序插回以尽量还原相对顺序。
    const removedTasks = tasks
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => selected.has(t.id))
    const removedSemantic = semanticResults
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => selected.has(t.id))
    patchLists((l) => l.filter((t) => !selected.has(t.id)))
    setTotal((n) => Math.max(0, n - ids.length))
    setSelected(new Set())
    try {
      const res = await tasksApi.batchDelete(ids)
      if (res.success) {
        addToast({ type: 'success', message: `已删除 ${ids.length} 个任务` })
      } else {
        addToast({ type: 'error', message: '删除失败' })
        if (removedTasks.length) {
          setTasks((prev) => removedTasks.reduce((acc, { t, i }) => insertAt(acc, t, i), prev))
        }
        if (removedSemantic.length) {
          setSemanticResults((prev) => removedSemantic.reduce((acc, { t, i }) => insertAt(acc, t, i), prev))
        }
        setTotal((n) => n + ids.length)
      }
    } finally {
      setBatchDeleting(false)
    }
  }

  async function handleClearStatus() {
    // 明确提示：清空的是当前「状态」下的全部任务，而非选中项。
    const ok = await confirm({
      title: '清空任务',
      message: `确认清空「${statusLabel}」下的全部任务？此操作不可撤销`,
      danger: true,
      confirmText: '清空',
    })
    if (!ok) return
    // 整表清空：这里的快照恢复可接受（清空后列表为 []，并发风险低）。
    // 但仍用函数式 setState，并加“仅当列表仍为空时才恢复”的守卫，避免覆盖期间新到的行。
    const snapshotTasks = tasks
    const snapshotSemantic = semanticResults
    const snapshotTotal = total
    patchLists(() => [])
    setTotal(0)
    setSelected(new Set())
    const res = await tasksApi.clear(tab as any)
    if (res.success) {
      addToast({ type: 'success', message: '已清空' })
    } else {
      addToast({ type: 'error', message: '清空失败' })
      setTasks((prev) => (prev.length === 0 ? snapshotTasks : prev))
      setSemanticResults((prev) => (prev.length === 0 ? snapshotSemantic : prev))
      setTotal((n) => (n === 0 ? snapshotTotal : n))
    }
  }

  async function handleCreate() {
    if (!createDraft.title.trim()) return
    setCreateLoading(true)
    try {
      const res = await tasksApi.create({
        title: createDraft.title,
        description: createDraft.description,
        category: createDraft.category,
        star_rating: createDraft.star_rating,
        start_date: createDraft.start_date || undefined,
        deadline: createDraft.deadline || undefined,
      })
      if (res.success) {
        addToast({ type: 'success', message: '任务已创建' })
        setShowCreate(false)
        setCreateDraft(emptyDraft())
        loadTasks({ silent: true })
      } else {
        addToast({ type: 'error', message: res.message })
      }
    } finally {
      setCreateLoading(false)
    }
  }

  function openEdit(task: Task) {
    setEditTask(task)
    setRewriteResult(null)
    setEditDraft({
      title: task.title,
      description: task.description,
      category: task.category,
      star_rating: task.star_rating,
      // 日期按 UTC 截取 ISO 前 10 位回显：create 发送的纯日期由后端按 UTC 零点存储
      // （见 util.rs DateOnlyTz::Utc），这里必须用同一口径截取才能原样往返；
      // 若在此做本地时区换算，负偏移用户会显示成前一天。
      start_date: task.start_date?.slice(0, 10) ?? '',
      deadline: task.deadline?.slice(0, 10) ?? '',
    })
  }

  async function handleEdit() {
    if (!editTask || !editDraft.title.trim()) return
    const id = editTask.id
    // 乐观改本地字段并立即关闭弹窗；失败时只对这一行做逆向 map 还原改动的字段
    //（函数式更新，不覆写整表），成功后按显示的列表校正派生字段
    //（日期归一化、过期态等）。loadTasks 只刷新 tasks，语义模式需重跑检索。
    const prevFields = {
      title: editTask.title,
      description: editTask.description,
      category: editTask.category,
      star_rating: editTask.star_rating,
      start_date: editTask.start_date,
      deadline: editTask.deadline,
    }
    patchLists((l) =>
      l.map((t) =>
        t.id === id
          ? {
              ...t,
              title: editDraft.title,
              description: editDraft.description,
              category: editDraft.category,
              star_rating: editDraft.star_rating,
              start_date: editDraft.start_date || null,
              deadline: editDraft.deadline || null,
            }
          : t
      )
    )
    setEditTask(null)
    const res = await tasksApi.update(id, {
      title: editDraft.title,
      description: editDraft.description,
      category: editDraft.category,
      star_rating: editDraft.star_rating,
      start_date: editDraft.start_date || undefined,
      deadline: editDraft.deadline || undefined,
    })
    if (res.success) {
      addToast({ type: 'success', message: '已更新' })
      if (semanticActive && committedQuery.trim()) runSemanticSearch(committedQuery)
      else loadTasks({ silent: true })
    } else {
      addToast({ type: 'error', message: res.message })
      patchLists((l) => l.map((t) => (t.id === id ? { ...t, ...prevFields } : t)))
    }
  }

  async function handleRewrite() {
    // 作用于当前编辑的任务；改写基于编辑草稿里的标题/描述（用户可能已改动）。
    if (!editTask) return
    setRewriteLoading(true)
    setRewriteResult(null)
    try {
      const res = await aiApi.rewrite(editDraft.title, editDraft.description)
      if (res.success && res.data) setRewriteResult(res.data)
      else addToast({ type: 'error', message: res.message || '改写失败' })
    } catch {
      addToast({ type: 'error', message: 'AI 服务暂时不可用' })
    } finally {
      setRewriteLoading(false)
    }
  }

  // 采纳改写建议：把建议标题写回编辑草稿，让用户在编辑卡内继续确认后保存。
  function applyRewrite() {
    if (!rewriteResult) return
    setEditDraft((d) => ({ ...d, title: rewriteResult.suggested_title }))
    setRewriteResult(null)
  }

  async function handleDecompose() {
    if (!decomposeTask) return
    setDecomposeLoading(true)
    setDecomposeResult(null)
    try {
      const res = await aiApi.decompose(decomposeTask.title, decomposeTask.description)
      if (res.success && res.data) setDecomposeResult(res.data)
      else addToast({ type: 'error', message: res.message || '拆解失败' })
    } catch {
      addToast({ type: 'error', message: 'AI 服务暂时不可用' })
    } finally {
      setDecomposeLoading(false)
    }
  }

  async function confirmDecompose() {
    if (!decomposeResult || !decomposeTask) return
    setDecomposeConfirming(true)
    try {
      const res = await tasksApi.createGroup({
        parent: {
          title: decomposeResult.parent.title,
          category: decomposeResult.parent.category,
          description: decomposeTask.description,
        },
        subtasks: decomposeResult.subtasks,
      })
      if (res.success) {
        addToast({ type: 'success', message: '任务组已创建' })
        setDecomposeTask(null)
        setDecomposeResult(null)
        loadTasks({ silent: true })
      } else {
        addToast({ type: 'error', message: res.message })
      }
    } finally {
      setDecomposeConfirming(false)
    }
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  // 进入/退出多选模式；退出时清空已选，避免残留选择影响批量操作。
  function toggleSelectMode() {
    setSelectMode((on) => {
      if (on) setSelected(new Set())
      return !on
    })
  }

  function toggleCollapse(id: string) {
    setCollapsed((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface-1)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-sm)',
    padding: '6px 10px',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-sm)',
    outline: 'none',
  }

  // Fixed-width slots so the same field type lines up vertically across all rows.
  const CAT_COL = 64
  const STAR_COL = 76
  const DATE_COL = 72
  const ACTIONS_COL = 78

  function renderTaskRow(task: Task) {
    const isGroup = (task.subtask_total ?? 0) > 0
    const isCollapsed = collapsed.has(task.id)
    const overdue = isOverdue(task)
    const isSelected = selected.has(task.id)

    return (
      <div key={task.id}>
        {/* Task row：多选模式下点击行切换选中，否则打开编辑卡 */}
        <div
          onClick={() => (selectMode ? toggleSelect(task.id) : openEdit(task))}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 4px',
            borderBottom: '1px solid var(--border)',
            background: isSelected ? 'var(--accent-soft)' : 'transparent',
            transition: 'background var(--dur-fast)',
            cursor: 'pointer',
          }}
        >
          {/* Complete toggle */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleTask(task.id) }}
            aria-label={task.completed ? '标记未完成' : '标记完成'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: task.completed ? 'var(--success)' : 'var(--border-strong)', display: 'flex', alignItems: 'center', flexShrink: 0 }}
          >
            {task.completed ? <CheckSquare size={16} /> : <Square size={16} />}
          </button>

          {/* Collapse toggle for groups */}
          {isGroup && (
            <button
              onClick={(e) => { e.stopPropagation(); toggleCollapse(task.id) }}
              aria-label={isCollapsed ? '展开' : '收起'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', flexShrink: 0 }}
            >
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          )}

          {/* Title */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 'var(--text-sm)',
              color: task.completed ? 'var(--text-muted)' : 'var(--text-primary)',
              textDecoration: task.completed ? 'line-through' : 'none',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {task.title}
            </div>
            {isGroup && (
              <ProgressMeter done={task.subtask_completed ?? 0} total={task.subtask_total ?? 0} />
            )}
          </div>

          {/* Category */}
          <div style={{ width: CAT_COL, flexShrink: 0, display: 'flex', justifyContent: 'flex-start' }}>
            <CategoryPill cat={task.category} />
          </div>

          {/* Star */}
          <div style={{ width: STAR_COL, flexShrink: 0, display: 'flex', justifyContent: 'flex-start' }}>
            <StarRating value={task.star_rating} readonly size="sm" />
          </div>

          {/* Deadline (always reserve the slot, even when empty) */}
          <div style={{ width: DATE_COL, flexShrink: 0, textAlign: 'right' }}>
            {task.deadline && (
              <span style={{ fontSize: 'var(--text-xs)', color: overdue ? 'var(--danger)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                {formatDate(task.deadline)}
              </span>
            )}
          </div>

          {/* Actions */}
          <div style={{ width: ACTIONS_COL, flexShrink: 0, display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
            <button
              onClick={(e) => { e.stopPropagation(); openEdit(task) }}
              aria-label="编辑"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: '3px' }}
            >
              <Edit2 size={13} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); deleteTask(task.id) }}
              aria-label="删除"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: '3px' }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Subtasks (if group and not collapsed) */}
        {isGroup && !isCollapsed && task.subtasks && task.subtasks.map((sub) => (
          <div
            key={sub.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 4px 8px 44px',
              borderBottom: '1px solid var(--border)',
              borderLeft: '2px solid var(--border)',
              marginLeft: '24px',
            }}
          >
            <button
              onClick={() => toggleTask(sub.id)}
              aria-label={sub.completed ? '标记未完成' : '标记完成'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: sub.completed ? 'var(--success)' : 'var(--border-strong)', display: 'flex', flexShrink: 0 }}
            >
              {sub.completed ? <CheckSquare size={14} /> : <Square size={14} />}
            </button>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)',
              color: 'var(--text-muted)', minWidth: '16px',
            }}>
              {sub.sort_order}.
            </span>
            <span style={{
              fontSize: 'var(--text-sm)', flex: 1,
              color: sub.completed ? 'var(--text-muted)' : 'var(--text-primary)',
              textDecoration: sub.completed ? 'line-through' : 'none',
            }}>
              {sub.title}
            </span>
            {/* Star slot aligned with parent rows */}
            <div style={{ width: STAR_COL, flexShrink: 0, display: 'flex', justifyContent: 'flex-start' }}>
              <StarRating value={sub.star_rating} readonly size="sm" />
            </div>
            {/* Reserve deadline + actions columns so subtask stars line up */}
            <div style={{ width: DATE_COL, flexShrink: 0 }} />
            <div style={{ width: ACTIONS_COL, flexShrink: 0 }} />
          </div>
        ))}
      </div>
    )
  }

  const displayTasks = semanticActive ? semanticResults : tasks
  const listLoading = semanticActive ? semanticLoading : loading

  return (
    <PageContainer>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)' }}>任务</h1>
        <button
          onClick={() => { setShowCreate(true); setCreateDraft(emptyDraft()) }}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            background: 'var(--accent)', border: '1px solid var(--accent)',
            borderRadius: 'var(--radius-pill)', padding: '6px 16px',
            fontSize: 'var(--text-sm)', color: 'var(--on-accent)',
            cursor: 'pointer', fontFamily: 'var(--font-sans)',
          }}
        >
          <Plus size={13} aria-hidden /> 新建任务
        </button>
      </div>

      {/* Tab bar — 始终渲染（避免切换搜索模式时布局跳动）。状态筛选在两种模式下都生效：
          语义模式下它作为检索上下文，限定 AI 只在所选状态范围内匹配。 */}
      <div style={{
        display: 'flex', gap: '0', borderBottom: '1px solid var(--border)', marginBottom: '20px',
      }}>
        {STATUS_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setPage(1); setSelected(new Set()) }}
            style={{
              background: 'none', border: 'none',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              padding: '8px 16px', marginBottom: '-1px',
              fontSize: 'var(--text-sm)',
              color: tab === t.id ? 'var(--accent)' : 'var(--text-secondary)',
              fontWeight: tab === t.id ? 'var(--fw-medium)' : 'var(--fw-regular)',
              cursor: 'pointer', fontFamily: 'var(--font-sans)',
              transition: 'color var(--dur-fast)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters row */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder={searchMode === 'semantic' ? '用自然语言描述你想找的任务…' : '搜索任务…'}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={handleSearchKey}
          onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--ring)' }}
          onBlur={(e) => { e.target.style.borderColor = 'var(--border-strong)'; e.target.style.boxShadow = 'none' }}
          style={{ ...inputStyle, flex: 1, minWidth: 180 }}
        />
        {/* Search mode toggle: 精确 / 语义 */}
        <div style={{ display: 'flex', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', flexShrink: 0 }}>
          {(['exact', 'semantic'] as const).map((m) => (
            <button
              key={m}
              onClick={() => switchSearchMode(m)}
              style={{
                background: searchMode === m ? 'var(--accent)' : 'var(--surface-1)',
                color: searchMode === m ? 'var(--on-accent)' : 'var(--text-muted)',
                border: 'none',
                padding: '6px 12px',
                fontSize: 'var(--text-sm)',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
            >
              {m === 'exact' ? '精确' : '语义'}
            </button>
          ))}
        </div>
        {/* 分类/排序在两种模式都可用；语义模式下分类作为检索上下文限定范围 */}
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value as any); setPage(1) }}
          style={{ ...inputStyle, cursor: 'pointer' }}
          onFocus={(e) => { e.target.style.borderColor = 'var(--accent)' }}
          onBlur={(e) => { e.target.style.borderColor = 'var(--border-strong)' }}
        >
          <option value="">全部分类</option>
          {['学习', '工作', '生活', '家庭', '其他'].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(e) => { setSortBy(e.target.value as SortBy); setPage(1) }}
          style={{ ...inputStyle, cursor: 'pointer' }}
          onFocus={(e) => { e.target.style.borderColor = 'var(--accent)' }}
          onBlur={(e) => { e.target.style.borderColor = 'var(--border-strong)' }}
        >
          <option value="created">按创建时间</option>
          <option value="deadline">按截止日期</option>
          <option value="star">按重要性</option>
        </select>
      </div>

      {/* 多选模式开关：默认点击行进入编辑，需显式进入多选才做批量选择 */}
      <div style={{ display: 'flex', marginBottom: '12px' }}>
        <button
          onClick={toggleSelectMode}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            background: selectMode ? 'var(--accent)' : 'none',
            border: `1px solid ${selectMode ? 'var(--accent)' : 'var(--border-strong)'}`,
            borderRadius: 'var(--radius-pill)', padding: '5px 14px',
            fontSize: 'var(--text-sm)',
            color: selectMode ? 'var(--on-accent)' : 'var(--text-muted)',
            cursor: 'pointer', fontFamily: 'var(--font-sans)',
          }}
        >
          {selectMode ? <><X size={13} aria-hidden /> 完成</> : <><CheckSquare size={13} aria-hidden /> 多选</>}
        </button>
      </div>

      {/* Batch toolbar：进入多选模式即显示，便于批量操作 */}
      {selectMode && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '8px 12px', marginBottom: '12px',
          background: 'var(--accent-soft)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
        }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--accent)' }}>已选 {selected.size} 项</span>
          <button
            onClick={handleBatchDelete}
            disabled={batchDeleting || selected.size === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              background: 'none', border: '1px solid var(--danger)',
              borderRadius: 'var(--radius-pill)', padding: '4px 12px',
              fontSize: 'var(--text-sm)', color: 'var(--danger)',
              cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
              opacity: selected.size === 0 ? 0.6 : 1,
              fontFamily: 'var(--font-sans)',
            }}
          >
            {batchDeleting ? <Spinner size={12} /> : <Trash2 size={12} aria-hidden />}
            批量删除
          </button>
          {searchMode === 'exact' && (
            <button
              onClick={handleClearStatus}
              style={{
                background: 'none', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-pill)', padding: '4px 12px',
                fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}
            >
              清空全部「{statusLabel}」
            </button>
          )}
          <button
            onClick={() => setSelected(new Set())}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', marginLeft: 'auto', display: 'flex', alignItems: 'center' }}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      )}

      {/* Total count */}
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: '12px' }}>
        共 {semanticActive ? displayTasks.length : total} 项
        {selectMode && selected.size === 0 && displayTasks.length > 0 && (
          <button
            onClick={() => setSelected(new Set(displayTasks.map((t) => t.id)))}
            style={{ marginLeft: '12px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-sans)' }}
          >
            全选当前页
          </button>
        )}
      </div>

      {/* Semantic explanation (voice-note style) */}
      {semanticActive && !semanticLoading && semanticExplanation && (
        <p style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', paddingLeft: '12px', borderLeft: '2px solid var(--accent)', marginBottom: '16px' }}>
          {semanticExplanation}
        </p>
      )}

      {/* Task list */}
      {listLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}>
          <Spinner size={20} />
        </div>
      ) : displayTasks.length === 0 ? (
        <p style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-base)', color: 'var(--text-muted)', textAlign: 'center', padding: '48px 0' }}>
          {semanticActive ? '没有找到相关任务' : '暂无任务'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {displayTasks.map((task) => renderTaskRow(task))}
        </div>
      )}

      {/* Pagination (not applicable to semantic results) */}
      {!semanticActive && totalPages > 1 && (
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', marginTop: '24px' }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              background: 'none', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-pill)', padding: '4px 12px',
              fontSize: 'var(--text-sm)', color: page === 1 ? 'var(--text-muted)' : 'var(--text-secondary)',
              cursor: page === 1 ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)',
            }}
          >
            上一页
          </button>
          <span style={{ display: 'flex', alignItems: 'center', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', padding: '0 8px' }}>
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{
              background: 'none', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-pill)', padding: '4px 12px',
              fontSize: 'var(--text-sm)', color: page === totalPages ? 'var(--text-muted)' : 'var(--text-secondary)',
              cursor: page === totalPages ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)',
            }}
          >
            下一页
          </button>
        </div>
      )}

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="新建任务">
        <TaskForm draft={createDraft} onChange={setCreateDraft} autoFocusTitle />
        <ModalFooter>
          <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '6px 14px', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>取消</button>
          <button onClick={handleCreate} disabled={createLoading || !createDraft.title.trim()} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-pill)', padding: '6px 16px', fontSize: 'var(--text-sm)', color: 'var(--on-accent)', cursor: createLoading ? 'not-allowed' : 'pointer', opacity: createLoading ? 0.7 : 1, fontFamily: 'var(--font-sans)' }}>
            {createLoading && <Spinner size={12} />} 创建
          </button>
        </ModalFooter>
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editTask} onClose={() => setEditTask(null)} title="编辑任务">
        {editTask && (
          <>
            <TaskForm draft={editDraft} onChange={setEditDraft} />
            {/* AI 能力内嵌编辑卡：改写建议 + 拆解为子任务，均作用于当前编辑的任务 */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px', marginBottom: '4px' }}>
              <button
                onClick={handleRewrite}
                disabled={rewriteLoading}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  background: 'none', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-pill)', padding: '5px 13px',
                  fontSize: 'var(--text-sm)', color: 'var(--accent)',
                  cursor: rewriteLoading ? 'not-allowed' : 'pointer',
                  opacity: rewriteLoading ? 0.7 : 1, fontFamily: 'var(--font-sans)',
                }}
              >
                {rewriteLoading ? <Spinner size={12} /> : <Sparkles size={12} aria-hidden />}
                {rewriteLoading ? '正在改写…' : '改写建议'}
              </button>
              <button
                onClick={() => { setDecomposeTask(editTask); setEditTask(null); setDecomposeResult(null) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  background: 'none', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-pill)', padding: '5px 13px',
                  fontSize: 'var(--text-sm)', color: 'var(--accent)',
                  cursor: 'pointer', fontFamily: 'var(--font-sans)',
                }}
              >
                <Sparkles size={12} aria-hidden /> AI 拆解为子任务
              </button>
            </div>
            {/* 改写建议结果卡：采纳后写回标题草稿，用户确认再保存 */}
            {rewriteResult && (
              <div style={{ paddingLeft: '12px', borderLeft: '2px solid var(--accent)', marginTop: '10px', marginBottom: '4px' }}>
                <p style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-base)', color: 'var(--text-primary)', marginBottom: '6px' }}>
                  {rewriteResult.suggested_title}
                </p>
                <p style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                  {rewriteResult.reason}
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={applyRewrite}
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-pill)', padding: '4px 12px', fontSize: 'var(--text-sm)', color: 'var(--on-accent)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
                  >
                    应用改写
                  </button>
                  <button
                    onClick={() => setRewriteResult(null)}
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '4px 12px', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
                  >
                    忽略
                  </button>
                </div>
              </div>
            )}
            <ModalFooter>
              <button onClick={() => setEditTask(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '6px 14px', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>取消</button>
              <button onClick={handleEdit} disabled={!editDraft.title.trim()} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-pill)', padding: '6px 16px', fontSize: 'var(--text-sm)', color: 'var(--on-accent)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                保存
              </button>
            </ModalFooter>
          </>
        )}
      </Modal>

      {/* Decompose modal */}
      <Modal open={!!decomposeTask} onClose={() => { setDecomposeTask(null); setDecomposeResult(null) }} title="AI 拆解目标" maxWidth={580}>
        {decomposeTask && (
          <div>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              目标：<strong>{decomposeTask.title}</strong>
            </p>
            {!decomposeResult && (
              <button
                onClick={handleDecompose}
                disabled={decomposeLoading}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  background: 'var(--accent)', border: '1px solid var(--accent)',
                  borderRadius: 'var(--radius-pill)', padding: '7px 16px',
                  fontSize: 'var(--text-sm)', color: 'var(--on-accent)',
                  cursor: decomposeLoading ? 'not-allowed' : 'pointer',
                  opacity: decomposeLoading ? 0.7 : 1, fontFamily: 'var(--font-sans)',
                  marginBottom: '16px',
                }}
              >
                {decomposeLoading ? <Spinner size={12} /> : <Sparkles size={12} aria-hidden />}
                {decomposeLoading ? '正在拆解…' : '开始拆解'}
              </button>
            )}
            {decomposeResult && (
              <div style={{ paddingLeft: '12px', borderLeft: '2px solid var(--accent)', marginBottom: '16px' }}>
                <p style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                  已拆解为 {decomposeResult.subtasks.length} 个子任务：
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {decomposeResult.subtasks.map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', minWidth: '18px' }}>{s.sort_order}.</span>
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{s.title}</span>
                      {s.star_rating && <StarRating value={s.star_rating} readonly size="sm" />}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <ModalFooter>
              <button onClick={() => { setDecomposeTask(null); setDecomposeResult(null) }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '6px 14px', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>取消</button>
              {decomposeResult && (
                <button onClick={confirmDecompose} disabled={decomposeConfirming} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-pill)', padding: '6px 16px', fontSize: 'var(--text-sm)', color: 'var(--on-accent)', cursor: decomposeConfirming ? 'not-allowed' : 'pointer', opacity: decomposeConfirming ? 0.7 : 1, fontFamily: 'var(--font-sans)' }}>
                  {decomposeConfirming && <Spinner size={12} />} 创建任务组
                </button>
              )}
            </ModalFooter>
          </div>
        )}
      </Modal>
    </PageContainer>
  )
}
