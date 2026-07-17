'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useParams } from 'next/navigation'
import { useAuth } from '@/lib/hooks/use-auth'
import { useAuthStore } from '@/lib/stores/auth-store'
import { UserMenu } from '@/components/common/UserMenu'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useNotebook } from '@/lib/hooks/use-notebooks'
import { useUpdateNotebook } from '@/lib/hooks/use-notebooks'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Archive, ArchiveRestore, Trash2, Pencil } from 'lucide-react'
import { NotebookDeleteDialog } from '@/app/(dashboard)/notebooks/components/NotebookDeleteDialog'
import { useState } from 'react'

export function TopNavbar() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { authMode } = useAuthStore()
  const params = useParams()

  const isMultiUser = authMode === 'multi-user'
  
  const notebookId = params?.id ? decodeURIComponent(params.id as string) : null
  const isInNotebook = !!notebookId && window.location.pathname.includes('/notebooks/')
  
  return (
    <div className="h-12 border-b bg-background flex items-center px-4 shrink-0 z-10">
      {/* Left - branding */}
      <Link href="/notebooks" className="flex items-center gap-2 shrink-0 hover:opacity-80 transition-opacity">
        <Image src="/logo.svg" alt={t('common.appName')} width={28} height={28} />
        <span className="text-sm font-semibold text-foreground hidden sm:inline">
          {t('common.appName')}
        </span>
      </Link>
      
      {/* Center - notebook context */}
      {isInNotebook && notebookId && (
        <div className="flex-1 flex justify-center min-w-0">
          <NotebookContext notebookId={notebookId} />
        </div>
      )}
      
      {/* Right - spacer when in notebook to keep center balanced */}
      {isInNotebook && <div className="w-[140px] shrink-0" />}
      
      {/* Right - user menu */}
      <div className="absolute right-4 flex items-center gap-2 shrink-0">
        {isMultiUser && user && (
          <UserMenu />
        )}
      </div>
    </div>
  )
}

function NotebookContext({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation()
  const { data: notebook, isLoading } = useNotebook(notebookId)
  const updateNotebook = useUpdateNotebook()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')

  const handleSaveName = async () => {
    if (!notebook || !editValue.trim() || editValue.trim() === notebook.name) {
      setIsEditing(false)
      return
    }
    await updateNotebook.mutateAsync({
      id: notebookId,
      data: { name: editValue.trim() }
    })
    setIsEditing(false)
  }

  const handleArchiveToggle = () => {
    if (!notebook) return
    updateNotebook.mutate({
      id: notebookId,
      data: { archived: !notebook.archived }
    })
  }

  if (isLoading || !notebook) {
    return (
      <div className="flex items-center gap-3">
        <div className="h-4 w-40 bg-muted animate-pulse rounded" />
        <div className="h-4 w-20 bg-muted animate-pulse rounded" />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      {/* Notebook name - editable */}
      {isEditing ? (
        <input
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSaveName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSaveName()
            if (e.key === 'Escape') setIsEditing(false)
          }}
          className="text-sm font-semibold bg-background border rounded px-2 py-1 w-64 focus:outline-none focus:ring-2 focus:ring-primary"
        />
      ) : (
        <button
          onClick={() => { setEditValue(notebook.name); setIsEditing(true) }}
          className="flex items-center gap-1.5 text-sm font-semibold hover:bg-muted rounded px-2 py-1 transition-colors group max-w-[300px] truncate"
          title="Click to rename"
        >
          <span className="truncate">{notebook.name}</span>
          <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-muted-foreground" />
        </button>
      )}

      {notebook.archived && (
        <Badge variant="secondary" className="text-xs shrink-0">Archived</Badge>
      )}

      {/* Separator */}
      <div className="w-px h-4 bg-border mx-1" />

      {/* Actions with labels */}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleArchiveToggle}
        className="h-7 px-2 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
      >
        {notebook.archived ? (
          <>
            <ArchiveRestore className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Unarchive</span>
          </>
        ) : (
          <>
            <Archive className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Archive</span>
          </>
        )}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowDeleteDialog(true)}
        className="h-7 px-2 text-xs gap-1.5 text-muted-foreground hover:text-red-600"
      >
        <Trash2 className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Delete</span>
      </Button>

      <NotebookDeleteDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        notebookId={notebook.id}
        notebookName={notebook.name}
        redirectAfterDelete
      />
    </div>
  )
}