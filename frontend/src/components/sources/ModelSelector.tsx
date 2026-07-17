'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Settings2, Sparkles } from 'lucide-react'
import { useModelDefaults, useModels } from '@/lib/hooks/use-models'
import { useTranslation } from '@/lib/hooks/use-translation'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Model } from '@/lib/types/models'

interface ModelSelectorProps {
  currentModel?: string
  onModelChange: (model?: string) => void
  disabled?: boolean
}

function formatProviderName(provider: string): string {
  const names: Record<string, string> = {
    ollama: 'Ollama',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google',
    groq: 'Groq',
    mistral: 'Mistral',
    deepseek: 'DeepSeek',
    azure_openai: 'Azure OpenAI',
    openai_compatible: 'OpenAI Compatible',
  }
  return names[provider] || provider.charAt(0).toUpperCase() + provider.slice(1).replace(/_/g, ' ')
}

function ModelItem({ model }: { model: Model }) {
  return (
    <SelectItem key={model.id} value={model.id}>
      <div className="flex items-center justify-between w-full gap-2">
        <span className="truncate">{model.name}</span>
        <div className="flex items-center gap-1 shrink-0">
          {model.tags && model.tags.length > 0 && (
            <div className="flex items-center gap-0.5">
              {model.tags.slice(0, 3).map(tag => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="text-[9px] px-1 py-0 h-3.5 font-normal"
                >
                  {tag}
                </Badge>
              ))}
              {model.tags.length > 3 && (
                <span className="text-[9px] text-muted-foreground">+{model.tags.length - 3}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </SelectItem>
  )
}

export function ModelSelector({
  currentModel,
  onModelChange,
  disabled = false
}: ModelSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState(currentModel || 'default')
  const { data: models, isLoading } = useModels()
  const { data: defaults } = useModelDefaults()

  useEffect(() => {
    setSelectedModel(currentModel || 'default')
  }, [currentModel])

  // Filter for language models only, grouped by provider
  const { groupedModels, providerOrder } = useMemo(() => {
    if (!models) {
      return { groupedModels: {}, providerOrder: [] }
    }

    const languageModels = models.filter((model) => model.type === 'language')
    const grouped: Record<string, Model[]> = {}
    const order: string[] = []

    for (const model of languageModels) {
      const provider = model.provider || 'unknown'
      if (!grouped[provider]) {
        grouped[provider] = []
        order.push(provider)
      }
      grouped[provider].push(model)
    }

    // Sort models within each provider alphabetically
    for (const provider of order) {
      grouped[provider].sort((a, b) => a.name.localeCompare(b.name))
    }

    return { groupedModels: grouped, providerOrder: order }
  }, [models])

  // Flat list for current model lookup
  const languageModels = useMemo(() => {
    return providerOrder.flatMap(p => groupedModels[p] || [])
  }, [groupedModels, providerOrder])

  const defaultModel = useMemo(() => {
    if (!defaults?.default_chat_model) return undefined
    return languageModels.find(model => model.id === defaults.default_chat_model)
  }, [defaults?.default_chat_model, languageModels])

  const currentModelName = useMemo(() => {
    if (currentModel) {
      return languageModels.find(model => model.id === currentModel)?.name || currentModel
    }
    if (defaultModel) {
      return defaultModel.name
    }
    return t('common.default')
  }, [currentModel, languageModels, defaultModel, t('common.default')])

  const handleSave = () => {
    onModelChange(selectedModel === 'default' ? undefined : selectedModel)
    setOpen(false)
  }

  const handleReset = () => {
    setSelectedModel('default')
    onModelChange(undefined)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="gap-2 max-w-[180px]"
        >
          <Settings2 className="h-4 w-4 flex-shrink-0" />
          <span className="text-xs truncate">
            {currentModelName}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            {t('common.modelConfiguration')}
          </DialogTitle>
          <DialogDescription>
            {t('transformations.overrideModelDesc')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="model">{t('common.model')}</Label>
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger id="model">
                <SelectValue placeholder={t('models.selectModelPlaceholder')} />
              </SelectTrigger>
              <SelectContent className="max-h-[400px]">
                <SelectItem value="default">
                  <div className="flex items-center justify-between w-full">
                    <span>
                      {defaultModel
                        ? `${t('common.default')} (${defaultModel.name})`
                        : t('transformations.systemDefault')}
                    </span>
                    {defaultModel?.provider && (
                      <span className="text-xs text-muted-foreground ml-2">
                        {formatProviderName(defaultModel.provider)}
                      </span>
                    )}
                  </div>
                </SelectItem>
                {isLoading ? (
                  <div className="flex items-center justify-center py-2">
                    <LoadingSpinner size="sm" />
                  </div>
                ) : (
                  providerOrder.map(provider => (
                    <SelectGroup key={provider}>
                      <SelectLabel className="text-xs font-semibold text-muted-foreground sticky top-0 bg-popover z-10">
                        {formatProviderName(provider)}
                      </SelectLabel>
                      {(groupedModels[provider] || []).map(model => (
                        <ModelItem key={model.id} model={model} />
                      ))}
                    </SelectGroup>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          {selectedModel && selectedModel !== 'default' && (
            <div className="rounded-lg bg-muted p-3">
              <p className="text-sm text-muted-foreground">
                {t('transformations.sessionUseReplacement', { name: languageModels.find(m => m.id === selectedModel)?.name || selectedModel })}
              </p>
            </div>
          )}
        </div>
        <DialogFooter className="flex justify-between">
          <Button variant="outline" onClick={handleReset}>
            {t('common.resetToDefault')}
          </Button>
          <Button onClick={handleSave}>
            {t('common.saveChanges')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
