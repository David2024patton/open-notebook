'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  MessageSquare,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Clock,
  MoreVertical,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale } from '@/lib/utils/date-locale'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { BaseChatSession } from '@/lib/types/api'
import { useModels } from '@/lib/hooks/use-models'
import { cn } from '@/lib/utils'

interface SessionManagerProps {
  sessions: BaseChatSession[]
  currentSessionId: string | null
  onCreateSession: (title: string) => void
  onSelectSession: (sessionId: string) => void
  onUpdateSession: (sessionId: string, title: string) => void
  onDeleteSession: (sessionId: string) => void
  loadingSessions: boolean
}

export function SessionManager({
  sessions,
  currentSessionId,
  onCreateSession,
  onSelectSession,
  onUpdateSession,
  onDeleteSession,
  loadingSessions
}: SessionManagerProps) {
  const { t, language } = useTranslation()
  const [isCreating, setIsCreating] = useState(false)
  const [newSessionTitle, setNewSessionTitle] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const { data: models } = useModels()

  const customModelLabel = t('common.customModel')
  const getModelName = useMemo(() => {
    return (modelId: string) => {
      const model = models?.find(m => m.id === modelId)
      return model?.name || customModelLabel
    }
  }, [models, customModelLabel])

  const handleCreateSession = () => {
    if (newSessionTitle.trim()) {
      onCreateSession(newSessionTitle.trim())
      setNewSessionTitle('')
      setIsCreating(false)
    }
  }

  const handleStartEdit = (session: BaseChatSession) => {
    setEditingId(session.id)
    setEditTitle(session.title)
  }

  const handleSaveEdit = () => {
    if (editingId && editTitle.trim()) {
      onUpdateSession(editingId, editTitle.trim())
      setEditingId(null)
      setEditTitle('')
    }
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditTitle('')
  }

  const handleDeleteConfirm = () => {
    if (deleteConfirmId) {
      onDeleteSession(deleteConfirmId)
      setDeleteConfirmId(null)
    }
  }

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-muted-foreground" />
            <h2 className="font-semibold">{t('chat.sessions')}</h2>
          </div>
          <Button
            size="sm"
            variant="default"
            onClick={() => setIsCreating(true)}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{t('common.new')}</span>
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-2">
              {/* Create new session form */}
              {isCreating && (
                <div className="p-3 rounded-lg border bg-muted/50 space-y-3">
                  <Input
                    value={newSessionTitle}
                    onChange={(e) => setNewSessionTitle(e.target.value)}
                    placeholder={t('chat.sessionTitlePlaceholder')}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateSession()
                      if (e.key === 'Escape') {
                        setIsCreating(false)
                        setNewSessionTitle('')
                      }
                    }}
                  />
                  <div className="flex gap-2 justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setIsCreating(false)
                        setNewSessionTitle('')
                      }}
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button size="sm" onClick={handleCreateSession}>
                      {t('common.create')}
                    </Button>
                  </div>
                </div>
              )}

              {/* Sessions list */}
              {loadingSessions ? (
                <div className="text-center py-12 text-muted-foreground">
                  <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                  <p className="text-sm">{t('common.loading')}</p>
                </div>
              ) : sessions.length === 0 && !isCreating ? (
                <div className="text-center py-12 text-muted-foreground">
                  <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-medium">{t('chat.noSessions')}</p>
                  <p className="text-xs mt-1 opacity-70">{t('chat.createToStart')}</p>
                </div>
              ) : (
                sessions.map((session) => (
                  <div
                    key={session.id}
                    className={cn(
                      'group p-3 rounded-lg border cursor-pointer transition-all',
                      currentSessionId === session.id
                        ? 'bg-primary/10 border-primary/50 shadow-sm'
                        : 'hover:bg-muted/50 hover:border-muted-foreground/20'
                    )}
                    onClick={() => onSelectSession(session.id)}
                  >
                    {editingId === session.id ? (
                      <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                        <Input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit()
                            if (e.key === 'Escape') handleCancelEdit()
                          }}
                          autoFocus
                          className="h-8"
                        />
                        <div className="flex gap-1.5 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleCancelEdit}
                            className="h-7 px-2"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleSaveEdit}
                            className="h-7 px-2"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-sm truncate">{session.title}</h4>
                          <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3 flex-shrink-0" />
                            <span>
                              {formatDistanceToNow(new Date(session.created), {
                                addSuffix: true,
                                locale: getDateLocale(language)
                              })}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {session.message_count != null && session.message_count > 0 && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                {t('chat.messagesCount').replace('{count}', session.message_count.toString())}
                              </Badge>
                            )}
                            {session.model_override && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                {getModelName(session.model_override)}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div
                          className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => handleStartEdit(session)}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => setDeleteConfirmId(session.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('chat.deleteSession')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('chat.deleteSessionDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
