import axios from 'axios'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import apiClient from '@/lib/api/client'
import { getApiUrl } from '@/lib/config'

interface UserInfo {
  id: string
  username: string
  email?: string
  display_name?: string
  role: string
  avatar_url?: string
  avatar_color?: string
}

interface RegisterResult {
  success: boolean
  autoApproved: boolean
}

interface AuthState {
  isAuthenticated: boolean
  token: string | null
  user: UserInfo | null
  authMode: 'single-password' | 'multi-user' | null
  isLoading: boolean
  error: string | null
  lastAuthCheck: number | null
  isCheckingAuth: boolean
  hasHydrated: boolean
  authRequired: boolean | null
  requires2FA: boolean
  tempToken: string | null
  enforce2FA: boolean
  setHasHydrated: (state: boolean) => void
  checkAuthRequired: () => Promise<boolean>
  login: (password: string, email?: string) => Promise<boolean>
  verify2FA: (code: string) => Promise<boolean>
  register: (email: string, password: string, name?: string, referralCode?: string) => Promise<RegisterResult>
  requestCode: (email: string) => Promise<boolean>
  verifyCode: (email: string, code: string) => Promise<boolean>
  registerPasswordless: (email: string, name?: string) => Promise<RegisterResult>
  logout: () => void
  checkAuth: () => Promise<boolean>
  updateProfile: (data: { email?: string; display_name?: string }) => Promise<boolean>
  changePassword: (currentPassword: string, newPassword: string) => Promise<boolean>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      token: null,
      user: null,
      authMode: null,
      isLoading: false,
      error: null,
      lastAuthCheck: null,
      isCheckingAuth: false,
      hasHydrated: false,
      authRequired: null,
      requires2FA: false,
      tempToken: null,
      enforce2FA: false,

      setHasHydrated: (state: boolean) => {
        set({ hasHydrated: state })
      },

      checkAuthRequired: async () => {
        try {
          const response = await apiClient.get<{
            auth_enabled?: boolean
            auth_mode?: string
            enforce_2fa?: boolean
          }>('/auth/status', {
            headers: { 'Cache-Control': 'no-store' },
          })

          const data = response.data
          const authMode = data.auth_mode || 'single-password'
          const required = data.auth_enabled || false
          const enforce2FA = data.enforce_2fa || false
          
          set({ authRequired: required, authMode: authMode as 'single-password' | 'multi-user', enforce2FA })

          // If auth is not required, mark as authenticated
          if (!required) {
            set({ isAuthenticated: true, token: 'not-required' })
          }

          return required
        } catch (error) {
          console.error('Failed to check auth status:', error)

          if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
            set({
              error: 'Unable to connect to server. Please check if the API is running.',
              authRequired: null
            })
          } else {
            set({ authRequired: true })
          }

          throw error
        }
      },

      login: async (password: string, email?: string) => {
        set({ isLoading: true, error: null })
        try {
          const apiUrl = await getApiUrl()
          const state = get()

          // Multi-user mode: use email/password login
          if (state.authMode === 'multi-user') {
            if (!email) {
              set({ error: 'Email is required', isLoading: false })
              return false
            }

            const response = await fetch(`${apiUrl}/api/auth/login`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password }),
            })

            if (response.ok) {
              const data = await response.json()
              
              // Check if 2FA is required
              if (data.requires_2fa) {
                set({
                  requires2FA: true,
                  tempToken: data.temp_token,
                  isLoading: false,
                  error: null,
                })
                return false // Login not complete yet
              }
              
              set({
                isAuthenticated: true,
                token: data.access_token,
                user: data.user,
                isLoading: false,
                lastAuthCheck: Date.now(),
                error: null,
                requires2FA: false,
                tempToken: null,
              })
              return true
            } else {
              const errorData = await response.json()
              let errorMessage = 'Login failed'
              if (typeof errorData.detail === 'string') {
                errorMessage = errorData.detail
              } else if (Array.isArray(errorData.detail)) {
                errorMessage = errorData.detail.map((e: any) => e.msg || JSON.stringify(e)).join(', ')
              }
              set({
                error: errorMessage,
                isLoading: false,
                isAuthenticated: false,
                token: null,
                user: null,
              })
              return false
            }
          }

          // Single-password mode: original behavior
          const response = await fetch(`${apiUrl}/api/notebooks`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${password}`,
              'Content-Type': 'application/json'
            }
          })
          
          if (response.ok) {
            set({ 
              isAuthenticated: true, 
              token: password, 
              isLoading: false,
              lastAuthCheck: Date.now(),
              error: null
            })
            return true
          } else {
            let errorMessage = 'Authentication failed'
            if (response.status === 401) {
              errorMessage = 'Invalid password. Please try again.'
            } else if (response.status === 403) {
              errorMessage = 'Access denied. Please check your credentials.'
            } else if (response.status >= 500) {
              errorMessage = 'Server error. Please try again later.'
            } else {
              errorMessage = `Authentication failed (${response.status})`
            }
            
            set({ 
              error: errorMessage,
              isLoading: false,
              isAuthenticated: false,
              token: null
            })
            return false
          }
        } catch (error) {
          console.error('Network error during auth:', error)
          let errorMessage = 'Authentication failed'
          
          if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
            errorMessage = 'Unable to connect to server. Please check if the API is running.'
          } else if (error instanceof Error) {
            errorMessage = `Network error: ${error.message}`
          } else {
            errorMessage = 'An unexpected error occurred during authentication'
          }
          
          set({ 
            error: errorMessage,
            isLoading: false,
            isAuthenticated: false,
            token: null
          })
          return false
        }
      },

      verify2FA: async (code: string) => {
        set({ isLoading: true, error: null })
        const state = get()
        
        if (!state.tempToken) {
          set({ error: 'No pending 2FA verification', isLoading: false })
          return false
        }
        
        try {
          const apiUrl = await getApiUrl()
          const response = await fetch(`${apiUrl}/api/auth/login/2fa`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ temp_token: state.tempToken, code: code }),
          })
          
          if (response.ok) {
            const data = await response.json()
            set({
              isAuthenticated: true,
              token: data.access_token,
              user: data.user,
              isLoading: false,
              lastAuthCheck: Date.now(),
              error: null,
              requires2FA: false,
              tempToken: null,
            })
            return true
          } else {
            const errorData = await response.json()
            let errorMessage = 'Invalid 2FA code'
            if (typeof errorData.detail === 'string') {
              errorMessage = errorData.detail
            }
            set({ error: errorMessage, isLoading: false })
            return false
          }
        } catch (error) {
          console.error('2FA verification error:', error)
          set({ error: 'Network error during 2FA verification', isLoading: false })
          return false
        }
      },

      register: async (email: string, password: string, name?: string, referralCode?: string) => {
        set({ isLoading: true, error: null })
        try {
          const apiUrl = await getApiUrl()
          const state = get()

          if (state.authMode !== 'multi-user') {
            set({ error: 'Registration only available in multi-user mode', isLoading: false })
            return { success: false, autoApproved: false }
          }

          const body: Record<string, string> = { email, password }
          if (name) body.display_name = name
          if (referralCode) body.referral_code = referralCode

          const response = await fetch(`${apiUrl}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })

          if (response.ok) {
            const data = await response.json()
            set({ isLoading: false, error: null })
            return {
              success: true,
              autoApproved: data.status === 'approved' || data.status === 'auto_approved',
            }
          } else {
            const errorData = await response.json()
            let errorMessage = 'Registration failed'
            if (typeof errorData.detail === 'string') {
              errorMessage = errorData.detail
            } else if (Array.isArray(errorData.detail)) {
              errorMessage = errorData.detail.map((e: any) => e.msg || JSON.stringify(e)).join(', ')
            }
            set({
              error: errorMessage,
              isLoading: false,
            })
            return { success: false, autoApproved: false }
          }
        } catch (error) {
          console.error('Registration error:', error)
          set({
            error: 'Network error during registration',
            isLoading: false,
          })
          return { success: false, autoApproved: false }
        }
      },
      
      logout: () => {
        set({
          isAuthenticated: false,
          token: null,
          user: null,
          error: null
        })
      },

      // Passwordless OTP login: email -> code -> JWT (Phase 2.5+)
      requestCode: async (email: string) => {
        set({ isLoading: true, error: null })
        try {
          const apiUrl = await getApiUrl()
          const response = await fetch(`${apiUrl}/api/auth/request-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim().toLowerCase() }),
          })
          if (response.ok || response.status === 202) {
            set({ isLoading: false, error: null })
            return true
          }
          const errorData = await response.json().catch(() => ({}))
          const errorMessage = typeof errorData.detail === 'string'
            ? errorData.detail
            : 'Could not send code'
          set({ error: errorMessage, isLoading: false })
          return false
        } catch (error) {
          console.error('request-code error:', error)
          set({ error: 'Network error while requesting code', isLoading: false })
          return false
        }
      },

      verifyCode: async (email: string, code: string) => {
        set({ isLoading: true, error: null })
        try {
          const apiUrl = await getApiUrl()
          const response = await fetch(`${apiUrl}/api/auth/verify-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.trim() }),
          })
          if (response.ok) {
            const data = await response.json()
            set({
              isAuthenticated: true,
              token: data.access_token,
              user: data.user,
              isLoading: false,
              lastAuthCheck: Date.now(),
              error: null,
              requires2FA: false,
              tempToken: null,
            })
            return true
          }
          const errorData = await response.json().catch(() => ({}))
          const errorMessage = typeof errorData.detail === 'string'
            ? errorData.detail
            : 'Invalid or expired code'
          set({ error: errorMessage, isLoading: false })
          return false
        } catch (error) {
          console.error('verify-code error:', error)
          set({ error: 'Network error while verifying code', isLoading: false })
          return false
        }
      },

      registerPasswordless: async (email: string, name?: string) => {
        set({ isLoading: true, error: null })
        try {
          const apiUrl = await getApiUrl()
          const state = get()
          if (state.authMode !== 'multi-user') {
            set({ error: 'Registration only available in multi-user mode', isLoading: false })
            return { success: false, autoApproved: false }
          }
          const body: Record<string, string> = { email: email.trim().toLowerCase() }
          if (name) body.display_name = name
          const response = await fetch(`${apiUrl}/api/auth/register-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (response.ok || response.status === 202) {
            set({ isLoading: false, error: null })
            return { success: true, autoApproved: false }
          }
          const errorData = await response.json().catch(() => ({}))
          const errorMessage = typeof errorData.detail === 'string'
            ? errorData.detail
            : 'Registration failed'
          set({ error: errorMessage, isLoading: false })
          return { success: false, autoApproved: false }
        } catch (error) {
          console.error('register-passwordless error:', error)
          set({ error: 'Network error during registration', isLoading: false })
          return { success: false, autoApproved: false }
        }
      },

      updateProfile: async (data: { email?: string; display_name?: string }) => {
        set({ isLoading: true, error: null })
        try {
          const apiUrl = await getApiUrl()
          const state = get()

          if (state.authMode !== 'multi-user' || !state.token) {
            set({ error: 'Not authenticated', isLoading: false })
            return false
          }

          const response = await fetch(`${apiUrl}/api/auth/me`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${state.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
          })

          if (response.ok) {
            const userData = await response.json()
            set({ user: userData, isLoading: false, error: null })
            return true
          } else {
            const errorData = await response.json()
            let errorMessage = 'Update failed'
            if (typeof errorData.detail === 'string') {
              errorMessage = errorData.detail
            } else if (Array.isArray(errorData.detail)) {
              errorMessage = errorData.detail.map((e: any) => e.msg || JSON.stringify(e)).join(', ')
            }
            set({ error: errorMessage, isLoading: false })
            return false
          }
        } catch (error) {
          console.error('Profile update error:', error)
          set({ error: 'Network error', isLoading: false })
          return false
        }
      },

      changePassword: async (currentPassword: string, newPassword: string) => {
        set({ isLoading: true, error: null })
        try {
          const apiUrl = await getApiUrl()
          const state = get()

          if (state.authMode !== 'multi-user' || !state.token) {
            set({ error: 'Not authenticated', isLoading: false })
            return false
          }

          const response = await fetch(`${apiUrl}/api/auth/change-password`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${state.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
              current_password: currentPassword, 
              new_password: newPassword 
            }),
          })

          if (response.ok) {
            set({ isLoading: false, error: null })
            return true
          } else {
            const errorData = await response.json()
            let errorMessage = 'Password change failed'
            if (typeof errorData.detail === 'string') {
              errorMessage = errorData.detail
            } else if (Array.isArray(errorData.detail)) {
              errorMessage = errorData.detail.map((e: any) => e.msg || JSON.stringify(e)).join(', ')
            }
            set({ error: errorMessage, isLoading: false })
            return false
          }
        } catch (error) {
          console.error('Password change error:', error)
          set({ error: 'Network error', isLoading: false })
          return false
        }
      },
      
      checkAuth: async () => {
        const state = get()
        const { token, lastAuthCheck, isCheckingAuth, isAuthenticated, authMode } = state

        if (isCheckingAuth) {
          return isAuthenticated
        }

        if (!token) {
          return false
        }

        const now = Date.now()
        if (isAuthenticated && lastAuthCheck && (now - lastAuthCheck) < 30000) {
          return true
        }

        set({ isCheckingAuth: true })

        try {
          const apiUrl = await getApiUrl()

          // Multi-user mode: verify JWT token
          if (authMode === 'multi-user') {
            const response = await fetch(`${apiUrl}/api/auth/me`, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              }
            })
            
            if (response.ok) {
              const userData = await response.json()
              set({ 
                isAuthenticated: true, 
                user: userData,
                lastAuthCheck: now,
                isCheckingAuth: false 
              })
              return true
            } else {
              set({
                isAuthenticated: false,
                token: null,
                user: null,
                lastAuthCheck: null,
                isCheckingAuth: false
              })
              return false
            }
          }

          // Single-password mode: verify password works
          const response = await fetch(`${apiUrl}/api/notebooks`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          })
          
          if (response.ok) {
            set({ 
              isAuthenticated: true, 
              lastAuthCheck: now,
              isCheckingAuth: false 
            })
            return true
          } else {
            set({
              isAuthenticated: false,
              token: null,
              lastAuthCheck: null,
              isCheckingAuth: false
            })
            return false
          }
        } catch (error) {
          console.error('checkAuth error:', error)
          set({ 
            isAuthenticated: false, 
            token: null,
            user: null,
            lastAuthCheck: null,
            isCheckingAuth: false 
          })
          return false
        }
      }
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        user: state.user,
        authMode: state.authMode,
        enforce2FA: state.enforce2FA,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    }
  )
)
