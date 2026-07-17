'use client'

import { useRouter, useParams } from 'next/navigation'
import { useCallback, useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowLeft, AlertCircle } from 'lucide-react'
import { useSourceChat } from '@/lib/hooks/useSourceChat'
import { ChatPanel } from '@/components/source/ChatPanel'
import { useNavigation } from '@/lib/hooks/use-navigation'
import { SourceDetailContent } from '@/components/source/SourceDetailContent'
import { sourcesApi } from '@/lib/api/sources'
import { useTranslation } from '@/lib/hooks/use-translation'

export default function SourceDetailPage() {
  const router = useRouter()
  const params = useParams()
  const { t } = useTranslation()
  const sourceId = params?.id ? decodeURIComponent(params.id as string) : ''
  const navigation = useNavigation()
  const [sourceExists, setSourceExists] = useState<boolean | null>(null)

  useEffect(() => {
    if (!sourceId) {
      setSourceExists(false)
      return
    }
    sourcesApi.get(sourceId)
      .then(() => setSourceExists(true))
      .catch(() => setSourceExists(false))
  }, [sourceId])

  // Initialize source chat
  const chat = useSourceChat(sourceId)

  const handleBack = useCallback(() => {
    const returnPath = navigation.getReturnPath()
    router.push(returnPath)
    navigation.clearReturnTo()
  }, [navigation, router])

  if (sourceExists === false) {
    return (
      <div className="flex flex-col h-screen">
        <div className="pt-6 pb-4 px-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="mb-4"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {navigation.getReturnLabel()}
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground max-w-md">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <h2 className="text-lg font-medium mb-2">{t('sources.notFound') || 'Source not found'}</h2>
            <p className="text-sm mb-4">{t('sources.notFoundDescription') || 'This source may have been deleted.'}</p>
            <Button onClick={handleBack}>
              {t('common.goBack') || 'Go Back'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (sourceExists === null) {
    return (
      <div className="flex flex-col h-screen">
        <div className="pt-6 pb-4 px-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="mb-4"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {navigation.getReturnLabel()}
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Back button */}
      <div className="pt-6 pb-4 px-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {navigation.getReturnLabel()}
        </Button>
      </div>

      {/* Main content: Source detail + Chat */}
      <div className="flex-1 grid gap-6 lg:grid-cols-[2fr_1fr] overflow-hidden px-6">
        {/* Left column - Source detail */}
        <div className="overflow-y-auto px-4 pb-6">
          <SourceDetailContent
            sourceId={sourceId}
            showChatButton={false}
            onClose={handleBack}
          />
        </div>

        {/* Right column - Chat */}
        <div className="overflow-y-auto px-4 pb-6">
          <ChatPanel
            messages={chat.messages}
            isStreaming={chat.isStreaming}
            contextIndicators={chat.contextIndicators}
            onSendMessage={(message, model) => chat.sendMessage(message, model)}
            modelOverride={chat.currentSession?.model_override}
            onModelChange={(model) => {
              if (chat.currentSessionId) {
                chat.updateSession(chat.currentSessionId, { model_override: model })
              }
            }}
            sessions={chat.sessions}
            currentSessionId={chat.currentSessionId}
            onCreateSession={(title) => chat.createSession({ title })}
            onSelectSession={chat.switchSession}
            onUpdateSession={(sessionId, title) => chat.updateSession(sessionId, { title })}
            onDeleteSession={chat.deleteSession}
            loadingSessions={chat.loadingSessions}
          />
        </div>
      </div>
    </div>
  )
}
