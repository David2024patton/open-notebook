'use client'

import { useState, useEffect, useRef } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { useAuthStore } from '@/lib/stores/auth-store'
import { getApiUrl } from '@/lib/config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Upload, Check, Palette, Shield, ShieldCheck, ShieldOff, Copy, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#22c55e', '#06b6d4', '#3b82f6',
]

const DICEBEAR_STYLES = [
  'adventurer',
  'adventurer-neutral',
  'avataaars',
  'big-ears',
  'big-ears-neutral',
  'big-smile',
  'bots',
  'croodles',
  'croodles-neutral',
  'fun-emoji',
  'icons',
  'identicon',
  'initials',
  'lorelei',
  'lorelei-neutral',
  'micah',
  'miniavs',
  'notionists',
  'notionists-neutral',
  'open-peeps',
  'personas',
  'pixel-art',
  'pixel-art-neutral',
  'rings',
  'shapes',
  'thumbs',
]

interface UserProfile {
  id: string
  username: string
  email?: string
  display_name?: string
  role: string
  avatar_url?: string
  avatar_color?: string
}

export default function ProfileSettingsPage() {
  const { token, user, enforce2FA } = useAuthStore()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [selectedColor, setSelectedColor] = useState(AVATAR_COLORS[0])
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [avatarType, setAvatarType] = useState<'initials' | 'dicebear' | 'upload'>('initials')
  const [selectedStyle, setSelectedStyle] = useState('adventurer')
  const [isSaving, setIsSaving] = useState(false)
  const [activeSection, setActiveSection] = useState<'avatar' | 'profile' | 'security'>('avatar')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 2FA state
  const [totpEnabled, setTotpEnabled] = useState(false)
  const [totpConfigured, setTotpConfigured] = useState(false)
  const [totpSecret, setTotpSecret] = useState('')
  const [totpQrCode, setTotpQrCode] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [totpLoading, setTotpLoading] = useState(false)
  const [showTotpSecret, setShowTotpSecret] = useState(false)

  useEffect(() => {
    if (user) {
      setProfile(user)
      setDisplayName(user.display_name || '')
      setEmail(user.email || '')
      setSelectedColor(user.avatar_color || AVATAR_COLORS[0])
      setSelectedImage(user.avatar_url || null)
      if (user.avatar_url) {
        if (user.avatar_url.includes('dicebear.com')) {
          setAvatarType('dicebear')
          const styleMatch = user.avatar_url.match(/dicebear\.com\/7\.x\/([^/]+)\//)
          if (styleMatch) setSelectedStyle(styleMatch[1])
        } else {
          setAvatarType('upload')
        }
      }
    }
  }, [user])

  // Fetch 2FA status on mount
  useEffect(() => {
    const fetch2FAStatus = async () => {
      if (!token) return
      try {
        const apiUrl = await getApiUrl()
        const res = await fetch(`${apiUrl}/api/auth/2fa/status`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          const data = await res.json()
          setTotpEnabled(data.enabled)
          setTotpConfigured(data.configured)
        }
      } catch {
        // Silently fail
      }
    }
    fetch2FAStatus()
  }, [token])

  const getAvatarUrl = () => {
    if (avatarType === 'dicebear') {
      const seed = profile?.username || 'user'
      return `https://api.dicebear.com/7.x/${selectedStyle}/svg?seed=${seed}`
    }
    if (avatarType === 'upload' && selectedImage) {
      return selectedImage
    }
    return null
  }

  const getInitials = () => {
    const name = profile?.display_name || profile?.username || 'U'
    const parts = name.split(' ').filter(Boolean)
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase()
    }
    return name.slice(0, 2).toUpperCase()
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 500 * 1024) {
      toast.error('Image must be under 500KB')
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      setSelectedImage(event.target?.result as string)
      setAvatarType('upload')
    }
    reader.readAsDataURL(file)
  }

  const saveAvatar = async () => {
    if (!token) return
    setIsSaving(true)
    try {
      const apiUrl = await getApiUrl()
      const avatarUrl = getAvatarUrl()
      const res = await fetch(`${apiUrl}/api/auth/me/avatar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          avatar_url: avatarUrl,
          avatar_color: selectedColor,
        }),
      })
      if (res.ok) {
        toast.success('Avatar updated!')
        window.location.reload()
      } else {
        toast.error('Failed to save avatar')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setIsSaving(false)
    }
  }

  const saveProfile = async () => {
    if (!token) return
    setIsSaving(true)
    try {
      const apiUrl = await getApiUrl()
      const res = await fetch(`${apiUrl}/api/auth/me`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ display_name: displayName, email }),
      })
      if (res.ok) {
        toast.success('Profile updated!')
      } else {
        toast.error('Failed to save profile')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setIsSaving(false)
    }
  }

  const changePassword = async () => {
    if (!token || !currentPassword || !newPassword) {
      toast.error('Please fill in both password fields')
      return
    }
    setIsSaving(true)
    try {
      const apiUrl = await getApiUrl()
      const res = await fetch(`${apiUrl}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      })
      if (res.ok) {
        toast.success('Password changed!')
        setCurrentPassword('')
        setNewPassword('')
      } else {
        const data = await res.json()
        toast.error(data.detail || 'Failed to change password')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setIsSaving(false)
    }
  }

  // 2FA Setup
  const setup2FA = async () => {
    if (!token) return
    setTotpLoading(true)
    try {
      const apiUrl = await getApiUrl()
      const res = await fetch(`${apiUrl}/api/auth/2fa/setup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setTotpSecret(data.secret)
        setTotpQrCode(data.qr_code)
        setTotpConfigured(true)
        toast.success('Scan the QR code with your authenticator app')
      } else {
        const data = await res.json()
        toast.error(data.detail || 'Failed to setup 2FA')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setTotpLoading(false)
    }
  }

  // 2FA Verify & Enable
  const verify2FA = async () => {
    if (!token || !totpCode) {
      toast.error('Please enter the 6-digit code')
      return
    }
    setTotpLoading(true)
    try {
      const apiUrl = await getApiUrl()
      const res = await fetch(`${apiUrl}/api/auth/2fa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: totpCode }),
      })
      if (res.ok) {
        setTotpEnabled(true)
        setTotpCode('')
        toast.success('Two-factor authentication enabled!')
      } else {
        const data = await res.json()
        toast.error(data.detail || 'Invalid code')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setTotpLoading(false)
    }
  }

  // 2FA Disable
  const disable2FA = async () => {
    if (!token || !currentPassword) {
      toast.error('Please enter your current password to disable 2FA')
      return
    }
    setTotpLoading(true)
    try {
      const apiUrl = await getApiUrl()
      const res = await fetch(`${apiUrl}/api/auth/2fa/disable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ current_password: currentPassword }),
      })
      if (res.ok) {
        setTotpEnabled(false)
        setTotpConfigured(false)
        setTotpSecret('')
        setTotpQrCode('')
        setCurrentPassword('')
        toast.success('Two-factor authentication disabled')
      } else {
        const data = await res.json()
        toast.error(data.detail || 'Failed to disable 2FA')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setTotpLoading(false)
    }
  }

  const copyTotpSecret = () => {
    navigator.clipboard.writeText(totpSecret)
    toast.success('Secret copied to clipboard')
  }

  const avatarUrl = getAvatarUrl()
  const initials = getInitials()

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          <div className="max-w-2xl space-y-6">
            <div className="flex items-center gap-4">
              <Link href="/settings" className="p-2 hover:bg-muted rounded-md transition-colors">
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold">Profile Settings</h1>
                <p className="text-sm text-muted-foreground">Manage your avatar, display name, and password</p>
              </div>
            </div>

            <div className="flex gap-1 border-b">
              <button
                onClick={() => setActiveSection('avatar')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeSection === 'avatar'
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                Avatar
              </button>
              <button
                onClick={() => setActiveSection('profile')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeSection === 'profile'
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                Profile
              </button>
              <button
                onClick={() => setActiveSection('security')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                  activeSection === 'security'
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Shield className="h-3.5 w-3.5" />
                Security
              </button>
            </div>

            {/* 2FA Enforcement Warning */}
            {enforce2FA && !totpEnabled && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <div className="flex items-start gap-3">
                  <Shield className="h-5 w-5 text-amber-500 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-600 dark:text-amber-400">
                      Two-Factor Authentication Required
                    </p>
                    <p className="text-sm text-amber-600/80 dark:text-amber-400/80 mt-1">
                      Your administrator requires 2FA to be enabled. Please set it up in the Security tab below.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'avatar' && (
              <div className="space-y-6">
                <div className="flex justify-center">
                  <div
                    className="h-32 w-32 rounded-full flex items-center justify-center text-white font-bold text-4xl overflow-hidden border-4 border-white dark:border-gray-700 shadow-lg"
                    style={{ backgroundColor: avatarUrl ? 'transparent' : selectedColor }}
                  >
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      initials
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium mb-3 block">Avatar Style</Label>
                    <div className="flex gap-2 mb-3">
                      <Button
                        variant={avatarType === 'initials' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setAvatarType('initials')}
                      >
                        Initials
                      </Button>
                      <Button
                        variant={avatarType === 'dicebear' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setAvatarType('dicebear')}
                      >
                        Characters
                      </Button>
                      <Button
                        variant={avatarType === 'upload' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setAvatarType('upload')}
                      >
                        <Upload className="h-4 w-4 mr-1" />
                        Upload
                      </Button>
                    </div>

                    {avatarType === 'dicebear' && (
                      <div className="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto p-2 border rounded-lg">
                        {DICEBEAR_STYLES.map((style) => (
                          <button
                            key={style}
                            onClick={() => setSelectedStyle(style)}
                            className={`p-2 rounded-lg border transition-all hover:bg-muted ${
                              selectedStyle === style ? 'border-foreground bg-muted' : ''
                            }`}
                          >
                            <img
                              src={`https://api.dicebear.com/7.x/${style}/svg?seed=${profile?.username || 'user'}`}
                              alt={style}
                              className="w-full h-auto rounded"
                              loading="lazy"
                            />
                            <span className="text-[10px] text-muted-foreground mt-1 block truncate">{style}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {avatarType === 'upload' && (
                      <div className="space-y-2">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleImageUpload}
                        />
                        <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full">
                          <Upload className="h-4 w-4 mr-2" />
                          Choose Image (max 500KB)
                        </Button>
                      </div>
                    )}
                  </div>

                  <div>
                    <Label className="text-sm font-medium mb-3 block">
                      <Palette className="h-4 w-4 mr-1 inline" />
                      Background Color {avatarType === 'initials' ? '' : '(for initials fallback)'}
                    </Label>
                    <div className="grid grid-cols-8 gap-2">
                      {AVATAR_COLORS.map((color) => (
                        <button
                          key={color}
                          onClick={() => setSelectedColor(color)}
                          className={`h-10 w-10 rounded-full transition-transform hover:scale-110 ${
                            selectedColor === color ? 'ring-2 ring-offset-2 ring-foreground' : ''
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <Button onClick={saveAvatar} disabled={isSaving} className="w-full">
                  {isSaving ? 'Saving...' : 'Save Avatar'}
                </Button>
              </div>
            )}

            {activeSection === 'profile' && (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="displayName">Display Name</Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your display name"
                  />
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                  />
                </div>
                <Button onClick={saveProfile} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save Profile'}
                </Button>
              </div>
            )}

            {activeSection === 'security' && (
              <div className="space-y-8">
                {/* Password Change Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Change Password</h3>
                  <div>
                    <Label htmlFor="currentPassword">Current Password</Label>
                    <Input
                      id="currentPassword"
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                  </div>
                  <div>
                    <Label htmlFor="newPassword">New Password</Label>
                    <Input
                      id="newPassword"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </div>
                  <Button onClick={changePassword} disabled={isSaving}>
                    {isSaving ? 'Changing...' : 'Change Password'}
                  </Button>
                </div>

                <div className="border-t pt-8">
                  {/* 2FA Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          {totpEnabled ? (
                            <ShieldCheck className="h-5 w-5 text-green-500" />
                          ) : (
                            <ShieldOff className="h-5 w-5 text-muted-foreground" />
                          )}
                          Two-Factor Authentication
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          {totpEnabled
                            ? '2FA is enabled. Your account is secured with an authenticator app.'
                            : 'Add an extra layer of security to your account using an authenticator app.'}
                        </p>
                      </div>
                      {totpEnabled && (
                        <span className="px-2.5 py-0.5 text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">
                          Enabled
                        </span>
                      )}
                    </div>

                    {!totpEnabled && !totpConfigured && (
                      <Button onClick={setup2FA} disabled={totpLoading} variant="outline">
                        {totpLoading ? 'Setting up...' : 'Set up Authenticator App'}
                      </Button>
                    )}

                    {totpConfigured && !totpEnabled && (
                      <div className="space-y-4">
                        <div className="p-4 bg-muted rounded-lg space-y-3">
                          <p className="text-sm font-medium">1. Scan this QR code with your authenticator app</p>
                          {totpQrCode && (
                            <div className="flex justify-center">
                              <img src={totpQrCode} alt="2FA QR Code" className="w-48 h-48" />
                            </div>
                          )}
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">Or enter this code manually:</p>
                            <div className="flex items-center gap-2">
                              <code className="px-2 py-1 bg-background rounded text-sm font-mono flex-1 truncate">
                                {showTotpSecret ? totpSecret : '••••••••••••••••'}
                              </code>
                              <Button variant="ghost" size="sm" onClick={() => setShowTotpSecret(!showTotpSecret)}>
                                {showTotpSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </Button>
                              <Button variant="ghost" size="sm" onClick={copyTotpSecret}>
                                <Copy className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                        <div>
                          <Label htmlFor="totpCode">2. Enter the 6-digit code from your app</Label>
                          <Input
                            id="totpCode"
                            value={totpCode}
                            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="000000"
                            className="font-mono text-lg tracking-widest"
                            maxLength={6}
                          />
                        </div>
                        <Button onClick={verify2FA} disabled={totpLoading || totpCode.length !== 6}>
                          {totpLoading ? 'Verifying...' : 'Verify & Enable'}
                        </Button>
                      </div>
                    )}

                    {totpEnabled && (
                      <div className="space-y-4">
                        <div className="p-4 bg-muted/50 rounded-lg">
                          <p className="text-sm text-muted-foreground">
                            To disable 2FA, enter your current password below.
                          </p>
                        </div>
                        <div>
                          <Label htmlFor="disablePassword">Current Password</Label>
                          <Input
                            id="disablePassword"
                            type="password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            placeholder="Enter password to confirm"
                            autoComplete="current-password"
                          />
                        </div>
                        <Button
                          onClick={disable2FA}
                          disabled={totpLoading || !currentPassword}
                          variant="destructive"
                        >
                          {totpLoading ? 'Disabling...' : 'Disable Two-Factor Authentication'}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  )
}
