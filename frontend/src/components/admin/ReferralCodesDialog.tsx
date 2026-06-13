'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/lib/stores/auth-store'
import { getApiUrl } from '@/lib/config'
import { Button } from '@/components/ui/button'
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
import { Ticket, Trash2, Copy, Check, Plus } from 'lucide-react'
import { toast } from 'sonner'

interface ReferralCode {
  id: string
  code: string
  granted_role: string
  is_used: boolean
  used_by?: string
  used_at?: string
  created: string
}

interface ReferralCodesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ReferralCodesDialog({ open, onOpenChange }: ReferralCodesDialogProps) {
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
    if (open) fetchCodes()
  }, [open, fetchCodes])

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5" />
            Referral Codes
          </DialogTitle>
          <DialogDescription>
            Generate single-use referral codes for instant user registration
          </DialogDescription>
        </DialogHeader>

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
      </DialogContent>
    </Dialog>
  )
}
