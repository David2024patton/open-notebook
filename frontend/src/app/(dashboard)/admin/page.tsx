'use client'

import { useState, useEffect } from 'react'
import { useAuthStore } from '@/lib/stores/auth-store'
import { getApiUrl } from '@/lib/config'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlertCircle, Copy, Check, Trash2, UserPlus, Shield, Users } from 'lucide-react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useTranslation } from '@/lib/hooks/use-translation'

interface ReferralCode {
  id: string
  code: string
  granted_role: string
  is_used: boolean
  used_by: string | null
  used_at: string | null
  created: string
}

export default function AdminPage() {
  const { t } = useTranslation()
  const { token, user } = useAuthStore()
  const [referralCodes, setReferralCodes] = useState<ReferralCode[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [selectedRole, setSelectedRole] = useState('user')
  const [isGenerating, setIsGenerating] = useState(false)

  // Check if user is superuser
  const isSuperuser = user?.role === 'superuser'

  useEffect(() => {
    if (isSuperuser && token) {
      fetchReferralCodes()
    }
  }, [isSuperuser, token])

  const fetchReferralCodes = async () => {
    try {
      const apiUrl = await getApiUrl()
      const response = await fetch(`${apiUrl}/api/auth/referral-codes`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (response.ok) {
        const data = await response.json()
        setReferralCodes(data)
      } else {
        setError('Failed to fetch referral codes')
      }
    } catch (err) {
      setError('Network error')
    } finally {
      setIsLoading(false)
    }
  }

  const generateCode = async () => {
    if (!isSuperuser) return
    
    setIsGenerating(true)
    setError(null)
    
    try {
      const apiUrl = await getApiUrl()
      const response = await fetch(`${apiUrl}/api/auth/referral-codes`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ granted_role: selectedRole })
      })

      if (response.ok) {
        const newCode = await response.json()
        setReferralCodes([newCode, ...referralCodes])
      } else {
        const errorData = await response.json()
        setError(errorData.detail || 'Failed to generate code')
      }
    } catch (err) {
      setError('Network error')
    } finally {
      setIsGenerating(false)
    }
  }

  const deleteCode = async (codeId: string) => {
    if (!isSuperuser) return
    
    try {
      const apiUrl = await getApiUrl()
      const response = await fetch(`${apiUrl}/api/auth/referral-codes/${codeId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (response.ok) {
        setReferralCodes(referralCodes.filter(c => c.id !== codeId))
      } else {
        const errorData = await response.json()
        setError(errorData.detail || 'Failed to delete code')
      }
    } catch (err) {
      setError('Network error')
    }
  }

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  if (!isSuperuser) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Access Denied
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p>You need superuser privileges to access this page.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Generate Referral Code
          </CardTitle>
          <CardDescription>
            Create referral codes for auto-approving new user signups
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-2">Grant Role</label>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                className="w-full p-2 border rounded-md"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
                <option value="superuser">Superuser</option>
              </select>
            </div>
            <Button 
              onClick={generateCode} 
              disabled={isGenerating}
            >
              {isGenerating ? 'Generating...' : 'Generate Code'}
            </Button>
          </div>
          
          {error && (
            <div className="mt-4 flex items-center gap-2 text-red-600 text-sm">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Your Referral Codes
          </CardTitle>
          <CardDescription>
            Share these codes with users to auto-approve their signups
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingSpinner />
          ) : referralCodes.length === 0 ? (
            <p className="text-muted-foreground">No referral codes generated yet.</p>
          ) : (
            <div className="space-y-3">
              {referralCodes.map((code) => (
                <div 
                  key={code.id} 
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-lg">{code.code}</code>
                      <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
                        {code.granted_role}
                      </span>
                      {code.is_used ? (
                        <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800">
                          Used
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
                          Available
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      Created: {new Date(code.created).toLocaleDateString()}
                      {code.used_at && ` • Used: ${new Date(code.used_at).toLocaleDateString()}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!code.is_used && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyToClipboard(code.code)}
                        >
                          {copiedCode === code.code ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deleteCode(code.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
