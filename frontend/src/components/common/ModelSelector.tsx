import { useId, useMemo } from 'react'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  SelectGroup, SelectLabel,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { useModels } from '@/lib/hooks/use-models'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Model } from '@/lib/types/models'

interface ModelSelectorProps {
  id?: string
  name?: string
  label?: string
  modelType: 'language' | 'embedding' | 'speech_to_text' | 'text_to_speech'
  value: string
  onChange: (value: string) => void
  placeholder?: string
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
  id,
  name,
  label,
  modelType,
  value,
  onChange,
  placeholder,
  disabled = false
}: ModelSelectorProps) {
  const { t } = useTranslation()
  const { data: models, isLoading } = useModels()
  const derivedId = useId()
  const selectId = id || derivedId

  // Group filtered models by provider
  const { groupedModels, providerOrder } = useMemo(() => {
    if (!models) {
      return { groupedModels: {}, providerOrder: [] }
    }

    const filtered = models.filter(model => model.type === modelType)
    const grouped: Record<string, Model[]> = {}
    const order: string[] = []

    for (const model of filtered) {
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
  }, [models, modelType])

  const totalModels = providerOrder.reduce((sum, p) => sum + (groupedModels[p]?.length || 0), 0)

  return (
    <div className="space-y-2">
      {label && <Label htmlFor={selectId}>{label}</Label>}
      <Select name={name} value={value} onValueChange={onChange} disabled={disabled || isLoading}>
        <SelectTrigger id={selectId}>
          <SelectValue placeholder={placeholder || t('settings.embeddingOptionPlaceholder')} />
        </SelectTrigger>
        <SelectContent className="max-h-[400px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-2">
              <LoadingSpinner size="sm" />
            </div>
          ) : totalModels === 0 ? (
            <div className="text-sm text-muted-foreground py-2 px-2">
              {t('common.noResults')}
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
  )
}
