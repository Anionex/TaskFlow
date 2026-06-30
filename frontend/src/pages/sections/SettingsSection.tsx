import { useState, useEffect } from 'react'
import { Download, Upload, Eye, EyeOff } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import { PageContainer } from '@/components/layout/PageContainer'
import { userApi } from '@/api/user'
import { api } from '@/api/client'
import { useAppStore } from '@/store'
import type { Tone } from '@/types'

const TONES: { id: Tone; label: string; desc: string }[] = [
  { id: '温暖鼓励型', label: '温暖鼓励', desc: '积极正面，给予鼓励' },
  { id: '冷静督促型', label: '冷静督促', desc: '客观直接，关注结果' },
  { id: '简短效率型', label: '简短效率', desc: '简洁精练，信息密度高' },
]

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface-0)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  padding: '7px 10px',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-sm)',
  outline: 'none',
  boxSizing: 'border-box',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ paddingBottom: '28px', marginBottom: '28px', borderBottom: '1px solid var(--border)' }}>
      <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)', marginBottom: '16px' }}>
        {title}
      </h2>
      {children}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 'var(--fw-medium)', color: 'var(--text-secondary)', marginBottom: '5px' }}>
        {label}
      </label>
      {children}
      {hint && <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: '4px' }}>{hint}</p>}
    </div>
  )
}

export function SettingsSection() {
  const { addToast, theme, setTheme } = useAppStore()

  // Password
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [pwdLoading, setPwdLoading] = useState(false)
  const [showPwd, setShowPwd] = useState(false)

  // Tone
  const [tone, setTone] = useState<Tone>('温暖鼓励型')
  const [toneLoading, setToneLoading] = useState(false)

  // LLM settings
  const [llmKey, setLlmKey] = useState(localStorage.getItem('llm_key') ?? '')
  const [llmModel, setLlmModel] = useState(localStorage.getItem('llm_model') ?? '')
  const [llmBase, setLlmBase] = useState(localStorage.getItem('llm_base_url') ?? '')
  const [showKey, setShowKey] = useState(false)

  // Import/export
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    const res = await userApi.getSettings()
    if (res.success && res.data) {
      setTone(res.data.summary_tone)
      // 大模型设置以账户为准（跨设备同步），并镜像到 localStorage 供请求头快路径使用。
      const key = res.data.llm_api_key ?? ''
      const model = res.data.llm_model ?? ''
      const base = res.data.llm_base_url ?? ''
      setLlmKey(key)
      setLlmModel(model)
      setLlmBase(base)
      mirrorLlmToLocalStorage(key, model, base)
    }
  }

  function mirrorLlmToLocalStorage(key: string, model: string, base: string) {
    if (key) localStorage.setItem('llm_key', key); else localStorage.removeItem('llm_key')
    if (model) localStorage.setItem('llm_model', model); else localStorage.removeItem('llm_model')
    if (base) localStorage.setItem('llm_base_url', base); else localStorage.removeItem('llm_base_url')
  }

  async function handleChangePwd() {
    if (!oldPwd || !newPwd) return
    if (newPwd !== confirmPwd) { addToast({ type: 'error', message: '两次密码不一致' }); return }
    if (newPwd.length < 6) { addToast({ type: 'error', message: '密码至少 6 位' }); return }
    setPwdLoading(true)
    try {
      const res = await userApi.changePassword(oldPwd, newPwd)
      if (res.success) {
        addToast({ type: 'success', message: '密码已修改' })
        setOldPwd(''); setNewPwd(''); setConfirmPwd('')
      } else {
        addToast({ type: 'error', message: res.message })
      }
    } finally {
      setPwdLoading(false)
    }
  }

  async function handleSaveTone() {
    setToneLoading(true)
    try {
      const res = await userApi.updateSettings({ summary_tone: tone })
      if (res.success) addToast({ type: 'success', message: '语气偏好已保存' })
      else addToast({ type: 'error', message: res.message })
    } finally {
      setToneLoading(false)
    }
  }

  const [llmLoading, setLlmLoading] = useState(false)

  async function saveLlm() {
    setLlmLoading(true)
    try {
      const res = await userApi.updateSettings({
        llm_api_key: llmKey.trim(),
        llm_model: llmModel.trim(),
        llm_base_url: llmBase.trim(),
      })
      if (res.success) {
        // 账户保存成功后镜像到本地，供请求头快路径直接使用。
        mirrorLlmToLocalStorage(llmKey.trim(), llmModel.trim(), llmBase.trim())
        addToast({ type: 'success', message: '大模型设置已保存（已同步到账户）' })
      } else {
        addToast({ type: 'error', message: res.message || '保存失败' })
      }
    } finally {
      setLlmLoading(false)
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      const blob = await api.download('/export')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `taskflow-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      addToast({ type: 'error', message: '导出失败' })
    } finally {
      setExporting(false)
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const res = await api.upload('/import', file)
      if (res.success) addToast({ type: 'success', message: '导入成功' })
      else addToast({ type: 'error', message: res.message || '导入失败' })
    } catch {
      addToast({ type: 'error', message: '导入失败' })
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

  function focusIn(e: React.FocusEvent<any>) { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--ring)' }
  function focusOut(e: React.FocusEvent<any>) { e.target.style.borderColor = 'var(--border-strong)'; e.target.style.boxShadow = 'none' }

  return (
    <PageContainer width={640}>
      <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--fw-medium)', marginBottom: '32px', color: 'var(--text-primary)' }}>设置</h1>

      {/* Theme */}
      <Section title="主题">
        <div style={{ display: 'flex', gap: '10px' }}>
          {[
            { id: 'light' as const, label: '普通' },
            { id: 'sepia' as const, label: '护眼' },
            { id: 'dark' as const, label: '夜间' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              style={{
                padding: '7px 18px',
                border: `1px solid ${theme === t.id ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-pill)',
                background: theme === t.id ? 'var(--accent-soft)' : 'none',
                color: theme === t.id ? 'var(--accent)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-sm)',
                cursor: 'pointer',
                transition: 'all var(--dur-fast)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Section>

      {/* Password */}
      <Section title="修改密码">
        <Field label="当前密码">
          <div style={{ position: 'relative' }}>
            <input type={showPwd ? 'text' : 'password'} value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} style={inputStyle} onFocus={focusIn} onBlur={focusOut} />
            <button type="button" onClick={() => setShowPwd(!showPwd)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
              {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>
        <Field label="新密码">
          <input type={showPwd ? 'text' : 'password'} value={newPwd} onChange={(e) => setNewPwd(e.target.value)} style={inputStyle} onFocus={focusIn} onBlur={focusOut} />
        </Field>
        <Field label="确认新密码">
          <input type={showPwd ? 'text' : 'password'} value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} style={inputStyle} onFocus={focusIn} onBlur={focusOut} />
        </Field>
        <button
          onClick={handleChangePwd}
          disabled={pwdLoading || !oldPwd || !newPwd || !confirmPwd}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            background: 'var(--accent)', border: '1px solid var(--accent)',
            borderRadius: 'var(--radius-pill)', padding: '7px 18px',
            fontSize: 'var(--text-sm)', color: 'var(--on-accent)',
            cursor: pwdLoading ? 'not-allowed' : 'pointer',
            opacity: pwdLoading || !oldPwd || !newPwd ? 0.6 : 1, fontFamily: 'var(--font-sans)',
          }}
        >
          {pwdLoading && <Spinner size={12} />} 修改密码
        </button>
      </Section>

      {/* LLM */}
      <Section title="大模型设置">
        <Field label="API Key" hint="填入你的大模型 API Key，保存后同步到账户，换设备登录即可直接使用">
          <div style={{ position: 'relative' }}>
            <input type={showKey ? 'text' : 'password'} value={llmKey} onChange={(e) => setLlmKey(e.target.value)} placeholder="sk-..." style={inputStyle} onFocus={focusIn} onBlur={focusOut} />
            <button type="button" onClick={() => setShowKey(!showKey)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p style={{ fontSize: 'var(--text-xs)', marginTop: '6px' }}>
            <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
              没有 API key？点此前往 DeepSeek 申请
            </a>
          </p>
        </Field>
        <Field label="模型名称" hint="自带 key 时留空默认 deepseek-chat（DeepSeek 官方）；用其他服务商请填对应模型名">
          <input type="text" value={llmModel} onChange={(e) => setLlmModel(e.target.value)} placeholder="deepseek-chat" style={inputStyle} onFocus={focusIn} onBlur={focusOut} />
        </Field>
        <Field label="模型 Base URL（可选）" hint="自带 key 时留空默认 https://api.deepseek.com（DeepSeek 官方）；用其他服务商请填其 Base URL">
          <input type="text" value={llmBase} onChange={(e) => setLlmBase(e.target.value)} placeholder="https://api.deepseek.com" style={inputStyle} onFocus={focusIn} onBlur={focusOut} />
        </Field>
        <button
          onClick={saveLlm}
          disabled={llmLoading}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            background: 'var(--accent)', border: '1px solid var(--accent)',
            borderRadius: 'var(--radius-pill)', padding: '7px 18px',
            fontSize: 'var(--text-sm)', color: 'var(--on-accent)',
            cursor: llmLoading ? 'not-allowed' : 'pointer',
            opacity: llmLoading ? 0.7 : 1, fontFamily: 'var(--font-sans)',
          }}
        >
          {llmLoading && <Spinner size={12} />}
          保存大模型设置
        </button>
      </Section>

      {/* Tone */}
      <Section title="AI 语气偏好">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
          {TONES.map((t) => (
            <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input
                type="radio"
                checked={tone === t.id}
                onChange={() => setTone(t.id)}
                style={{ accentColor: 'var(--accent)', width: 15, height: 15, cursor: 'pointer' }}
              />
              <div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{t.label}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{t.desc}</div>
              </div>
            </label>
          ))}
        </div>
        <button
          onClick={handleSaveTone}
          disabled={toneLoading}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            background: 'var(--accent)', border: '1px solid var(--accent)',
            borderRadius: 'var(--radius-pill)', padding: '7px 18px',
            fontSize: 'var(--text-sm)', color: 'var(--on-accent)',
            cursor: toneLoading ? 'not-allowed' : 'pointer',
            opacity: toneLoading ? 0.7 : 1, fontFamily: 'var(--font-sans)',
          }}
        >
          {toneLoading && <Spinner size={12} />} 保存偏好
        </button>
      </Section>

      {/* Import / Export */}
      <Section title="数据管理">
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={handleExport}
            disabled={exporting}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'none', border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-pill)', padding: '7px 16px',
              fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
              cursor: exporting ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)',
              opacity: exporting ? 0.7 : 1,
            }}
          >
            {exporting ? <Spinner size={12} /> : <Download size={13} aria-hidden />}
            导出数据
          </button>
          <label
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'none', border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-pill)', padding: '7px 16px',
              fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
              cursor: importing ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)',
              opacity: importing ? 0.7 : 1,
            }}
          >
            {importing ? <Spinner size={12} /> : <Upload size={13} aria-hidden />}
            导入数据
            <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} disabled={importing} />
          </label>
        </div>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: '10px' }}>导出为 JSON 格式，可用于备份或迁移数据。</p>
      </Section>

      {/* Help */}
      <Section title="使用说明">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {HELP_ITEMS.map((h) => (
            <div key={h.title}>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)', marginBottom: '3px' }}>
                {h.title}
              </div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>
                {h.body}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </PageContainer>
  )
}

const HELP_ITEMS: { title: string; body: string }[] = [
  { title: '添加任务', body: '在今日页输入框写下要做的事，点"整理"。系统判断是一件还是多件，生成草稿卡片，确认后入库。' },
  { title: '拆解大目标', body: '编辑任务时点"AI 拆解"，把大目标拆成一组子任务，确认后建成任务组。' },
  { title: '检索', body: '在检索页用自然语言描述你要找的任务，记不清原话也能找到。' },
  { title: '早间推荐 / 晚间总结', body: '今日页点"早间推荐"看今天先做什么，点"晚间总结"回顾一天。' },
  { title: '循环模板', body: '在模板页建好重复任务，到点自动生成，也可点"生成循环任务"立即生成。' },
  { title: '主题', body: '在上方"主题"切换普通、护眼、夜间。' },
  { title: '大模型 Key', body: '在本页"大模型设置"填入你的 API Key。留空则用服务端默认。' },
]
