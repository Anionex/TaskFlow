import { ReactNode, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sun, Leaf, Moon, LogOut, ChevronRight, Menu, X,
  CalendarDays, CheckSquare, Repeat, BarChart2, Trash2, Settings, Bot
} from 'lucide-react'
import { useAppStore } from '@/store'
import { authApi } from '@/api/auth'
import { useIsMobile } from '@/lib/useIsMobile'
import { Logo } from '@/components/ui/Logo'

export type SectionId = 'today' | 'tasks' | 'agent' | 'templates' | 'stats' | 'recycle' | 'settings'

interface NavItem {
  id: SectionId
  label: string
  icon: ReactNode
}

const NAV: NavItem[] = [
  { id: 'today',     label: '今日',   icon: <CalendarDays size={15} aria-hidden /> },
  { id: 'tasks',     label: '任务',   icon: <CheckSquare size={15} aria-hidden /> },
  { id: 'agent',     label: '助理',   icon: <Bot size={15} aria-hidden /> },
  { id: 'templates', label: '习惯',   icon: <Repeat size={15} aria-hidden /> },
  { id: 'stats',     label: '统计',   icon: <BarChart2 size={15} aria-hidden /> },
  { id: 'recycle',   label: '回收站', icon: <Trash2 size={15} aria-hidden /> },
  { id: 'settings',  label: '设置',   icon: <Settings size={15} aria-hidden /> },
]

interface Props {
  active: SectionId
  onNavigate: (id: SectionId) => void
  children: ReactNode
}

export function AppShell({ active, onNavigate, children }: Props) {
  const { theme, setTheme, phone, clearSession } = useAppStore()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [loggingOut, setLoggingOut] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // On mobile the sidebar is a slide-in drawer; the desktop collapse state is ignored.
  const sidebarCollapsed = isMobile ? false : collapsed

  function handleNavigate(id: SectionId) {
    onNavigate(id)
    if (isMobile) setDrawerOpen(false)
  }

  const themeItems: { id: 'light' | 'sepia' | 'dark'; label: string; icon: ReactNode }[] = [
    { id: 'light', label: '普通', icon: <Sun size={13} aria-hidden /> },
    { id: 'sepia', label: '护眼', icon: <Leaf size={13} aria-hidden /> },
    { id: 'dark',  label: '夜间', icon: <Moon size={13} aria-hidden /> },
  ]

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await authApi.logout()
    } catch {/* ignore */}
    clearSession()
    navigate('/login')
  }

  const asideStyle: React.CSSProperties = isMobile
    ? {
        position: 'fixed',
        top: 0, bottom: 0, left: 0,
        width: 220,
        zIndex: 50,
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface-0)',
        overflow: 'hidden',
        transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform var(--dur-base) var(--ease-out)',
        boxShadow: drawerOpen ? 'var(--shadow-pop)' : 'none',
      }
    : {
        width: sidebarCollapsed ? 56 : 200,
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width var(--dur-base) var(--ease-out)',
        background: 'var(--surface-0)',
        overflow: 'hidden',
      }

  return (
    // 整体锁定一屏高、外层不滚动：侧栏固定，只有右侧 main 内部滚动（item 4）。
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--surface-0)' }}>
      {/* Mobile top bar */}
      {isMobile && (
        <header style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40,
          height: 52, display: 'flex', alignItems: 'center', gap: '10px',
          padding: '0 14px', background: 'var(--surface-0)',
          borderBottom: '1px solid var(--border)',
        }}>
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="打开菜单"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: '4px' }}
          >
            <Menu size={20} />
          </button>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
            <Logo size={20} />
            <span style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--fw-medium)', color: 'var(--accent)', letterSpacing: '-0.3px' }}>
              TaskFlow
            </span>
          </span>
        </header>
      )}

      {/* Mobile drawer backdrop */}
      {isMobile && drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 45, background: 'rgba(0,0,0,0.4)' }}
        />
      )}

      {/* Sidebar */}
      <aside style={asideStyle}>
        {/* Logo */}
        <div style={{
          padding: sidebarCollapsed ? '20px 16px 16px' : '20px 20px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          justifyContent: sidebarCollapsed ? 'center' : 'space-between',
          minHeight: 60,
        }}>
          {sidebarCollapsed ? (
            <button
              onClick={() => setCollapsed(false)}
              aria-label="展开侧边栏"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
            >
              <Logo size={24} />
            </button>
          ) : (
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <Logo size={22} />
                <span style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--fw-medium)', color: 'var(--accent)', letterSpacing: '-0.3px' }}>
                  TaskFlow
                </span>
              </span>
              <button
                onClick={() => (isMobile ? setDrawerOpen(false) : setCollapsed(true))}
                aria-label={isMobile ? '关闭菜单' : '收起侧边栏'}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', padding: '4px',
                  display: 'flex', alignItems: 'center',
                  transform: isMobile ? 'none' : 'rotate(180deg)',
                  transition: 'transform var(--dur-base)',
                }}
              >
                {isMobile ? <X size={17} /> : <ChevronRight size={15} />}
              </button>
            </>
          )}
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
          {NAV.map((item) => {
            const isActive = active === item.id
            return (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '9px',
                  padding: sidebarCollapsed ? '9px 0' : '9px 20px',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  background: isActive ? 'var(--accent-soft)' : 'none',
                  border: 'none',
                  borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                  cursor: 'pointer',
                  color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                  fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: isActive ? 'var(--fw-medium)' : 'var(--fw-regular)',
                  transition: 'background var(--dur-fast), color var(--dur-fast)',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.icon}
                {!sidebarCollapsed && item.label}
              </button>
            )
          })}
        </nav>

        {/* Bottom: theme + user */}
        <div style={{ borderTop: '1px solid var(--border)', padding: sidebarCollapsed ? '12px 8px' : '12px 16px' }}>
          {/* Theme switcher */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '10px', justifyContent: sidebarCollapsed ? 'center' : 'flex-start' }}>
            {themeItems.map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                aria-label={`切换到${t.label}模式`}
                title={t.label}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 28, height: 28,
                  borderRadius: 'var(--radius-pill)',
                  border: theme === t.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                  background: theme === t.id ? 'var(--accent-soft)' : 'none',
                  color: theme === t.id ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  transition: 'all var(--dur-fast)',
                }}
              >
                {t.icon}
              </button>
            ))}
          </div>

          {/* User */}
          {!sidebarCollapsed && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{phone}</span>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                aria-label="退出登录"
                title="退出登录"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: '2px' }}
              >
                <LogOut size={13} />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflowY: 'auto', minWidth: 0, paddingTop: isMobile ? 52 : 0 }}>
        {children}
      </main>
    </div>
  )
}
