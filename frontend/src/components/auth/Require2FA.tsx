'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/lib/stores/auth-store'
import { getApiUrl } from '@/lib/config'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

interface Require2FAProps {
  children: React.ReactNode
}

export function Require2FA({ children }: Require2FAProps) {
  const { token, user, enforce2FA } = useAuthStore()
  const router = useRouter()
  const pathname = usePathname()
  const [checking, setChecking] = useState(true)
  const [has2FA, setHas2FA] = useState(true) // Assume true until checked

  useEffect(() => {
    const check2FA = async () => {
      // Skip check if not in multi-user mode or not authenticated
      if (!token || !user || !enforce2FA) {
        setChecking(false)
        return
      }

      // Skip check if already on the security settings page
      if (pathname === '/settings/profile') {
        setChecking(false)
        return
      }

      try {
        const apiUrl = await getApiUrl()
        const res = await fetch(`${apiUrl}/api/auth/2fa/enforced`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (res.ok) {
          const data = await res.json()
          setHas2FA(data.enabled)
          
          // If 2FA is enforced but not enabled, redirect to settings
          if (data.enforced && !data.enabled) {
            router.push('/settings/profile')
            return
          }
        }
      } catch {
        // Silently fail - don't block access
      }

      setChecking(false)
    }

    check2FA()
  }, [token, user, enforce2FA, pathname, router])

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return <>{children}</>
}
