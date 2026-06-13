'use client'

import { useAuth } from '@/lib/hooks/use-auth'
import { useAuthStore } from '@/lib/stores/auth-store'
import { UserMenu } from '@/components/common/UserMenu'

export function TopNavbar() {
  const { user } = useAuth()
  const { authMode } = useAuthStore()

  const isMultiUser = authMode === 'multi-user'

  return (
    <div className="h-10 border-b bg-background flex items-center justify-end px-3 shrink-0 z-10">
      {isMultiUser && user && (
        <UserMenu />
      )}
    </div>
  )
}