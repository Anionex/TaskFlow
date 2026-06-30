import { useState, useEffect } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import { PageContainer } from '@/components/layout/PageContainer'
import { recycleApi } from '@/api/recycle'
import { useAppStore } from '@/store'
import type { Task } from '@/types'

export function RecycleSection() {
  const { addToast } = useAppStore()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const res = await recycleApi.list()
    if (res.success && res.data) {
      const d = res.data as any
      setTasks(Array.isArray(d) ? d : (d.items ?? []))
    }
    setLoading(false)
  }

  async function restore(id: string) {
    const res = await recycleApi.restore(id)
    if (res.success) {
      addToast({ type: 'success', message: '已还原' })
      load()
    } else {
      addToast({ type: 'error', message: res.message })
    }
  }

  async function deletePermanent(id: string) {
    if (!window.confirm('永久删除后无法找回，确认？')) return
    const res = await recycleApi.deletePermanent(id)
    if (res.success) {
      addToast({ type: 'success', message: '已永久删除' })
      load()
    } else {
      addToast({ type: 'error', message: res.message })
    }
  }

  async function clearAll() {
    if (!window.confirm('清空回收站后无法找回，确认？')) return
    const res = await recycleApi.clearAll()
    if (res.success) {
      addToast({ type: 'success', message: '回收站已清空' })
      load()
    } else {
      addToast({ type: 'error', message: res.message })
    }
  }

  return (
    <PageContainer width={860}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)' }}>回收站</h1>
        {tasks.length > 0 && (
          <button
            onClick={clearAll}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'none', border: '1px solid var(--danger)',
              borderRadius: 'var(--radius-pill)', padding: '6px 14px',
              fontSize: 'var(--text-sm)', color: 'var(--danger)',
              cursor: 'pointer', fontFamily: 'var(--font-sans)',
            }}
          >
            <Trash2 size={13} aria-hidden /> 清空回收站
          </button>
        )}
      </div>

      <p style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '24px' }}>
        已删除的任务保留在这里，可还原或永久删除。
      </p>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}><Spinner size={20} /></div>
      ) : tasks.length === 0 ? (
        <p style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-base)', color: 'var(--text-muted)', textAlign: 'center', padding: '48px 0' }}>
          回收站为空
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {tasks.map((task) => (
            <div key={task.id} style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              padding: '10px 4px', borderBottom: '1px solid var(--border)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: '2px', textDecoration: 'line-through' }}>
                  {task.title}
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '1px 7px' }}>
                    {task.category}
                  </span>
                  {task.deleted_at && (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                      删除于 {task.deleted_at.slice(0, 10)}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => restore(task.id)}
                aria-label="还原"
                title="还原"
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  background: 'none', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-pill)', padding: '4px 11px',
                  fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
                  cursor: 'pointer', fontFamily: 'var(--font-sans)',
                }}
              >
                <RotateCcw size={12} aria-hidden /> 还原
              </button>
              <button
                onClick={() => deletePermanent(task.id)}
                aria-label="永久删除"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', display: 'flex', padding: '4px' }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  )
}
