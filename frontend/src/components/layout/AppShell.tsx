'use client'

import { AppSidebar } from './AppSidebar'
import { TopNavbar } from './TopNavbar'
import { SetupBanner } from './SetupBanner'

interface AppShellProps {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex h-screen overflow-hidden flex-col">
      <TopNavbar />
      <div className="flex flex-1 overflow-hidden">
        <AppSidebar />
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <SetupBanner />
          {children}
        </main>
      </div>
    </div>
  )
}
