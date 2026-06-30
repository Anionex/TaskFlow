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

export function TodaySection() {
  const { addToast } = useAppStore()
  const [parseLoading, setParseLoading] = useState(false)
  const [parseDraft, setParseDraft] = useState<ParsedTask | null>(null)
  const [braindumpLoading, setBraindumpLoading] = useState(false)
  const [braindumpDrafts, setBraindumpDrafts] = useState<ParsedTask[]>([])

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
    setParseDraft(null)
    try {
      const res = await aiApi.parse(text)
      if (res.success && res.data) {
        setParseDraft(res.data)
      } else {
        addToast({ type: 'error', message: res.message || '没能理清，先帮你打开手动填写' })
        setShowCreate(true)
      }
    } catch {
      addToast({ type: 'error', message: 'AI 一时没接上，先手动记一笔吧' })
      setShowCreate(true)
    } finally {
      setParseLoading(false)
    }
  }

  async function handleBrainDump(text: string) {
    setBraindumpLoading(true)
    setBraindumpDrafts([])
    try {
      const res = await aiApi.braindump(text)
      if (res.success && res.data) {
        setBraindumpDrafts(res.data.items)
      } else {
        addToast({ type: 'error', message: res.message || '批量解析失败' })
      }
    } catch {
      addToast({ type: 'error', message: 'AI 一时没接上，稍后再试' })
    } finally {
      setBraindumpLoading(false)
    }
  }

  async function confirmParsedTask(draft: ParsedTask) {
    const res = await tasksApi.create({
      title: draft.title,
      description: draft.description,
      category: draft.category,
      star_rating: draft.star_rating,
      start_date: draft.start_date ?? undefined,
      deadline: draft.deadline ?? undefined,
    })
    if (res.success) {
      addToast({ type: 'success', message: '已记下' })
      setParseDraft(null)
      loadStats()
    } else {
      addToast({ type: 'error', message: res.message })
    }
  }

  async function confirmBraindumpTask(draft: ParsedTask, idx: number) {
    const res = await tasksApi.create({
      title: draft.title,
      description: draft.description,
      category: draft.category,
      star_rating: draft.star_rating,
      start_date: draft.start_date ?? undefined,
      deadline: draft.deadline ?? undefined,
    })
    if (res.success) {
      addToast({ type: 'success', message: '已记下' })
      setBraindumpDrafts((d) => d.filter((_, i) => i !== idx))
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
      addToast({ type: 'error', message: 'AI 一时没接上，稍后再试' })
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
      addToast({ type: 'error', message: 'AI 一时没接上，稍后再试' })
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
        addToast({ type: 'success', message: '今天，已打卡' })
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
        addToast({ type: 'success', message: '已记下' })
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
        <div style={{ display: 'flex', gap: '24px', marginBottom: '32px', paddingBottom: '24px', borderBottom: '1px solid var(--border)' }}>
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
          onBrainDump={handleBrainDump}
          loading={parseLoading || braindumpLoading}
          loadingLabel={braindumpLoading ? '正在逐条理清…' : '正在为你斟酌…'}
        />

        {/* Parse draft */}
        {parseDraft && (
          <AiDraftCard
            draft={parseDraft}
            onConfirm={confirmParsedTask}
            onDiscard={() => setParseDraft(null)}
          />
        )}

        {/* Braindump drafts */}
        {braindumpDrafts.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <p style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '12px' }}>
              从这段话里，我理出了 {braindumpDrafts.length} 件事，逐一过目，确认无误再收下：
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {braindumpDrafts.map((d, i) => (
                <AiDraftCard
                  key={i}
                  draft={d}
                  onConfirm={(draft) => confirmBraindumpTask(draft, i)}
                  onDiscard={() => setBraindumpDrafts((arr) => arr.filter((_, j) => j !== i))}
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
              晨起读你的清单，这几件，今天不妨先放在手边：
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
