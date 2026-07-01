import { useState, useEffect, useRef } from 'react'
import { Spinner } from '@/components/ui/Spinner'
import { PageContainer } from '@/components/layout/PageContainer'
import { userApi } from '@/api/user'
import { useAppStore } from '@/store'
import { useIsMobile } from '@/lib/useIsMobile'
import type { UserStats } from '@/types'

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

// We load Chart.js via dynamic import to avoid SSR issues
let Chart: any = null

async function ensureChart() {
  if (!Chart) {
    const m = await import('chart.js')
    const { Chart: C, ArcElement, DoughnutController, BarElement, BarController, CategoryScale, LinearScale, Tooltip, Legend } = m
    C.register(ArcElement, DoughnutController, BarElement, BarController, CategoryScale, LinearScale, Tooltip, Legend)
    Chart = C
  }
  return Chart
}

export function StatsSection() {
  const theme = useAppStore((s) => s.theme)
  const isMobile = useIsMobile()
  const [stats, setStats] = useState<UserStats | null>(null)
  const [loading, setLoading] = useState(true)
  const pieRef = useRef<HTMLCanvasElement>(null)
  const barRef = useRef<HTMLCanvasElement>(null)
  const pieChart = useRef<any>(null)
  const barChart = useRef<any>(null)

  useEffect(() => {
    load()
    return () => {
      pieChart.current?.destroy()
      barChart.current?.destroy()
    }
  }, [])

  // Re-render charts when data or theme changes (theme swaps the colors).
  useEffect(() => {
    if (stats) renderCharts()
  }, [stats, theme])

  async function load() {
    setLoading(true)
    const res = await userApi.stats()
    if (res.success && res.data) setStats(res.data)
    setLoading(false)
  }

  async function renderCharts() {
    const C = await ensureChart()
    const s = stats!
    const textSecondary = cssVar('--text-secondary', '#565651')
    const textMuted = cssVar('--text-muted', '#8A8A83')
    const borderColor = cssVar('--border', 'rgba(24,24,16,.10)')
    const accentColor = cssVar('--accent', '#4742B8')
    const hasPieData = s.completed + s.pending + s.expired > 0
    const hasBarData = !!s.monthly_completed?.length

    // 先无条件销毁旧实例，避免主题切换/数据从有到无时泄漏或 "Canvas is already in use"。
    pieChart.current?.destroy()
    pieChart.current = null
    barChart.current?.destroy()
    barChart.current = null

    // Pie chart
    if (pieRef.current && hasPieData) {
      const ctx = pieRef.current.getContext('2d')!
      pieChart.current = new C(ctx, {
        type: 'doughnut',
        data: {
          labels: ['已完成', '待办', '已过期'],
          datasets: [{
            data: [s.completed, s.pending, s.expired],
            backgroundColor: [
              cssVar('--success', '#2F6B45'),
              accentColor,
              cssVar('--danger', '#A8331F'),
            ],
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
          layout: { padding: { top: 4, bottom: 4 } },
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                boxWidth: 12,
                boxHeight: 12,
                padding: 14,
                font: { size: 12 },
                color: textSecondary,
                usePointStyle: true,
              },
            },
            tooltip: { enabled: true },
          },
        },
      })
    }

    // Bar chart
    if (barRef.current && hasBarData) {
      const ctx = barRef.current.getContext('2d')!
      barChart.current = new C(ctx, {
        type: 'bar',
        data: {
          labels: s.monthly_completed.map(([m]) => m),
          datasets: [{
            label: '完成数',
            data: s.monthly_completed.map(([, v]) => v),
            backgroundColor: accentColor + '90',
            borderColor: accentColor,
            borderWidth: 1,
            borderRadius: 3,
            maxBarThickness: 36,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { enabled: true },
          },
          scales: {
            x: {
              ticks: { color: textMuted, font: { size: 11 } },
              grid: { display: false },
              border: { color: borderColor },
            },
            y: {
              beginAtZero: true,
              ticks: { color: textMuted, font: { size: 11 }, precision: 0 },
              grid: { color: borderColor },
              border: { display: false },
            },
          },
        },
      })
    }
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '80px' }}><Spinner size={24} /></div>
  if (!stats) return null

  // 挂载闸与绘制闸用同一条件，避免挂了空 canvas。
  const hasPieData = stats.completed + stats.pending + stats.expired > 0

  return (
    <PageContainer>
      <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--fw-medium)', marginBottom: '32px', color: 'var(--text-primary)' }}>统计</h1>

      {/* Summary numbers */}
      <div style={{ display: 'flex', flexWrap: 'wrap', rowGap: '20px', gap: isMobile ? '0' : '32px', marginBottom: isMobile ? '32px' : '40px', paddingBottom: '28px', borderBottom: '1px solid var(--border)' }}>
        {[
          { label: '总计', value: stats.total, color: 'var(--text-primary)' },
          { label: '已完成', value: stats.completed, color: 'var(--success)' },
          { label: '待办', value: stats.pending, color: 'var(--accent)' },
          { label: '已过期', value: stats.expired, color: 'var(--danger)' },
        ].map((item) => (
          <div key={item.label} style={isMobile ? { flex: '0 0 50%' } : undefined}>
            <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--fw-medium)', color: item.color, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
              {item.value}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: '5px' }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 320px) minmax(0, 1fr)',
        gap: isMobile ? '32px' : '48px',
        alignItems: 'start',
      }}>
        {/* Pie */}
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)', marginBottom: '16px' }}>
            任务分布
          </h2>
          {hasPieData ? (
            <div style={{ position: 'relative', height: isMobile ? 240 : 280, width: '100%' }}>
              <canvas ref={pieRef} />
            </div>
          ) : (
            <p style={{ fontFamily: 'var(--font-voice)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>暂无任务数据</p>
          )}
        </div>

        {/* Bar */}
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)', marginBottom: '16px' }}>
            近 12 月完成趋势
          </h2>
          {stats.monthly_completed?.length ? (
            <div style={{ position: 'relative', height: isMobile ? 240 : 280, width: '100%' }}>
              <canvas ref={barRef} />
            </div>
          ) : (
            <p style={{ fontFamily: 'var(--font-voice)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>暂无完成数据</p>
          )}
        </div>
      </div>
    </PageContainer>
  )
}
