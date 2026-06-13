'use client'

import { useState, useEffect, useRef } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { useAuthStore } from '@/lib/stores/auth-store'
import { getApiUrl } from '@/lib/config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Upload, Check, Palette } from 'lucide-react'
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
  const { token, user } = useAuthStore()
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
  const [activeSection, setActiveSection] = useState<'avatar' | 'profile' | 'password'>('avatar')
  const fileInputRef = useRef<HTMLInputElement>(null)

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
                onClick={() => setActiveSection('password')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeSection === 'password'
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                Password
              </button>
            </div>

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

            {activeSection === 'password' && (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="currentPassword">Current Password</Label>
                  <Input
                    id="currentPassword"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="newPassword">New Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
                <Button onClick={changePassword} disabled={isSaving}>
                  {isSaving ? 'Changing...' : 'Change Password'}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  )
}
