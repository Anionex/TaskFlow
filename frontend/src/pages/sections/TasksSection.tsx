import { useState, useEffect, useCallback } from 'react'
import {
  ChevronDown, ChevronRight, Plus, Trash2, CheckSquare, Square,
  Edit2, Sparkles, X
} from 'lucide-react'
import { StarRating } from '@/components/ui/StarRating'
import { Spinner } from '@/components/ui/Spinner'
import { Modal, ModalFooter } from '@/components/ui/Modal'
import { PageContainer } from '@/components/layout/PageContainer'
import { TaskForm, emptyDraft } from '@/components/task/TaskForm'
import { tasksApi } from '@/api/tasks'
import { aiApi } from '@/api/ai'
import { useAppStore } from '@/store'
import type { Task, Category, SortBy, DecomposeResult } from '@/types'
const STATUS_TABS = [
  { id: 'pending', label: '待办' },
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
  const [category, setCategory] = useState<Category | ''>('')
  const [sortBy, setSortBy] = useState<SortBy>('created')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)
  const [tasks, setTasks] = useState<Task[]>([])
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  // Batch selection
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)

  // Collapse state for task groups
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  // Modals
  const [showCreate, setShowCreate] = useState(false)
  const [createDraft, setCreateDraft] = useState(emptyDraft())
  const [createLoading, setCreateLoading] = useState(false)

  const [editTask, setEditTask] = useState<Task | null>(null)
  const [editDraft, setEditDraft] = useState(emptyDraft())
  const [editLoading, setEditLoading] = useState(false)

  const [rewriteTask, setRewriteTask] = useState<Task | null>(null)
  const [rewriteLoading, setRewriteLoading] = useState(false)
  const [rewriteResult, setRewriteResult] = useState<{ actionable: boolean; suggested_title: string; reason: string } | null>(null)

  const [decomposeTask, setDecomposeTask] = useState<Task | null>(null)
  const [decomposeLoading, setDecomposeLoading] = useState(false)
  const [decomposeResult, setDecomposeResult] = useState<DecomposeResult | null>(null)
  const [decomposeConfirming, setDecomposeConfirming] = useState(false)

  const loadTasks = useCallback(async () => {
    setLoading(true)
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
      setLoading(false)
    }
  }, [tab, category, sortBy, search, page])

  useEffect(() => { loadTasks() }, [loadTasks])

  // Search on enter / debounce
  function handleSearchKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { setSearch(searchInput); setPage(1) }
  }

  async function toggleTask(id: string) {
    await tasksApi.toggle(id)
    loadTasks()
  }

  async function deleteTask(id: string) {
    await tasksApi.delete(id)
    addToast({ type: 'success', message: '已移至回收站' })
    loadTasks()
  }

  async function handleBatchDelete() {
    if (selected.size === 0) return
    setBatchDeleting(true)
    try {
      await tasksApi.batchDelete(Array.from(selected))
      addToast({ type: 'success', message: `已删除 ${selected.size} 个任务` })
      setSelected(new Set())
      loadTasks()
    } finally {
      setBatchDeleting(false)
    }
  }

  async function handleClearStatus() {
    if (!window.confirm(`确认清空所有"${tab === 'completed' ? '已完成' : tab === 'expired' ? '已过期' : '待办'}"任务？`)) return
    await tasksApi.clear(tab as any)
    addToast({ type: 'success', message: '已清空' })
    loadTasks()
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
        loadTasks()
      } else {
        addToast({ type: 'error', message: res.message })
      }
    } finally {
      setCreateLoading(false)
    }
  }

  function openEdit(task: Task) {
    setEditTask(task)
    setEditDraft({
      title: task.title,
      description: task.description,
      category: task.category,
      star_rating: task.star_rating,
      start_date: task.start_date?.slice(0, 10) ?? '',
      deadline: task.deadline?.slice(0, 10) ?? '',
    })
  }

  async function handleEdit() {
    if (!editTask || !editDraft.title.trim()) return
    setEditLoading(true)
    try {
      const res = await tasksApi.update(editTask.id, {
        title: editDraft.title,
        description: editDraft.description,
        category: editDraft.category,
        star_rating: editDraft.star_rating,
        start_date: editDraft.start_date || undefined,
        deadline: editDraft.deadline || undefined,
      })
      if (res.success) {
        addToast({ type: 'success', message: '已更新' })
        setEditTask(null)
        loadTasks()
      } else {
        addToast({ type: 'error', message: res.message })
      }
    } finally {
      setEditLoading(false)
    }
  }

  async function handleRewrite() {
    if (!rewriteTask) return
    setRewriteLoading(true)
    setRewriteResult(null)
    try {
      const res = await aiApi.rewrite(rewriteTask.title, rewriteTask.description)
      if (res.success && res.data) setRewriteResult(res.data)
      else addToast({ type: 'error', message: res.message || '改写失败' })
    } catch {
      addToast({ type: 'error', message: 'AI 服务暂时不可用' })
    } finally {
      setRewriteLoading(false)
    }
  }

  async function applyRewrite() {
    if (!rewriteTask || !rewriteResult) return
    await tasksApi.update(rewriteTask.id, { title: rewriteResult.suggested_title })
    addToast({ type: 'success', message: '标题已更新' })
    setRewriteTask(null)
    setRewriteResult(null)
    loadTasks()
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
        loadTasks()
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

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border)', marginBottom: '20px' }}>
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
          placeholder="搜索任务…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={handleSearchKey}
          onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--ring)' }}
          onBlur={(e) => { e.target.style.borderColor = 'var(--border-strong)'; e.target.style.boxShadow = 'none' }}
          style={{ ...inputStyle, flex: 1, minWidth: 180 }}
        />
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

      {/* Batch toolbar */}
      {selected.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '8px 12px', marginBottom: '12px',
          background: 'var(--accent-soft)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
        }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--accent)' }}>已选 {selected.size} 项</span>
          <button
            onClick={handleBatchDelete}
            disabled={batchDeleting}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              background: 'none', border: '1px solid var(--danger)',
              borderRadius: 'var(--radius-pill)', padding: '4px 12px',
              fontSize: 'var(--text-sm)', color: 'var(--danger)',
              cursor: 'pointer', fontFamily: 'var(--font-sans)',
            }}
          >
            {batchDeleting ? <Spinner size={12} /> : <Trash2 size={12} aria-hidden />}
            批量删除
          </button>
          <button
            onClick={handleClearStatus}
            style={{
              background: 'none', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-pill)', padding: '4px 12px',
              fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
              cursor: 'pointer', fontFamily: 'var(--font-sans)',
            }}
          >
            清空当前列表
          </button>
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
        共 {total} 项
        {selected.size === 0 && tasks.length > 0 && (
          <button
            onClick={() => setSelected(new Set(tasks.map((t) => t.id)))}
            style={{ marginLeft: '12px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-sans)' }}
          >
            全选当前页
          </button>
        )}
      </div>

      {/* Task list */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}>
          <Spinner size={20} />
        </div>
      ) : tasks.length === 0 ? (
        <p style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-base)', color: 'var(--text-muted)', textAlign: 'center', padding: '48px 0' }}>
          暂无任务
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {tasks.map((task) => {
            const isGroup = (task.subtask_total ?? 0) > 0
            const isCollapsed = collapsed.has(task.id)
            const overdue = isOverdue(task)
            const isSelected = selected.has(task.id)

            return (
              <div key={task.id}>
                {/* Task row */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 4px',
                    borderBottom: '1px solid var(--border)',
                    background: isSelected ? 'var(--accent-soft)' : 'transparent',
                    transition: 'background var(--dur-fast)',
                  }}
                >
                  {/* Checkbox for batch */}
                  <button
                    onClick={() => toggleSelect(task.id)}
                    aria-label={isSelected ? '取消选择' : '选择'}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: isSelected ? 'var(--accent)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                  >
                    {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                  </button>

                  {/* Complete toggle */}
                  <button
                    onClick={() => toggleTask(task.id)}
                    aria-label={task.completed ? '标记未完成' : '标记完成'}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: task.completed ? 'var(--success)' : 'var(--border-strong)', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                  >
                    {task.completed ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>

                  {/* Collapse toggle for groups */}
                  {isGroup && (
                    <button
                      onClick={() => toggleCollapse(task.id)}
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
                  <CategoryPill cat={task.category} />

                  {/* Star */}
                  <StarRating value={task.star_rating} readonly size="sm" />

                  {/* Deadline */}
                  {task.deadline && (
                    <span style={{ fontSize: 'var(--text-xs)', color: overdue ? 'var(--danger)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                      {formatDate(task.deadline)}
                    </span>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    <button
                      onClick={() => openEdit(task)}
                      aria-label="编辑"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: '3px' }}
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      onClick={() => { setRewriteTask(task); setRewriteResult(null) }}
                      aria-label="AI 改写"
                      title="AI 改写"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: '3px' }}
                    >
                      <Sparkles size={13} />
                    </button>
                    <button
                      onClick={() => deleteTask(task.id)}
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
                    <StarRating value={sub.star_rating} readonly size="sm" />
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
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
            {/* Decompose button in edit */}
            <div style={{ marginTop: '4px', marginBottom: '4px' }}>
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
            <ModalFooter>
              <button onClick={() => setEditTask(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '6px 14px', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>取消</button>
              <button onClick={handleEdit} disabled={editLoading || !editDraft.title.trim()} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-pill)', padding: '6px 16px', fontSize: 'var(--text-sm)', color: 'var(--on-accent)', cursor: editLoading ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)' }}>
                {editLoading && <Spinner size={12} />} 保存
              </button>
            </ModalFooter>
          </>
        )}
      </Modal>

      {/* Rewrite modal */}
      <Modal open={!!rewriteTask} onClose={() => { setRewriteTask(null); setRewriteResult(null) }} title="AI 改写标题">
        {rewriteTask && (
          <div>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              当前标题：<strong>{rewriteTask.title}</strong>
            </p>
            {rewriteResult ? (
              <div style={{ paddingLeft: '12px', borderLeft: '2px solid var(--accent)', marginBottom: '16px' }}>
                <p style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-base)', color: 'var(--text-primary)', marginBottom: '6px' }}>
                  {rewriteResult.suggested_title}
                </p>
                <p style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                  {rewriteResult.reason}
                </p>
              </div>
            ) : (
              <button
                onClick={handleRewrite}
                disabled={rewriteLoading}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  background: 'var(--accent)', border: '1px solid var(--accent)',
                  borderRadius: 'var(--radius-pill)', padding: '7px 16px',
                  fontSize: 'var(--text-sm)', color: 'var(--on-accent)',
                  cursor: rewriteLoading ? 'not-allowed' : 'pointer',
                  opacity: rewriteLoading ? 0.7 : 1, fontFamily: 'var(--font-sans)',
                  marginBottom: '16px',
                }}
              >
                {rewriteLoading ? <Spinner size={12} /> : <Sparkles size={12} aria-hidden />}
                {rewriteLoading ? '正在改写…' : '生成改写建议'}
              </button>
            )}
            <ModalFooter>
              <button onClick={() => { setRewriteTask(null); setRewriteResult(null) }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '6px 14px', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>关闭</button>
              {rewriteResult && (
                <button onClick={applyRewrite} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-pill)', padding: '6px 16px', fontSize: 'var(--text-sm)', color: 'var(--on-accent)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                  应用改写
                </button>
              )}
            </ModalFooter>
          </div>
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
