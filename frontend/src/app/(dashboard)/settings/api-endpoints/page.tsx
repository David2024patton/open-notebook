'use client'

import { AppShell } from '@/components/layout/AppShell'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { ApiEndpointsReference } from '@/components/profile/ApiEndpointsReference'

export default function ApiEndpointsPage() {
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
                <h1 className="text-2xl font-bold">API Endpoints</h1>
                <p className="text-sm text-muted-foreground">Reference for all available REST API endpoints</p>
              </div>
            </div>

            <ApiEndpointsReference />
          </div>
        </div>
      </div>
    </AppShell>
  )
}
