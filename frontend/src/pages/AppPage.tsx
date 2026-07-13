import { useState, useEffect } from 'react'
import { AppShell, type SectionId } from '@/components/layout/AppShell'
import { useAppStore } from '@/store'
import { TodaySection } from './sections/TodaySection'
import { TasksSection } from './sections/TasksSection'
import { AgentSection } from './sections/AgentSection'
import { TemplatesSection } from './sections/TemplatesSection'
import { StatsSection } from './sections/StatsSection'
import { RecycleSection } from './sections/RecycleSection'
import { SettingsSection } from './sections/SettingsSection'
import { ConfirmHost } from '@/components/ui/ConfirmDialog'

export function AppPage() {
  const [section, setSection] = useState<SectionId>('today')
  const { navTarget, consumeNav } = useAppStore()

  // 跨页导航意图（如「今日」一键去「习惯」创建，Issue #12.4）。
  useEffect(() => {
    if (navTarget) {
      setSection(navTarget as SectionId)
      consumeNav()
    }
  }, [navTarget, consumeNav])

  function renderSection() {
    switch (section) {
      case 'today':     return <TodaySection />
      case 'tasks':     return <TasksSection />
      case 'agent':     return <AgentSection />
      case 'templates': return <TemplatesSection />
      case 'stats':     return <StatsSection />
      case 'recycle':   return <RecycleSection />
      case 'settings':  return <SettingsSection />
    }
  }

  return (
    <>
      <AppShell active={section} onNavigate={setSection}>
        {renderSection()}
      </AppShell>
      <ConfirmHost />
    </>
  )
}
