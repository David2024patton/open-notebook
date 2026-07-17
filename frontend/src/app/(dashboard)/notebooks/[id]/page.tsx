'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { SourcesColumn } from '../components/SourcesColumn'
import { NotesColumn } from '../components/NotesColumn'
import { ChatColumn } from '../components/ChatColumn'
import { useNotebook } from '@/lib/hooks/use-notebooks'
import { useNotebookSources } from '@/lib/hooks/use-sources'
import { useNotes } from '@/lib/hooks/use-notes'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { useIsDesktop } from '@/lib/hooks/use-media-query'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FileText, StickyNote, MessageSquare, Globe } from 'lucide-react'
import { CollapsibleColumn } from '@/components/notebooks/CollapsibleColumn'
import { BrowserColumn } from '@/components/notebooks/BrowserColumn'

export type ContextMode = 'off' | 'insights' | 'full'

export interface ContextSelections {
  sources: Record<string, ContextMode>
  notes: Record<string, ContextMode>
}

type ColumnId = 'sources' | 'notes' | 'chat' | 'browser'
const COLUMN_ORDER: ColumnId[] = ['sources', 'notes', 'chat', 'browser']
const MAX_VISIBLE = 3

export default function NotebookPage() {
  const { t } = useTranslation()
  const params = useParams()

  const notebookId = params?.id ? decodeURIComponent(params.id as string) : ''

  const { data: notebook, isLoading: notebookLoading } = useNotebook(notebookId)
  const {
    sources,
    isLoading: sourcesLoading,
    refetch: refetchSources,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useNotebookSources(notebookId)
  const { data: notes, isLoading: notesLoading } = useNotes(notebookId)

  const store = useNotebookColumnsStore()
  const isDesktop = useIsDesktop()

  const [mobileActiveTab, setMobileActiveTab] = useState<'sources' | 'notes' | 'chat'>('chat')

  const [contextSelections, setContextSelections] = useState<ContextSelections>({
    sources: {},
    notes: {}
  })

  // Count open panels
  const openCount = useMemo(() => {
    let count = 0
    if (!store.sourcesCollapsed) count++
    if (!store.notesCollapsed) count++
    if (!store.chatCollapsed) count++
    if (!store.browserCollapsed) count++
    return count
  }, [store.sourcesCollapsed, store.notesCollapsed, store.chatCollapsed, store.browserCollapsed])

  // Get list of open panel IDs in order
  const openPanels = useMemo(() => {
    const panels: ColumnId[] = []
    if (!store.sourcesCollapsed) panels.push('sources')
    if (!store.notesCollapsed) panels.push('notes')
    if (!store.chatCollapsed) panels.push('chat')
    if (!store.browserCollapsed) panels.push('browser')
    return panels
  }, [store.sourcesCollapsed, store.notesCollapsed, store.chatCollapsed, store.browserCollapsed])

  // Enforce max 3 visible - close the first open one (oldest) when opening a 4th
  const enforceMaxVisible = useCallback((openingColumn: ColumnId) => {
    if (openCount >= MAX_VISIBLE) {
      // Find the first open column that isn't the one being opened
      const toClose = openPanels.find(id => id !== openingColumn)
      if (toClose) {
        switch (toClose) {
          case 'sources': store.setSources(true); break
          case 'notes': store.setNotes(true); break
          case 'chat': store.setChat(true); break
          case 'browser': store.setBrowser(true); break
        }
      }
    }
  }, [openCount, openPanels, store])

  // Toggle wrappers with max enforcement
  const toggleSources = useCallback(() => {
    if (store.sourcesCollapsed) enforceMaxVisible('sources')
    store.toggleSources()
  }, [store, enforceMaxVisible])

  const toggleNotes = useCallback(() => {
    if (store.notesCollapsed) enforceMaxVisible('notes')
    store.toggleNotes()
  }, [store, enforceMaxVisible])

  const toggleChat = useCallback(() => {
    if (store.chatCollapsed) enforceMaxVisible('chat')
    store.toggleChat()
  }, [store, enforceMaxVisible])

  const toggleBrowser = useCallback(() => {
    if (store.browserCollapsed) enforceMaxVisible('browser')
    store.toggleBrowser()
  }, [store, enforceMaxVisible])

  useEffect(() => {
    if (sources && sources.length > 0) {
      setContextSelections(prev => {
        const newSourceSelections = { ...prev.sources }
        sources.forEach(source => {
          const currentMode = newSourceSelections[source.id]
          const hasInsights = source.insights_count > 0
          if (currentMode === undefined) {
            newSourceSelections[source.id] = hasInsights ? 'insights' : 'full'
          } else if (currentMode === 'full' && hasInsights) {
            newSourceSelections[source.id] = 'insights'
          }
        })
        return { ...prev, sources: newSourceSelections }
      })
    }
  }, [sources])

  useEffect(() => {
    if (notes && notes.length > 0) {
      setContextSelections(prev => {
        const newNoteSelections = { ...prev.notes }
        notes.forEach(note => {
          if (!(note.id in newNoteSelections)) {
            newNoteSelections[note.id] = 'full'
          }
        })
        return { ...prev, notes: newNoteSelections }
      })
    }
  }, [notes])

  const handleContextModeChange = (itemId: string, mode: ContextMode, type: 'source' | 'note') => {
    setContextSelections(prev => ({
      ...prev,
      [type === 'source' ? 'sources' : 'notes']: {
        ...(type === 'source' ? prev.sources : prev.notes),
        [itemId]: mode
      }
    }))
  }

  if (notebookLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!notebook) {
    return (
      <AppShell>
        <div className="p-6">
          <h1 className="text-2xl font-bold mb-4">{t('notebooks.notFound')}</h1>
          <p className="text-muted-foreground">{t('notebooks.notFoundDesc')}</p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 p-2 pt-1 overflow-hidden flex flex-col">
          {/* Mobile */}
          {!isDesktop && (
            <>
              <div className="lg:hidden mb-4">
                <Tabs value={mobileActiveTab} onValueChange={(value) => setMobileActiveTab(value as 'sources' | 'notes' | 'chat')}>
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="sources" className="gap-2">
                      <FileText className="h-4 w-4" />
                      {t('navigation.sources')}
                    </TabsTrigger>
                    <TabsTrigger value="notes" className="gap-2">
                      <StickyNote className="h-4 w-4" />
                      {t('common.notes')}
                    </TabsTrigger>
                    <TabsTrigger value="chat" className="gap-2">
                      <MessageSquare className="h-4 w-4" />
                      {t('common.chat')}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <div className="flex-1 overflow-hidden lg:hidden">
                {mobileActiveTab === 'sources' && (
                  <SourcesColumn
                    sources={sources}
                    isLoading={sourcesLoading}
                    notebookId={notebookId}
                    notebookName={notebook?.name}
                    onRefresh={refetchSources}
                    contextSelections={contextSelections.sources}
                    onContextModeChange={(sourceId, mode) => handleContextModeChange(sourceId, mode, 'source')}
                    hasNextPage={hasNextPage}
                    isFetchingNextPage={isFetchingNextPage}
                    fetchNextPage={fetchNextPage}
                  />
                )}
                {mobileActiveTab === 'notes' && (
                  <NotesColumn
                    notes={notes}
                    isLoading={notesLoading}
                    notebookId={notebookId}
                    contextSelections={contextSelections.notes}
                    onContextModeChange={(noteId, mode) => handleContextModeChange(noteId, mode, 'note')}
                  />
                )}
                {mobileActiveTab === 'chat' && (
                  <ChatColumn
                    notebookId={notebookId}
                    contextSelections={contextSelections}
                    sources={sources}
                    sourcesLoading={sourcesLoading}
                  />
                )}
              </div>
            </>
          )}

          {/* Desktop: 4 columns in fixed order, collapsed = 40px, open = flex-1 */}
          <div className="hidden lg:flex h-full min-h-0 gap-1">
            {/* Sources - position 1 */}
            <div className={cn(
              'h-full transition-all duration-150',
              store.sourcesCollapsed
                ? 'w-10 flex-shrink-0'
                : 'flex-1 min-w-0'
            )}>
              <CollapsibleColumn
                isCollapsed={store.sourcesCollapsed}
                onToggle={toggleSources}
                collapsedIcon={FileText}
                collapsedLabel={t('navigation.sources')}
              >
                <SourcesColumn
                  sources={sources}
                  isLoading={sourcesLoading}
                  notebookId={notebookId}
                  notebookName={notebook?.name}
                  onRefresh={refetchSources}
                  contextSelections={contextSelections.sources}
                  onContextModeChange={(sourceId, mode) => handleContextModeChange(sourceId, mode, 'source')}
                  hasNextPage={hasNextPage}
                  isFetchingNextPage={isFetchingNextPage}
                  fetchNextPage={fetchNextPage}
                />
              </CollapsibleColumn>
            </div>

            {/* Notes - position 2 */}
            <div className={cn(
              'h-full transition-all duration-150',
              store.notesCollapsed
                ? 'w-10 flex-shrink-0'
                : 'flex-1 min-w-0'
            )}>
              <CollapsibleColumn
                isCollapsed={store.notesCollapsed}
                onToggle={toggleNotes}
                collapsedIcon={StickyNote}
                collapsedLabel={t('common.notes')}
              >
                <NotesColumn
                  notes={notes}
                  isLoading={notesLoading}
                  notebookId={notebookId}
                  contextSelections={contextSelections.notes}
                  onContextModeChange={(noteId, mode) => handleContextModeChange(noteId, mode, 'note')}
                />
              </CollapsibleColumn>
            </div>

            {/* Chat - position 3 */}
            <div className={cn(
              'h-full transition-all duration-150',
              store.chatCollapsed
                ? 'w-10 flex-shrink-0'
                : 'flex-1 min-w-0'
            )}>
              <CollapsibleColumn
                isCollapsed={store.chatCollapsed}
                onToggle={toggleChat}
                collapsedIcon={MessageSquare}
                collapsedLabel={t('common.chat')}
              >
                <ChatColumn
                  notebookId={notebookId}
                  contextSelections={contextSelections}
                  sources={sources}
                  sourcesLoading={sourcesLoading}
                />
              </CollapsibleColumn>
            </div>

            {/* Browser - position 4 */}
            <div className={cn(
              'h-full transition-all duration-150',
              store.browserCollapsed
                ? 'w-10 flex-shrink-0'
                : 'flex-1 min-w-0'
            )}>
              <CollapsibleColumn
                isCollapsed={store.browserCollapsed}
                onToggle={toggleBrowser}
                collapsedIcon={Globe}
                collapsedLabel={t('common.browser') || 'Browser'}
              >
                <BrowserColumn notebookId={notebookId} />
              </CollapsibleColumn>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
