'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api/client'

interface Flashcard {
  front: string
  back: string
  category: string
}

interface FlashcardResult {
  flashcards: Flashcard[]
  source_count: number
  generated_from: string
}

export function useFlashcards() {
  const [flashcards, setFlashcards] = useState<Flashcard[]>([])
  const [sourceCount, setSourceCount] = useState(0)
  const [generatedFrom, setGeneratedFrom] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = useCallback(async (options: {
    source_id?: string
    notebook_id?: string
    num_flashcards?: number
    language?: string
  }) => {
    setIsGenerating(true)
    setError(null)

    try {
      const response = await apiClient.post<FlashcardResult>('/flashcards/generate', {
        source_id: options.source_id,
        notebook_id: options.notebook_id,
        num_flashcards: options.num_flashcards || 10,
        language: options.language,
      })

      const data = response.data
      setFlashcards(data.flashcards)
      setSourceCount(data.source_count)
      setGeneratedFrom(data.generated_from)

      toast.success(`Generated ${data.flashcards.length} flashcards`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate flashcards'
      setError(message)
      toast.error(message)
    } finally {
      setIsGenerating(false)
    }
  }, [])

  const clear = useCallback(() => {
    setFlashcards([])
    setSourceCount(0)
    setGeneratedFrom('')
    setError(null)
  }, [])

  return {
    flashcards,
    sourceCount,
    generatedFrom,
    isGenerating,
    error,
    generate,
    clear,
  }
}
