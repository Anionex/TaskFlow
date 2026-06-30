import { useState, useEffect } from 'react'
import { Sun, Moon, Flame, CheckCircle2, Plus } from 'lucide-react'
import { SmartInput } from '@/components/ai/SmartInput'
import { AiDraftCard } from '@/components/ai/AiDraftCard'
import { Spinner } from '@/components/ui/Spinner'
import { Modal, ModalFooter } from '@/components/ui/Modal'
import { PageContainer } from '@/components/layout/PageContainer'
import { TaskForm, emptyDraft } from '@/components/task/TaskForm'
import { aiApi } from '@/api/ai'
import { tasksApi } from '@/api/tasks'
import { userApi } from '@/api/user'
import { checkinApi } from '@/api/checkin'
import { useAppStore } from '@/store'
import type { ParsedTask, MorningResult, EveningResult, UserStats, CheckinStatus } from '@/types'

type DraftItem = ParsedTask & { _key: string }

let draftKeySeq = 0
const nextDraftKey = () => `draft-${Date.now()}-${draftKeySeq++}`

export function TodaySection() {
  const { addToast } = useAppStore()
  const [parseLoading, setParseLoading] = useState(false)
  // Each draft carries a stable client-side key so React keeps each
  // AiDraftCard's internal edit-state bound to the correct draft even
  // as items above it are confirmed/discarded.
  const [drafts, setDrafts] = useState<DraftItem[]>([])

  const [morningLoading, setMorningLoading] = useState(false)
  const [morningData, setMorningData] = useState<MorningResult | null>(null)
  const [eveningLoading, setEveningLoading] = useState(false)
  const [eveningData, setEveningData] = useState<EveningResult | null>(null)

  const [stats, setStats] = useState<UserStats | null>(null)
  const [checkin, setCheckin] = useState<CheckinStatus | null>(null)
  const [checkinLoading, setCheckinLoading] = useState(false)

  // Manual create modal
  const [showCreate, setShowCreate] = useState(false)
  const [newDraft, setNewDraft] = useState(emptyDraft())
  const [createLoading, setCreateLoading] = useState(false)

  useEffect(() => {
    loadStats()
    loadCheckin()
  }, [])

  async function loadStats() {
    const res = await userApi.stats()
    if (res.success && res.data) setStats(res.data)
  }

  async function loadCheckin() {
    const res = await checkinApi.status()
    if (res.success && res.data) setCheckin(res.data)
  }

  async function handleParse(text: string) {
    setParseLoading(true)
    setDrafts([])
    try {
      const res = await aiApi.parse(text)
      if (res.success && res.data && res.data.items.length > 0) {
        setDrafts(res.data.items.map((item) => ({ ...item, _key: nextDraftKey() })))
      } else if (res.success) {
        addToast({ type: 'error', message: '没解析出任务，请手动填写' })
        setShowCreate(true)
      } else {
        addToast({ type: 'error', message: res.message || '解析失败，请手动填写' })
        setShowCreate(true)
      }
    } catch {
      addToast({ type: 'error', message: 'AI 服务暂时不可用，请手动填写' })
      setShowCreate(true)
    } finally {
      setParseLoading(false)
    }
  }

  async function confirmDraft(draft: DraftItem) {
    const res = await tasksApi.create({
      title: draft.title,
      description: draft.description,
      category: draft.category,
      star_rating: draft.star_rating,
      start_date: draft.start_date ?? undefined,
      deadline: draft.deadline ?? undefined,
    })
    if (res.success) {
      addToast({ type: 'success', message: '任务已创建' })
      setDrafts((d) => d.filter((item) => item._key !== draft._key))
      loadStats()
    } else {
      addToast({ type: 'error', message: res.message })
    }
  }

  async function handleMorning() {
    setMorningLoading(true)
    setMorningData(null)
    try {
      const res = await aiApi.morning()
      if (res.success && res.data) setMorningData(res.data)
      else addToast({ type: 'error', message: res.message || '推荐失败' })
    } catch {
      addToast({ type: 'error', message: 'AI 服务暂时不可用' })
    } finally {
      setMorningLoading(false)
    }
  }

  async function handleEvening() {
    setEveningLoading(true)
    setEveningData(null)
    try {
      const res = await aiApi.evening()
      if (res.success && res.data) setEveningData(res.data)
      else addToast({ type: 'error', message: res.message || '总结失败' })
    } catch {
      addToast({ type: 'error', message: 'AI 服务暂时不可用' })
    } finally {
      setEveningLoading(false)
    }
  }

  async function handleCheckin() {
    if (checkin?.today_checked || checkinLoading) return
    setCheckinLoading(true)
    try {
      const res = await checkinApi.checkin()
      if (res.success) {
        addToast({ type: 'success', message: '打卡成功' })
        loadCheckin()
      } else {
        addToast({ type: 'error', message: res.message })
      }
    } finally {
      setCheckinLoading(false)
    }
  }

  async function handleCreateManual() {
    if (!newDraft.title.trim()) return
    setCreateLoading(true)
    try {
      const res = await tasksApi.create({
        title: newDraft.title,
        description: newDraft.description,
        category: newDraft.category,
        star_rating: newDraft.star_rating,
        start_date: newDraft.start_date || undefined,
        deadline: newDraft.deadline || undefined,
      })
      if (res.success) {
        addToast({ type: 'success', message: '任务已创建' })
        setShowCreate(false)
        setNewDraft(emptyDraft())
        loadStats()
      } else {
        addToast({ type: 'error', message: res.message })
      }
    } finally {
      setCreateLoading(false)
    }
  }

  return (
    <PageContainer width={760}>
      {/* Page title */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)' }}>
          今日
        </h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: '4px' }}>
          {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
        </p>
      </div>

      {/* Overview numbers */}
      {stats && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', rowGap: '16px', marginBottom: '32px', paddingBottom: '24px', borderBottom: '1px solid var(--border)' }}>
          {[
            { label: '待完成', value: stats.pending, color: 'var(--text-primary)' },
            { label: '已完成', value: stats.completed, color: 'var(--success)' },
            { label: '已过期', value: stats.expired, color: 'var(--danger)' },
            { label: '总计', value: stats.total, color: 'var(--text-secondary)' },
          ].map((item) => (
            <div key={item.label}>
              <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--fw-medium)', color: item.color, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                {item.value}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: '4px' }}>{item.label}</div>
            </div>
          ))}

          {/* Checkin */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
            {checkin && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-sm)', color: checkin.current_streak > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
                <Flame size={14} aria-hidden />
                连续 {checkin.current_streak} 天
              </span>
            )}
            <button
              onClick={handleCheckin}
              disabled={checkin?.today_checked || checkinLoading}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                background: checkin?.today_checked ? 'var(--surface-0)' : 'var(--accent)',
                border: `1px solid ${checkin?.today_checked ? 'var(--border)' : 'var(--accent)'}`,
                borderRadius: 'var(--radius-pill)',
                padding: '5px 14px',
                fontSize: 'var(--text-sm)',
                color: checkin?.today_checked ? 'var(--text-muted)' : 'var(--on-accent)',
                cursor: checkin?.today_checked ? 'default' : 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
            >
              {checkinLoading ? <Spinner size={12} /> : <CheckCircle2 size={13} aria-hidden />}
              {checkin?.today_checked ? '已打卡' : '打卡'}
            </button>
          </div>
        </div>
      )}

      {/* Smart Input */}
      <div style={{ marginBottom: '24px' }}>
        <SmartInput
          onParse={handleParse}
          loading={parseLoading}
          loadingLabel="正在整理…"
        />

        {/* Drafts — 1 or N, the model decides */}
        {drafts.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            {drafts.length > 1 && (
              <p style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                共整理出 {drafts.length} 个任务，逐一确认后入库：
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {drafts.map((d) => (
                <AiDraftCard
                  key={d._key}
                  draft={d}
                  onConfirm={(draft) => confirmDraft({ ...draft, _key: d._key })}
                  onDiscard={() => setDrafts((arr) => arr.filter((item) => item._key !== d._key))}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Manual create button */}
      <div style={{ marginBottom: '32px' }}>
        <button
          onClick={() => { setShowCreate(true); setNewDraft(emptyDraft()) }}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            background: 'none', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-pill)', padding: '5px 14px',
            fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
            cursor: 'pointer', fontFamily: 'var(--font-sans)',
          }}
        >
          <Plus size={13} aria-hidden /> 手动创建任务
        </button>
      </div>

      {/* Morning / Evening */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '28px', marginBottom: '28px' }}>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
          <button
            onClick={handleMorning}
            disabled={morningLoading}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'var(--accent)', border: '1px solid var(--accent)',
              borderRadius: 'var(--radius-pill)', padding: '6px 16px',
              fontSize: 'var(--text-sm)', color: 'var(--on-accent)',
              cursor: morningLoading ? 'not-allowed' : 'pointer',
              opacity: morningLoading ? 0.7 : 1,
              fontFamily: 'var(--font-sans)',
            }}
          >
            {morningLoading ? <Spinner size={12} /> : <Sun size={13} aria-hidden />}
            早间推荐
          </button>
          <button
            onClick={handleEvening}
            disabled={eveningLoading}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'none', border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-pill)', padding: '6px 16px',
              fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
              cursor: eveningLoading ? 'not-allowed' : 'pointer',
              opacity: eveningLoading ? 0.7 : 1,
              fontFamily: 'var(--font-sans)',
            }}
          >
            {eveningLoading ? <Spinner size={12} /> : <Moon size={13} aria-hidden />}
            晚间总结
          </button>
        </div>

        {morningData && !morningLoading && (
          <div style={{ paddingLeft: '16px', borderLeft: '2px solid var(--accent)' }}>
            <p style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '12px' }}>
              今日推荐优先完成以下任务：
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {morningData.recommendations.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', minWidth: '18px', paddingTop: '2px' }}>{i + 1}.</span>
                  <div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', marginBottom: '2px' }}>{r.title}</div>
                    <div style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{r.reason}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {eveningData && !eveningLoading && (
          <div style={{ paddingLeft: '16px', borderLeft: '2px solid var(--border-strong)' }}>
            <p style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>
              {eveningData.summary}
            </p>
          </div>
        )}
      </div>

      {/* Manual create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="创建任务">
        <TaskForm draft={newDraft} onChange={setNewDraft} autoFocusTitle />
        <ModalFooter>
          <button
            onClick={() => setShowCreate(false)}
            style={{
              background: 'none', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-pill)', padding: '6px 14px',
              fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
              cursor: 'pointer', fontFamily: 'var(--font-sans)',
            }}
          >
            取消
          </button>
          <button
            onClick={handleCreateManual}
            disabled={createLoading || !newDraft.title.trim()}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'var(--accent)', border: '1px solid var(--accent)',
              borderRadius: 'var(--radius-pill)', padding: '6px 16px',
              fontSize: 'var(--text-sm)', color: 'var(--on-accent)',
              cursor: createLoading ? 'not-allowed' : 'pointer',
              opacity: createLoading ? 0.7 : 1,
              fontFamily: 'var(--font-sans)',
            }}
          >
            {createLoading && <Spinner size={12} />}
            创建
          </button>
        </ModalFooter>
      </Modal>
    </PageContainer>
  )
}
