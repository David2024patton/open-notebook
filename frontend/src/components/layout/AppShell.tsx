'use client'

import { AppSidebar } from './AppSidebar'
import { TopNavbar } from './TopNavbar'
import { SetupBanner } from './SetupBanner'
import { MobileNav } from './MobileNav'

interface AppShellProps {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex h-screen overflow-hidden flex-col">
      <TopNavbar />
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar - hidden on mobile */}
        <div className="hidden lg:block">
          <AppSidebar />
        </div>
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden overscroll-none pb-14 lg:pb-0">
          <SetupBanner />
          {children}
        </main>
        {/* Mobile bottom nav - hidden on desktop */}
        <MobileNav />
      </div>
    </div>
  )
}
