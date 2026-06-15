'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/use-auth'
import { useAuthStore } from '@/lib/stores/auth-store'
import { getConfig } from '@/lib/config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlertCircle, Eye, EyeOff } from 'lucide-react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useTranslation } from '@/lib/hooks/use-translation'

export function LoginForm() {
  const { t, language } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [isRegistering, setIsRegistering] = useState(false)
  const [registrationSuccess, setRegistrationSuccess] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const { login, register, isLoading, error } = useAuth()
  const { authRequired, authMode, checkAuthRequired, hasHydrated, isAuthenticated } = useAuthStore()
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [configInfo, setConfigInfo] = useState<{ apiUrl: string; version: string; buildTime: string } | null>(null)
  const router = useRouter()

  // Load config info for debugging
  useEffect(() => {
    getConfig().then(cfg => {
      setConfigInfo({
        apiUrl: cfg.apiUrl,
        version: cfg.version,
        buildTime: cfg.buildTime,
      })
    }).catch(err => {
      console.error('Failed to load config:', err)
    })
  }, [])

  // Check if authentication is required on mount
  useEffect(() => {
    if (!hasHydrated) {
      return
    }

    const checkAuth = async () => {
      try {
        const required = await checkAuthRequired()

        // If auth is not required, redirect to notebooks
        if (!required) {
          router.push('/notebooks')
        }
      } catch (error) {
        console.error('Error checking auth requirement:', error)
      } finally {
        setIsCheckingAuth(false)
      }
    }

    // If we already know auth status, use it
    if (authRequired !== null) {
      if (!authRequired && isAuthenticated) {
        router.push('/notebooks')
      } else {
        setIsCheckingAuth(false)
      }
    } else {
      void checkAuth()
    }
  }, [hasHydrated, authRequired, checkAuthRequired, router, isAuthenticated])

  // Show loading while checking if auth is required
  if (!hasHydrated || isCheckingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LoadingSpinner />
      </div>
    )
  }

  // If we still don't know if auth is required (connection error), show error
  if (authRequired === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">{t('common.connectionError')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('common.unableToConnect')}
            </p>
          </div>

          <div className="flex items-start gap-2 text-red-600 text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              {error || t('auth.connectErrorHint')}
            </div>
          </div>

          {configInfo && (
            <div className="space-y-2 text-xs text-muted-foreground border-t pt-3">
              <div className="font-medium">{t('common.diagnosticInfo')}:</div>
              <div className="space-y-1 font-mono">
                <div>{t('common.version')}: {configInfo.version}</div>
                <div>{t('common.built')}: {new Date(configInfo.buildTime).toLocaleString(language === 'zh-CN' ? 'zh-CN' : language === 'zh-TW' ? 'zh-TW' : 'en-US')}</div>
                <div className="break-all">{t('common.apiUrl')}: {configInfo.apiUrl}</div>
                <div className="break-all">{t('common.frontendUrl')}: {typeof window !== 'undefined' ? window.location.href : 'N/A'}</div>
              </div>
              <div className="text-xs pt-2">
                {t('common.checkConsoleLogs')}
              </div>
            </div>
          )}

          <Button
            onClick={() => window.location.reload()}
            className="w-full"
          >
            {t('common.retryConnection')}
          </Button>
        </div>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (isRegistering) {
      // Handle registration
      if (username.trim() && password.trim() && email.trim()) {
        const result = await register(username, password, email || undefined, name || undefined, referralCode || undefined)
        if (result.success) {
          setRegistrationSuccess(true)
          setIsRegistering(false)
          setPassword('')
          setEmail('')
          setName('')
          setReferralCode('')
        }
      }
    } else {
      // Handle login
      if (authMode === 'multi-user') {
        if (email.trim() && password.trim()) {
          try {
            await login(email, password)
          } catch (error) {
            console.error('Unhandled error during login:', error)
          }
        }
      } else {
        // Single-password mode (email is ignored)
        if (password.trim()) {
          try {
            await login('', password)
          } catch (error) {
            console.error('Unhandled error during login:', error)
          }
        }
      }
    }
  }

  const toggleMode = () => {
    setIsRegistering(!isRegistering)
    setRegistrationSuccess(false)
    setPassword('')
    setEmail('')
    setName('')
    setReferralCode('')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {isRegistering ? t('auth.registerTitle') : t('auth.loginTitle')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isRegistering 
              ? t('auth.registerDesc')
              : t('auth.loginDesc')
            }
          </p>
        </div>

        {registrationSuccess && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-md text-green-700 text-sm">
            Registration successful! Please login with your credentials.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email field - for login in multi-user mode, or during registration */}
          {(authMode === 'multi-user' || isRegistering) && (
            <div>
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>
          )}

          {/* Username field - only during registration */}
          {isRegistering && (
            <div>
              <Input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>
          )}

          {/* Name field - only during registration */}
          {isRegistering && (
            <div>
              <Input
                type="text"
                placeholder="Display name (optional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isLoading}
              />
            </div>
          )}

          {/* Referral code field - only during registration */}
          {isRegistering && (
            <div>
              <Input
                type="text"
                placeholder="Referral code (optional, for instant access)"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value)}
                disabled={isLoading}
              />
            </div>
          )}

          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              placeholder={t('auth.passwordPlaceholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              required
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              tabIndex={-1}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>

          {error && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
              <p className="text-xs text-muted-foreground">
                If you just changed your password, try{' '}
                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem('auth-storage')
                    window.location.reload()
                  }}
                  className="underline hover:text-foreground"
                >
                  clearing browser data
                </button>
                {' '}or use an incognito window.
              </p>
            </div>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={isLoading || (authMode === 'multi-user' ? !email.trim() : false) || !password.trim()}
          >
            {isLoading 
              ? (isRegistering ? 'Registering...' : t('auth.signingIn'))
              : (isRegistering ? 'Register' : t('auth.signIn'))
            }
          </Button>

          {/* Toggle between login and registration in multi-user mode */}
          {authMode === 'multi-user' && (
            <div className="text-center">
              <button
                type="button"
                onClick={toggleMode}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                disabled={isLoading}
              >
                {isRegistering 
                  ? 'Already have an account? Login'
                  : "Don't have an account? Register"
                }
              </button>
            </div>
          )}

          {configInfo && (
            <div className="text-xs text-center text-muted-foreground pt-2 border-t">
              <div>{t('common.version')} {configInfo.version}</div>
              <div className="font-mono text-[10px]">{configInfo.apiUrl}</div>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
