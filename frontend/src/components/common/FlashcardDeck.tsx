'use client'

import { useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RotateCcw, ChevronLeft, ChevronRight, Loader2, Sparkles, BookOpen } from 'lucide-react'

interface Flashcard {
  front: string
  back: string
  category: string
}

interface FlashcardDeckProps {
  flashcards: Flashcard[]
  sourceCount: number
  generatedFrom: string
}

const CATEGORY_COLORS: Record<string, string> = {
  definition: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  concept: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  fact: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  process: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  comparison: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  application: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  general: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300',
}

export function FlashcardDeck({ flashcards, sourceCount, generatedFrom }: FlashcardDeckProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const currentCard = flashcards[currentIndex]

  const goNext = useCallback(() => {
    if (currentIndex < flashcards.length - 1) {
      setCurrentIndex(currentIndex + 1)
      setIsFlipped(false)
    }
  }, [currentIndex, flashcards.length])

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
      setIsFlipped(false)
    }
  }, [currentIndex])

  const shuffle = useCallback(() => {
    const shuffled = [...flashcards].sort(() => Math.random() - 0.5)
    setCurrentIndex(0)
    setIsFlipped(false)
    // We can't modify props, so we'll just randomize the index
    const randomIndex = Math.floor(Math.random() * flashcards.length)
    setCurrentIndex(randomIndex)
  }, [flashcards])

  if (flashcards.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No flashcards generated yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Flashcards</span>
          <Badge variant="secondary" className="text-xs">
            {flashcards.length} cards
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={shuffle}
            title="Shuffle cards"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? 'Card View' : 'Show All'}
          </Button>
        </div>
      </div>

      {/* Source info */}
      <p className="text-xs text-muted-foreground">
        Generated from {generatedFrom} ({sourceCount} source{sourceCount !== 1 ? 's' : ''})
      </p>

      {showAll ? (
        /* Grid view - all cards */
        <div className="grid gap-3 sm:grid-cols-2">
          {flashcards.map((card, i) => (
            <Card key={i} className="overflow-hidden">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{card.front}</p>
                  <Badge className={`text-[10px] shrink-0 ${CATEGORY_COLORS[card.category] || CATEGORY_COLORS.general}`}>
                    {card.category}
                  </Badge>
                </div>
                <div className="rounded bg-muted/50 p-2">
                  <p className="text-xs text-muted-foreground">{card.back}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        /* Card view - single card with flip */
        <div className="space-y-3">
          {/* Progress */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Card {currentIndex + 1} of {flashcards.length}</span>
            <Badge className={`text-[10px] ${CATEGORY_COLORS[currentCard.category] || CATEGORY_COLORS.general}`}>
              {currentCard.category}
            </Badge>
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${((currentIndex + 1) / flashcards.length) * 100}%` }}
            />
          </div>

          {/* Card */}
          <button
            onClick={() => setIsFlipped(!isFlipped)}
            className="w-full text-left"
          >
            <Card className={`transition-all duration-300 cursor-pointer hover:shadow-md ${isFlipped ? 'bg-primary/5 border-primary/30' : ''}`}>
              <CardContent className="p-6 min-h-[160px] flex flex-col items-center justify-center text-center">
                {!isFlipped ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Question</p>
                    <p className="text-lg font-medium">{currentCard.front}</p>
                    <p className="text-xs text-muted-foreground mt-4">Click to reveal answer</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Answer</p>
                    <p className="text-base">{currentCard.back}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </button>

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={goPrev}
              disabled={currentIndex === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={goNext}
              disabled={currentIndex === flashcards.length - 1}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/* Loading state component */
export function FlashcardLoading() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Generating flashcards...
    </div>
  )
}
