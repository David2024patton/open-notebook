'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/use-auth'
import { useAuthStore } from '@/lib/stores/auth-store'
import { getConfig } from '@/lib/config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlertCircle } from 'lucide-react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useTranslation } from '@/lib/hooks/use-translation'

type Stage = 'email' | 'code' | 'register'

export function LoginForm() {
  const { t, language } = useTranslation()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<Stage>('email')
  const [infoMsg, setInfoMsg] = useState<string | null>(null)
  const { requestCode, verifyCode, registerPasswordless, isLoading, error, authMode } = useAuth()
  const { authRequired, checkAuthRequired, hasHydrated, isAuthenticated } = useAuthStore()
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [configInfo, setConfigInfo] = useState<{ apiUrl: string; version: string; buildTime: string } | null>(null)
  const router = useRouter()

  useEffect(() => {
    getConfig()
      .then((cfg) => {
        setConfigInfo({ apiUrl: cfg.apiUrl, version: cfg.version, buildTime: cfg.buildTime })
      })
      .catch((err) => console.error('Failed to load config:', err))
  }, [])

  useEffect(() => {
    if (!hasHydrated) return
    const checkAuth = async () => {
      try {
        const required = await checkAuthRequired()
        if (!required) router.push('/notebooks')
      } catch (e) {
        console.error('Error checking auth requirement:', e)
      } finally {
        setIsCheckingAuth(false)
      }
    }
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

  if (!hasHydrated || isCheckingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LoadingSpinner />
      </div>
    )
  }

  if (authRequired === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">{t('common.connectionError')}</h1>
            <p className="text-sm text-muted-foreground">{t('common.unableToConnect')}</p>
          </div>
          <div className="flex items-start gap-2 text-red-600 text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">{error || t('auth.connectErrorHint')}</div>
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
            </div>
          )}
          <Button onClick={() => window.location.reload()} className="w-full">
            {t('common.retryConnection')}
          </Button>
        </div>
      </div>
    )
  }

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setInfoMsg(null)
    const ok = await requestCode(email.trim())
    if (ok) {
      setStage('code')
      setInfoMsg('A 6-digit code has been sent to your email. Enter it below.')
    }
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim()) return
    await verifyCode(email.trim(), code.trim())
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setInfoMsg(null)
    const result = await registerPasswordless(email.trim(), name || undefined)
    if (result.success) {
      setInfoMsg(
        'Your request was received. If admin approval is required, you will be able to log in once approved. If auto-approve is on, a code was sent to your email.'
      )
      setStage('code')
    }
  }

  const backToEmail = () => {
    setStage('email')
    setCode('')
    setInfoMsg(null)
  }

  const title =
    stage === 'email'
      ? t('auth.loginTitle')
      : stage === 'register'
        ? t('auth.registerTitle')
        : 'Enter your code'
  const desc =
    stage === 'email'
      ? t('auth.loginDesc')
      : stage === 'register'
        ? t('auth.registerDesc')
        : 'We sent a 6-digit code to your email'

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{desc}</p>
        </div>

        {infoMsg && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-blue-700 text-sm">
            {infoMsg}
          </div>
        )}

        {stage === 'email' && (
          <form onSubmit={handleSendCode} className="space-y-4">
            <div>
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                required
                autoComplete="email"
                autoFocus
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={isLoading || !email.trim()}>
              {isLoading ? 'Sending...' : 'Send code'}
            </Button>
            {authMode === 'multi-user' && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setStage('register')
                    setInfoMsg(null)
                    setEmail('')
                    setName('')
                  }}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  disabled={isLoading}
                >
                  Don&apos;t have an account? Request access
                </button>
              </div>
            )}
          </form>
        )}

        {stage === 'code' && (
          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <Input
                type="text"
                placeholder="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                disabled={isLoading}
                required
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={isLoading || !code.trim()}>
              {isLoading ? t('auth.signingIn') : 'Verify'}
            </Button>
            <div className="text-center space-y-1">
              <button
                type="button"
                onClick={() => requestCode(email.trim())}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                disabled={isLoading}
              >
                Resend code
              </button>
              <div>
                <button
                  type="button"
                  onClick={backToEmail}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  disabled={isLoading}
                >
                  Use a different email
                </button>
              </div>
            </div>
          </form>
        )}

        {stage === 'register' && (
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                required
                autoComplete="email"
                autoFocus
              />
            </div>
            <div>
              <Input
                type="text"
                placeholder="Display name (optional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isLoading}
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={isLoading || !email.trim()}>
              {isLoading ? 'Submitting...' : 'Request access'}
            </Button>
            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setStage('email')
                  setInfoMsg(null)
                }}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                disabled={isLoading}
              >
                Already have an account? Login
              </button>
            </div>
          </form>
        )}

        {configInfo && (
          <div className="text-xs text-center text-muted-foreground pt-2 border-t">
            <div>{t('common.version')} {configInfo.version}</div>
            <div className="font-mono text-[10px]">{configInfo.apiUrl}</div>
          </div>
        )}
      </div>
    </div>
  )
}