import { useState } from 'react'
import { Search, Sparkles } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import { StarRating } from '@/components/ui/StarRating'
import { PageContainer } from '@/components/layout/PageContainer'
import { aiApi } from '@/api/ai'
import { useAppStore } from '@/store'
import type { Task, SearchResult } from '@/types'

export function SearchSection() {
  const { addToast } = useAppStore()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setResult(null)
    try {
      const res = await aiApi.search(query.trim())
      if (res.success && res.data) {
        setResult(res.data)
      } else {
        addToast({ type: 'error', message: res.message || '检索失败' })
      }
    } catch {
      addToast({ type: 'error', message: 'AI 服务暂时不可用' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageContainer width={720}>
      <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--fw-medium)', marginBottom: '8px', color: 'var(--text-primary)' }}>
        语义检索
      </h1>
      <p style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '28px' }}>
        用自然语言描述你想找的任务，AI 会理解语义并找到相关内容。
      </p>

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '10px', marginBottom: '28px' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={14} aria-hidden style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="例如：上周没完成的工作任务、关于学习的重要事项…"
            style={{
              width: '100%',
              background: 'var(--surface-1)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-md)',
              padding: '9px 12px 9px 34px',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-sm)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--ring)' }}
            onBlur={(e) => { e.target.style.borderColor = 'var(--border-strong)'; e.target.style.boxShadow = 'none' }}
          />
        </div>
        <button
          type="submit"
          disabled={!query.trim() || loading}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            background: query.trim() && !loading ? 'var(--accent)' : 'var(--border)',
            border: '1px solid transparent',
            borderRadius: 'var(--radius-pill)', padding: '7px 18px',
            fontSize: 'var(--text-sm)',
            color: query.trim() && !loading ? 'var(--on-accent)' : 'var(--text-muted)',
            cursor: !query.trim() || loading ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-sans)',
            transition: 'background var(--dur-fast)',
          }}
        >
          {loading ? <Spinner size={13} /> : <Sparkles size={13} aria-hidden />}
          {loading ? '检索中…' : '检索'}
        </button>
      </form>

      {result && (
        <div>
          {result.explanation && (
            <p style={{
              fontFamily: 'var(--font-voice)',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-secondary)',
              paddingLeft: '12px',
              borderLeft: '2px solid var(--accent)',
              marginBottom: '20px',
              lineHeight: 'var(--lh-normal)',
            }}>
              {result.explanation}
            </p>
          )}

          {result.items.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>没有找到相关任务。</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: '12px' }}>
                找到 {result.items.length} 个相关任务
              </div>
              {result.items.map((task: Task) => (
                <div key={task.id} style={{
                  padding: '10px 4px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 'var(--text-sm)',
                      color: task.completed ? 'var(--text-muted)' : 'var(--text-primary)',
                      textDecoration: task.completed ? 'line-through' : 'none',
                      marginBottom: '2px',
                    }}>
                      {task.title}
                    </div>
                    {task.description && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {task.description}
                      </div>
                    )}
                  </div>
                  <span style={{
                    fontSize: 'var(--text-2xs)',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-pill)',
                    padding: '1px 7px',
                  }}>
                    {task.category}
                  </span>
                  <StarRating value={task.star_rating} readonly size="sm" />
                  {task.completed && (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--success)' }}>已完成</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </PageContainer>
  )
}
