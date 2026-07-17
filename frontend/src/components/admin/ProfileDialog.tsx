'use client'

import { useState } from 'react'
import { useAuth } from '@/lib/hooks/use-auth'
import { useAuthStore } from '@/lib/stores/auth-store'
import { getApiUrl } from '@/lib/config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { UserCircle, Save, Key } from 'lucide-react'
import { toast } from 'sonner'

interface ProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProfileDialog({ open, onOpenChange }: ProfileDialogProps) {
  const { user } = useAuth()
  const { token } = useAuthStore()
  const [displayName, setDisplayName] = useState(user?.display_name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [changingPw, setChangingPw] = useState(false)

  if (!user) return null

  const handleSaveProfile = async () => {
    if (!token) return
    setSaving(true)
    try {
      const apiUrl = await getApiUrl()
      const resp = await fetch(`${apiUrl}/api/auth/me`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ display_name: displayName, email }),
      })
      if (resp.ok) {
        toast.success('Profile updated')
        onOpenChange(false)
      } else {
        const err = await resp.json()
        toast.error(err.detail || 'Failed to update profile')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async () => {
    if (!token || !currentPassword || !newPassword) return
    setChangingPw(true)
    try {
      const apiUrl = await getApiUrl()
      const resp = await fetch(`${apiUrl}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      })
      if (resp.ok) {
        toast.success('Password changed')
        setCurrentPassword('')
        setNewPassword('')
      } else {
        const err = await resp.json()
        toast.error(err.detail || 'Failed to change password')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setChangingPw(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCircle className="h-5 w-5" />
            Profile
          </DialogTitle>
          <DialogDescription>
            Manage your account settings
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
              {(user.display_name || user.username || '??').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
            </div>
            <div>
              <div className="font-medium">{user.display_name || user.username}</div>
              <div className="text-sm text-muted-foreground capitalize">{user.role}</div>
            </div>
          </div>

          {/* Profile fields */}
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Username</label>
              <Input value={user.username} disabled className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium">Display Name</label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" />
            </div>
            <Button onClick={handleSaveProfile} disabled={saving} className="w-full">
              <Save className="h-4 w-4 mr-1" />
              {saving ? 'Saving...' : 'Save Profile'}
            </Button>
          </div>

          {/* Change password */}
          <div className="border-t pt-4 space-y-3">
            <h3 className="font-medium flex items-center gap-2">
              <Key className="h-4 w-4" />
              Change Password
            </h3>
            <Input
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
            <Input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            <Button
              variant="outline"
              onClick={handleChangePassword}
              disabled={changingPw || !currentPassword || !newPassword}
              className="w-full"
            >
              <Key className="h-4 w-4 mr-1" />
              {changingPw ? 'Changing...' : 'Change Password'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
