'use client'

import { useState, useEffect, useCallback } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { UserPlus, Trash2, Shield, ShieldCheck, ShieldAlert, Copy, Check } from 'lucide-react'
import { toast } from 'sonner'

interface User {
  id: string
  username: string
  email?: string
  display_name?: string
  role: string
  is_active: boolean
}

interface UserManagementDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserManagementDialog({ open, onOpenChange }: UserManagementDialogProps) {
  const { token } = useAuthStore()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newUser, setNewUser] = useState({ email: '', username: '', password: '', display_name: '', role: 'user' })
  const [creating, setCreating] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const apiUrl = await getApiUrl()
      const resp = await fetch(`${apiUrl}/api/auth/users`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (resp.ok) setUsers(await resp.json())
    } catch (e) {
      console.error('Failed to fetch users:', e)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (open) fetchUsers()
  }, [open, fetchUsers])

  const handleCreate = async () => {
    if (!token || !newUser.email || !newUser.username || !newUser.password) return
    setCreating(true)
    try {
      const apiUrl = await getApiUrl()
      const resp = await fetch(`${apiUrl}/api/auth/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(newUser),
      })
      if (resp.ok) {
        toast.success(`User ${newUser.username} created`)
        setNewUser({ email: '', username: '', password: '', display_name: '', role: 'user' })
        setShowCreateForm(false)
        fetchUsers()
      } else {
        const err = await resp.json()
        toast.error(err.detail || 'Failed to create user')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (userId: string, username: string) => {
    if (!token) return
    if (!confirm(`Delete user ${username}?`)) return
    try {
      const apiUrl = await getApiUrl()
      const resp = await fetch(`${apiUrl}/api/auth/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (resp.ok) {
        toast.success(`User ${username} deleted`)
        fetchUsers()
      } else {
        const err = await resp.json()
        toast.error(err.detail || 'Failed to delete user')
      }
    } catch {
      toast.error('Network error')
    }
  }

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const getRoleIcon = (role: string) => {
    if (role === 'superuser') return <ShieldAlert className="h-3 w-3" />
    if (role === 'admin') return <ShieldCheck className="h-3 w-3" />
    return <Shield className="h-3 w-3" />
  }

  const getRoleBadgeColor = (role: string) => {
    if (role === 'superuser') return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300'
    if (role === 'admin') return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300'
    return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            User Management
          </DialogTitle>
          <DialogDescription>Manage users, roles, and permissions</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">{users.length} users</span>
            <Button size="sm" onClick={() => setShowCreateForm(!showCreateForm)}>
              <UserPlus className="h-4 w-4 mr-1" />
              Create User
            </Button>
          </div>

          {showCreateForm && (
            <div className="border rounded-lg p-4 space-y-3 bg-muted/50">
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="Email" type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
                <Input placeholder="Username" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} />
                <Input placeholder="Password (temp)" type="text" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
                <Input placeholder="Display name (optional)" value={newUser.display_name} onChange={(e) => setNewUser({ ...newUser, display_name: e.target.value })} />
              </div>
              <div className="flex items-center gap-3">
                <Select value={newUser.role} onValueChange={(v) => setNewUser({ ...newUser, role: v })}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={handleCreate} disabled={creating || !newUser.email || !newUser.username || !newUser.password}>
                  {creating ? 'Creating...' : 'Create'}
                </Button>
                <Button variant="ghost" onClick={() => setShowCreateForm(false)}>Cancel</Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {loading ? (
              <div className="text-center text-muted-foreground py-4">Loading...</div>
            ) : users.length === 0 ? (
              <div className="text-center text-muted-foreground py-4">No users found</div>
            ) : (
              users.map((u) => (
                <div key={u.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-medium shrink-0">
                      {(u.display_name || u.username).slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{u.display_name || u.username}</div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>@{u.username}</span>
                        {u.email && (
                          <>
                            <span>&middot;</span>
                            <span className="truncate">{u.email}</span>
                            <Button variant="ghost" size="sm" className="h-4 w-4 p-0 shrink-0" onClick={() => copyToClipboard(u.email || '', `email-${u.id}`)}>
                              {copiedField === `email-${u.id}` ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="secondary" className={`gap-1 ${getRoleBadgeColor(u.role)}`}>
                      {getRoleIcon(u.role)} {u.role}
                    </Badge>
                    <Badge variant={u.is_active ? 'default' : 'destructive'}>
                      {u.is_active ? 'Active' : 'Off'}
                    </Badge>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDelete(u.id, u.username)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
