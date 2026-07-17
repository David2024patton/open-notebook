'use client'

import { useState, useEffect, useCallback } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { useAuthStore } from '@/lib/stores/auth-store'
import { getApiUrl } from '@/lib/config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { UserPlus, Trash2, Shield, ShieldCheck, ShieldAlert, Copy, Check, Ticket, Plus, Users, ArrowLeft, Terminal, KeyRound, RefreshCw, Power, ArrowRightLeft } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

interface User {
  id: string
  username: string
  email?: string
  display_name?: string
  role: string
  is_active: boolean
}

interface ReferralCode {
  id: string
  code: string
  granted_role: string
  is_used: boolean
  used_by?: string
  used_at?: string
  created: string
}

export default function AdminSettingsPage() {
  const { token, user } = useAuthStore()
  const [activeTab, setActiveTab] = useState<'users' | 'referrals' | 'ssh' | 'transfer'>('users')

  const isAdmin = user?.role === 'admin' || user?.role === 'superuser'
  const isSuperuser = user?.role === 'superuser'

  if (!isAdmin) {
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <ShieldAlert className="h-12 w-12 mx-auto text-muted-foreground" />
            <h2 className="text-lg font-semibold">Access Denied</h2>
            <p className="text-sm text-muted-foreground">Admin privileges required</p>
            <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground">
              ← Back to Settings
            </Link>
          </div>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          <div className="max-w-4xl space-y-6">
            <div className="flex items-center gap-4">
              <Link href="/settings" className="p-2 hover:bg-muted rounded-md transition-colors">
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold">Admin Settings</h1>
                <p className="text-sm text-muted-foreground">Manage users, roles, and referral codes</p>
              </div>
            </div>

            <div className="flex gap-1 border-b">
              <button
                onClick={() => setActiveTab('users')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'users'
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Users className="h-4 w-4 mr-2 inline" />
                Users
              </button>
              {user?.role === 'superuser' && (
                <button
                  onClick={() => setActiveTab('referrals')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'referrals'
                      ? 'border-foreground text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Ticket className="h-4 w-4 mr-2 inline" />
                  Referral Codes
                </button>
              )}
              <button
                onClick={() => setActiveTab('ssh')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'ssh'
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Terminal className="h-4 w-4 mr-2 inline" />
                SSH Access
              </button>
              {isSuperuser && (
                <button
                  onClick={() => setActiveTab('transfer')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'transfer'
                      ? 'border-foreground text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <ArrowRightLeft className="h-4 w-4 mr-2 inline" />
                  Transfer Superuser
                </button>
              )}
            </div>

            {activeTab === 'users' && <UserManagementSection />}
            {activeTab === 'referrals' && isSuperuser && <ReferralCodesSection />}
            {activeTab === 'ssh' && <SSHSettingsSection />}
            {activeTab === 'transfer' && isSuperuser && <TransferSuperuserSection />}
          </div>
        </div>
      </div>
    </AppShell>
  )
}

function UserManagementSection() {
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
    fetchUsers()
  }, [fetchUsers])

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
            <Input placeholder="Email" type="email" autoComplete="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
            <Input placeholder="Username" autoComplete="username" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} />
            <Input placeholder="Password (temp)" type="password" autoComplete="new-password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
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
  )
}

// =============================================================================
// SSH Settings Section
// =============================================================================

function SSHSettingsSection() {
  const { token } = useAuthStore()
  const [status, setStatus] = useState<{ enabled: boolean; port: number; username: string; token_set: boolean; token_preview: string | null; host: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const fetchStatus = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const apiUrl = await getApiUrl()
      const resp = await fetch(`${apiUrl}/api/auth/ssh/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (resp.ok) setStatus(await resp.json())
    } catch (e) {
      console.error('Failed to fetch SSH status:', e)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  const handleReset = async () => {
    if (!token) return
    if (!confirm('Reset the SSH token? The current password will stop working immediately. Make sure you save the new one.')) return
    setResetting(true)
    setNewToken(null)
    try {
      const apiUrl = await getApiUrl()
      const resp = await fetch(`${apiUrl}/api/auth/ssh/reset-token`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (resp.ok) {
        const data = await resp.json()
        setNewToken(data.new_token)
        toast.success('SSH token reset — save it now, it won\'t be shown again')
        fetchStatus()
      } else {
        const err = await resp.json()
        toast.error(err.detail || 'Failed to reset token')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setResetting(false)
    }
  }

  const handleToggle = async () => {
    if (!token) return
    setToggling(true)
    try {
      const apiUrl = await getApiUrl()
      const resp = await fetch(`${apiUrl}/api/auth/ssh/toggle`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (resp.ok) {
        const data = await resp.json()
        toast.success(data.message)
        fetchStatus()
      } else {
        const err = await resp.json()
        toast.error(err.detail || 'Failed to toggle SSH')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setToggling(false)
    }
  }

  const copyToken = () => {
    if (newToken) {
      navigator.clipboard.writeText(newToken)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.success('Copied to clipboard')
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Terminal className="h-5 w-5" />
          SSH Server Access
        </h3>
        <p className="text-sm text-muted-foreground">
          Manage SSH terminal access to the Cortex container. Useful for MCP SSH integrations and debugging.
        </p>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">Loading...</div>
      ) : status ? (
        <div className="border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-sm font-medium">Status</div>
              <div className="flex items-center gap-2">
                <Badge variant={status.enabled ? 'default' : 'destructive'}>
                  {status.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
                <span className="text-xs text-muted-foreground">Port {status.port}</span>
              </div>
            </div>
            <Button
              variant={status.enabled ? 'destructive' : 'default'}
              size="sm"
              onClick={handleToggle}
              disabled={toggling}
            >
              <Power className="h-4 w-4 mr-1" />
              {toggling ? '...' : status.enabled ? 'Stop SSH' : 'Start SSH'}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Host</div>
              <code className="text-sm">{status.host}</code>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Port</div>
              <code className="text-sm">{status.port}</code>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Username</div>
              <code className="text-sm">{status.username}</code>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Token</div>
              <code className="text-sm">{status.token_set ? (status.token_preview || '••••••••') : 'not set'}</code>
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium flex items-center gap-1">
                  <KeyRound className="h-4 w-4" />
                  Reset SSH Token
                </div>
                <div className="text-xs text-muted-foreground">Generates a new random token. The old one stops working immediately.</div>
              </div>
              <Button variant="outline" size="sm" onClick={handleReset} disabled={resetting}>
                <RefreshCw className={`h-4 w-4 mr-1 ${resetting ? 'animate-spin' : ''}`} />
                {resetting ? 'Resetting...' : 'Reset Token'}
              </Button>
            </div>

            {newToken && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-2">
                <div className="text-xs font-medium text-amber-800 dark:text-amber-200">
                  ⚠ Save this token now — it will not be shown again.
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white dark:bg-black p-2 rounded text-sm font-mono break-all">{newToken}</code>
                  <Button variant="ghost" size="sm" onClick={copyToken} className="shrink-0">
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  Connect with: <code className="text-xs">ssh {status.username}@{status.host} -p {status.port}</code>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-muted-foreground text-sm">Failed to load SSH status</div>
      )}
    </div>
  )
}

// =============================================================================
// Transfer Superuser Section
// =============================================================================

function TransferSuperuserSection() {
  const { token, user } = useAuthStore()
  const [users, setUsers] = useState<User[]>([])
  const [targetUserId, setTargetUserId] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [transferring, setTransferring] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    const fetchUsers = async () => {
      try {
        const apiUrl = await getApiUrl()
        const resp = await fetch(`${apiUrl}/api/auth/users`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (resp.ok) {
          const allUsers = await resp.json()
          // Only show admins (transfer target must be admin)
          setUsers(allUsers.filter((u: User) => u.role === 'admin' && u.id !== user?.id))
        }
      } catch (e) {
        console.error('Failed to fetch users:', e)
      }
    }
    fetchUsers()
  }, [token, user?.id])

  const handleTransfer = async () => {
    if (!token || !targetUserId || !password || !totpCode) return
    if (!confirm('Are you absolutely sure? You will lose superuser privileges and become an admin. This cannot be undone.')) return
    setTransferring(true)
    setResult(null)
    try {
      const apiUrl = await getApiUrl()
      const resp = await fetch(`${apiUrl}/api/auth/transfer-superuser`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          target_user_id: targetUserId,
          password,
          totp_code: totpCode,
        }),
      })
      if (resp.ok) {
        const data = await resp.json()
        toast.success(data.message)
        setResult(data.message)
        setPassword('')
        setTotpCode('')
        setTargetUserId('')
      } else {
        const err = await resp.json()
        toast.error(err.detail || 'Transfer failed')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setTransferring(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <ArrowRightLeft className="h-5 w-5" />
          Transfer Superuser Ownership
        </h3>
        <p className="text-sm text-muted-foreground">
          Transfer your superuser privileges to another admin. You will become an admin after the transfer.
        </p>
      </div>

      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 space-y-2">
        <div className="text-sm font-medium text-red-800 dark:text-red-200">⚠ Security Requirements</div>
        <ul className="text-xs text-red-700 dark:text-red-300 space-y-1 ml-4 list-disc">
          <li>You must enter your current password</li>
          <li>You must enter a valid 2FA code (2FA must be enabled on your account)</li>
          <li>The target user must be an admin (not a regular user)</li>
          <li>This action is irreversible — you cannot undo it</li>
        </ul>
      </div>

      {users.length === 0 ? (
        <div className="border rounded-lg p-4 text-center text-muted-foreground text-sm">
          No admin users available for transfer. Promote a user to admin first in the Users tab.
        </div>
      ) : (
        <div className="border rounded-lg p-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Target Admin</label>
            <Select value={targetUserId} onValueChange={setTargetUserId}>
              <SelectTrigger><SelectValue placeholder="Select an admin to transfer to" /></SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.display_name || u.username} (@{u.username})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Your Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password to confirm"
              autoComplete="current-password"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">2FA Code</label>
            <Input
              type="text"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-digit code from your authenticator app"
              maxLength={6}
              autoComplete="one-time-code"
            />
            <p className="text-xs text-muted-foreground">
              Enable 2FA in Settings → Profile if you haven't already.
            </p>
          </div>

          <Button
            variant="destructive"
            onClick={handleTransfer}
            disabled={transferring || !targetUserId || !password || totpCode.length !== 6}
            className="w-full"
          >
            {transferring ? 'Transferring...' : 'Transfer Superuser Ownership'}
          </Button>

          {result && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm text-green-800 dark:text-green-200">
              {result}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ReferralCodesSection() {
  const { token } = useAuthStore()
  const [codes, setCodes] = useState<ReferralCode[]>([])
  const [loading, setLoading] = useState(false)
  const [newRole, setNewRole] = useState('user')
  const [generating, setGenerating] = useState(false)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const fetchCodes = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const apiUrl = await getApiUrl()
      const resp = await fetch(`${apiUrl}/api/auth/referral-codes`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (resp.ok) setCodes(await resp.json())
    } catch (e) {
      console.error('Failed to fetch referral codes:', e)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchCodes()
  }, [fetchCodes])

  const handleGenerate = async () => {
    if (!token) return
    setGenerating(true)
    try {
      const apiUrl = await getApiUrl()
      const resp = await fetch(`${apiUrl}/api/auth/referral-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ granted_role: newRole }),
      })
      if (resp.ok) {
        const data = await resp.json()
        toast.success(`Referral code generated: ${data.code}`)
        fetchCodes()
      } else {
        const err = await resp.json()
        toast.error(err.detail || 'Failed to generate code')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setGenerating(false)
    }
  }

  const handleDelete = async (codeId: string, code: string) => {
    if (!token) return
    if (!confirm(`Delete referral code ${code}?`)) return
    try {
      const apiUrl = await getApiUrl()
      const resp = await fetch(`${apiUrl}/api/auth/referral-codes/${codeId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (resp.ok) {
        toast.success('Referral code deleted')
        fetchCodes()
      } else {
        const err = await resp.json()
        toast.error(err.detail || 'Failed to delete code')
      }
    } catch {
      toast.error('Network error')
    }
  }

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
    toast.success(`Copied: ${code}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select value={newRole} onValueChange={setNewRole}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="user">User Role</SelectItem>
            <SelectItem value="admin">Admin Role</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={handleGenerate} disabled={generating}>
          <Plus className="h-4 w-4 mr-1" />
          {generating ? 'Generating...' : 'Generate Code'}
        </Button>
        <span className="text-sm text-muted-foreground">{codes.length} codes</span>
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="text-center text-muted-foreground py-4">Loading...</div>
        ) : codes.length === 0 ? (
          <div className="text-center text-muted-foreground py-4">No referral codes yet</div>
        ) : (
          codes.map((c) => (
            <div key={c.id} className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                <code className="bg-muted px-2 py-1 rounded text-sm font-mono">{c.code}</code>
                <Badge variant="secondary" className={
                  c.granted_role === 'admin'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300'
                    : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                }>
                  {c.granted_role}
                </Badge>
                <Badge variant={c.is_used ? 'outline' : 'default'}>
                  {c.is_used ? 'Used' : 'Available'}
                </Badge>
                {c.created && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(c.created).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className="flex gap-1">
                {!c.is_used && (
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => copyCode(c.code)}>
                    {copiedCode === c.code ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                )}
                {!c.is_used && (
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDelete(c.id, c.code)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

