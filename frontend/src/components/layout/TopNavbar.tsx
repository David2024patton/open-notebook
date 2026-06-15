'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useAuth } from '@/lib/hooks/use-auth'
import { useAuthStore } from '@/lib/stores/auth-store'
import { UserMenu } from '@/components/common/UserMenu'
import { useTranslation } from '@/lib/hooks/use-translation'

export function TopNavbar() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { authMode } = useAuthStore()

  const isMultiUser = authMode === 'multi-user'

  return (
    <div className="h-12 border-b bg-background flex items-center justify-between px-4 shrink-0 z-10">
      {/* Branding - visible on both mobile and desktop */}
      <Link href="/notebooks" className="flex items-center gap-2">
        <Image src="/logo.svg" alt={t('common.appName')} width={28} height={28} />
        <span className="text-sm font-medium text-foreground hidden sm:inline">
          {t('common.appName')}
        </span>
      </Link>
      
      {/* Right side - user menu */}
      <div className="flex items-center gap-2">
        {isMultiUser && user && (
          <UserMenu />
        )}
      </div>
    </div>
  )
}