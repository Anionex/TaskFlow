import { useMemo } from 'react'

interface Props {
  /** sparse [date(YYYY-MM-DD), count] pairs */
  data: [string, number][]
}

const WEEKS = 53
const CELL = 11
const GAP = 3

// Blue-ish accent ramp; empty is a faint neutral. color-mix adapts to theme + accent.
const LEVEL_BG = [
  'color-mix(in srgb, var(--text-muted) 15%, transparent)',
  'color-mix(in srgb, var(--accent) 30%, transparent)',
  'color-mix(in srgb, var(--accent) 50%, transparent)',
  'color-mix(in srgb, var(--accent) 72%, transparent)',
  'var(--accent)',
]

function fmt(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function level(c: number) {
  if (c <= 0) return 0
  if (c === 1) return 1
  if (c <= 3) return 2
  if (c <= 5) return 3
  return 4
}

interface Cell {
  key: string
  count: number
  future: boolean
  label: string
}

export function ContributionHeatmap({ data }: Props) {
  const { columns, monthLabels, total } = useMemo(() => {
    const counts = new Map(data)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Grid starts on the Sunday (WEEKS-1) weeks before this week's Sunday.
    const start = new Date(today)
    start.setDate(today.getDate() - today.getDay() - (WEEKS - 1) * 7)

    const columns: Cell[][] = []
    let total = 0
    for (let w = 0; w < WEEKS; w++) {
      const col: Cell[] = []
      for (let d = 0; d < 7; d++) {
        const date = new Date(start)
        date.setDate(start.getDate() + w * 7 + d)
        const key = fmt(date)
        const count = counts.get(key) ?? 0
        const future = date.getTime() > today.getTime()
        if (!future) total += count
        col.push({
          key,
          count,
          future,
          label: `${date.getMonth() + 1}月${date.getDate()}日 完成 ${count} 项`,
        })
      }
      columns.push(col)
    }

    // One label at each month boundary, but keep ≥3 columns between labels (a
    // "N月" label is ~2 cells wide) and skip the last column so nothing overlaps
    // or overflows the right edge.
    const MIN_GAP = 3
    const monthLabels: { col: number; label: string }[] = []
    // Seed with the leading (partial) month so it never gets its own label —
    // labels start at the first real month boundary.
    let prevMonth = Number(columns[0][0].key.slice(5, 7))
    let lastLabelCol = -MIN_GAP
    for (let i = 1; i < columns.length; i++) {
      const m = Number(columns[i][0].key.slice(5, 7))
      if (m !== prevMonth) {
        prevMonth = m
        if (i - lastLabelCol >= MIN_GAP && i <= WEEKS - 2) {
          monthLabels.push({ col: i, label: `${m}月` })
          lastLabelCol = i
        }
      }
    }
    return { columns, monthLabels, total }
  }, [data])

  const gridWidth = WEEKS * (CELL + GAP) - GAP

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '14px', gap: '12px' }}>
        <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)' }}>
          完成足迹
        </h2>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          过去一年完成 {total} 项
        </span>
      </div>

      <div style={{ overflowX: 'auto', paddingBottom: '4px' }}>
        <div style={{ width: gridWidth }}>
          {/* cells */}
          <div style={{ display: 'flex', gap: GAP }}>
            {columns.map((col, ci) => (
              <div key={ci} style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
                {col.map((cell, ri) =>
                  cell.future ? (
                    <div key={cell.key} style={{ width: CELL, height: CELL }} />
                  ) : (
                    <div
                      key={cell.key}
                      className="tf-tile"
                      title={cell.label}
                      style={{
                        width: CELL,
                        height: CELL,
                        borderRadius: 3,
                        background: LEVEL_BG[level(cell.count)],
                        animationDelay: `${(ci + ri) * 16}ms`,
                      }}
                    />
                  )
                )}
              </div>
            ))}
          </div>

          {/* month labels */}
          <div style={{ position: 'relative', height: 18, marginTop: 6 }}>
            {monthLabels.map((ml) => (
              <span
                key={ml.col}
                style={{
                  position: 'absolute',
                  left: ml.col * (CELL + GAP),
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                }}
              >
                {ml.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end', marginTop: '6px' }}>
        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>少</span>
        {LEVEL_BG.map((bg, i) => (
          <span key={i} style={{ width: 11, height: 11, borderRadius: 3, background: bg }} />
        ))}
        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>多</span>
      </div>
    </div>
  )
}
