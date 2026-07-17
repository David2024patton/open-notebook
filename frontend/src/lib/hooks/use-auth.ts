'use client'

import { useAuthStore } from '@/lib/stores/auth-store'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export function useAuth() {
  const router = useRouter()
  const {
    isAuthenticated,
    isLoading,
    user,
    login,
    logout,
    checkAuth,
    checkAuthRequired,
    error,
    hasHydrated,
    authRequired,
    register,
    authMode,
    requires2FA,
    verify2FA,
  } = useAuthStore()

  useEffect(() => {
    // Only check auth after the store has hydrated from localStorage
    if (hasHydrated) {
      // First check if auth is required
      if (authRequired === null) {
        checkAuthRequired().then((required) => {
          // If auth is required, check if we have valid credentials
          if (required) {
            checkAuth()
          }
        })
      } else if (authRequired) {
        // Auth is required, check credentials
        checkAuth()
      }
      // If authRequired === false, we're already authenticated (set in checkAuthRequired)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated, authRequired])

  const handleLogin = async (email: string, password: string) => {
    // Single-password mode ignores email
    const success = await login(password)
    if (success) {
      // Check if there's a stored redirect path
      const redirectPath = sessionStorage.getItem('redirectAfterLogin')
      if (redirectPath) {
        sessionStorage.removeItem('redirectAfterLogin')
        router.push(redirectPath)
      } else {
        router.push('/notebooks')
      }
    }
    return success
  }

  const handleMultiUserLogin = async (email: string, password: string) => {
    const success = await login(password, email)
    if (success) {
      const redirectPath = sessionStorage.getItem('redirectAfterLogin')
      if (redirectPath) {
        sessionStorage.removeItem('redirectAfterLogin')
        router.push(redirectPath)
      } else {
        router.push('/notebooks')
      }
    }
    return success
  }

  const handleRegister = async (
    email: string,
    password: string,
    name?: string,
    referralCode?: string
  ) => {
    const result = await register(email, password, name, referralCode)
    if (result.autoApproved) {
      const success = await login(email, password)
      if (success) {
        router.push('/notebooks')
      }
    }
    return result
  }

  const handleVerify2FA = async (code: string) => {
    const success = await verify2FA(code)
    if (success) {
      const redirectPath = sessionStorage.getItem('redirectAfterLogin')
      if (redirectPath) {
        sessionStorage.removeItem('redirectAfterLogin')
        router.push(redirectPath)
      } else {
        router.push('/notebooks')
      }
    }
    return success
  }

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  return {
    isAuthenticated,
    isLoading: isLoading || !hasHydrated,
    user,
    error,
    login: async (email: string, password: string) => {
      if (authMode === 'single-password') {
        return handleLogin(email, password)
      }
      return handleMultiUserLogin(email, password)
    },
    register: handleRegister,
    logout: handleLogout,
    authMode,
    requires2FA,
    verify2FA: handleVerify2FA,
  }
}