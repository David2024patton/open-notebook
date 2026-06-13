'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { CheckCircle, Sparkles, Lightbulb, ChevronDown, FileText, ExternalLink } from 'lucide-react'
import { useState, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { convertReferencesToMarkdownLinks, createReferenceLinkComponent, parseSourceReferences, type ReferenceType } from '@/lib/utils/source-references'
import { useModalManager } from '@/lib/hooks/use-modal-manager'
import { useTranslation } from '@/lib/hooks/use-translation'
import { toast } from 'sonner'

interface StrategyData {
  reasoning: string
  searches: Array<{ term: string; instructions: string }>
}

interface StreamingResponseProps {
  isStreaming: boolean
  strategy: StrategyData | null
  answers: string[]
  finalAnswer: string | null
}

export function StreamingResponse({
  isStreaming,
  strategy,
  answers,
  finalAnswer
}: StreamingResponseProps) {
  const [strategyOpen, setStrategyOpen] = useState(false)
  const [answersOpen, setAnswersOpen] = useState(false)
  const { openModal } = useModalManager()
  const { t } = useTranslation()

  const handleReferenceClick = (type: string, id: string) => {
    const modalType = type === 'source_insight' ? 'insight' : type as 'source' | 'note' | 'insight'

    try {
      openModal(modalType, id)
      // Note: The modal system uses URL parameters and doesn't throw errors for missing items.
      // The modal component itself will handle displaying "not found" states.
      // This try-catch is here for future enhancements or unexpected errors.
    } catch {
      const typeLabel = type === 'source_insight' ? 'insight' : type
      toast.error(t('common.itemNotFound').replace('{type}', typeLabel))
    }
  }

  if (!strategy && !answers.length && !finalAnswer && !isStreaming) {
    return null
  }

  return (
    <div
      className="space-y-4 mt-6 max-h-[60vh] overflow-y-auto pr-2"
      role="region"
      aria-label={t('common.accessibility.askResponse')}
      aria-live="polite"
      aria-busy={isStreaming}
    >
      {/* Strategy Section - Collapsible */}
      {strategy && (
        <Collapsible open={strategyOpen} onOpenChange={setStrategyOpen}>
          <Card>
            <CardHeader>
              <CollapsibleTrigger className="flex items-center justify-between w-full hover:opacity-80">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  {t('common.strategy')}
                </CardTitle>
                <ChevronDown className={`h-4 w-4 transition-transform ${strategyOpen ? 'rotate-180' : ''}`} />
              </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
              <CardContent className="space-y-3 pt-0">
                <div>
                  <p className="text-sm text-muted-foreground mb-2">{t('common.reasoning')}:</p>
                  <p className="text-sm">{strategy.reasoning}</p>
                </div>
                {strategy.searches.length > 0 && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">{t('common.searchTerms')}:</p>
                    <div className="space-y-2">
                      {strategy.searches.map((search, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <Badge variant="outline" className="mt-0.5">{i + 1}</Badge>
                          <div className="flex-1">
                            <p className="text-sm font-medium">{search.term}</p>
                            <p className="text-xs text-muted-foreground">{search.instructions}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Individual Answers Section - Collapsible */}
      {answers.length > 0 && (
        <Collapsible open={answersOpen} onOpenChange={setAnswersOpen}>
          <Card>
            <CardHeader>
              <CollapsibleTrigger className="flex items-center justify-between w-full hover:opacity-80">
                <CardTitle className="text-base flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-primary" />
                  {t('common.individualAnswers').replace('{count}', answers.length.toString())}
                </CardTitle>
                <ChevronDown className={`h-4 w-4 transition-transform ${answersOpen ? 'rotate-180' : ''}`} />
              </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
              <CardContent className="space-y-2 pt-0">
                {answers.map((answer, i) => (
                  <div key={i} className="p-3 rounded-md bg-muted">
                    <p className="text-sm">{answer}</p>
                  </div>
                ))}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Final Answer Section - Always Open */}
      {finalAnswer && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-primary" />
              {t('common.finalAnswer')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FinalAnswerContent
              content={finalAnswer}
              onReferenceClick={handleReferenceClick}
            />
          </CardContent>
        </Card>
      )}

      {/* Loading Indicator */}
      {isStreaming && !finalAnswer && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoadingSpinner size="sm" />
          <span>{t('searchPage.processingQuestion')}</span>
        </div>
      )}
    </div>
  )
}

// Helper component to render final answer with clickable references
function FinalAnswerContent({
  content,
  onReferenceClick
}: {
  content: string
  onReferenceClick: (type: string, id: string) => void
}) {
  const { t } = useTranslation()
  // Convert references to markdown links
  const markdownWithLinks = convertReferencesToMarkdownLinks(content)

  // Create custom link component
  const LinkComponent = createReferenceLinkComponent(onReferenceClick)

  // Extract unique references for the Sources Referenced section
  const references = useMemo(() => {
    const refs = parseSourceReferences(content)
    const seen = new Set<string>()
    return refs.filter((r) => {
      const key = `${r.type}:${r.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [content])

  const typeLabels: Record<ReferenceType, string> = {
    source: 'Source',
    source_insight: 'Insight',
    note: 'Note',
  }

  const typeColors: Record<ReferenceType, string> = {
    source: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
    source_insight: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
    note: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
  }

  const typeIcons: Record<ReferenceType, typeof FileText> = {
    source: FileText,
    source_insight: Lightbulb,
    note: FileText,
  }

  return (
    <div className="space-y-4">
      <div className="prose prose-sm max-w-none dark:prose-invert break-words prose-a:break-all prose-p:leading-relaxed prose-headings:mt-4 prose-headings:mb-2">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: LinkComponent,
            table: ({ children }) => (
              <div className="my-4 overflow-x-auto">
                <table className="min-w-full border-collapse border border-border">{children}</table>
              </div>
            ),
            thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
            tbody: ({ children }) => <tbody>{children}</tbody>,
            tr: ({ children }) => <tr className="border-b border-border">{children}</tr>,
            th: ({ children }) => <th className="border border-border px-3 py-2 text-left font-semibold">{children}</th>,
            td: ({ children }) => <td className="border border-border px-3 py-2">{children}</td>,
          }}
        >
          {markdownWithLinks}
        </ReactMarkdown>
      </div>

      {/* Sources Referenced Section */}
      {references.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            <FileText className="h-3.5 w-3.5" />
            Sources Referenced ({references.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {references.map((ref, i) => {
              const Icon = typeIcons[ref.type]
              return (
                <button
                  key={`${ref.type}-${ref.id}-${i}`}
                  onClick={() => onReferenceClick(ref.type, ref.id)}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium cursor-pointer transition-colors hover:opacity-80 ${typeColors[ref.type]}`}
                  type="button"
                >
                  <Icon className="h-3 w-3" />
                  {typeLabels[ref.type]}
                  <ExternalLink className="h-2.5 w-2.5 opacity-50" />
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
