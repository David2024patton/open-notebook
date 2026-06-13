'use client'

import { useMemo, useState } from 'react'
import { AlertCircle, Lightbulb, Loader2, Search, X, Sparkles, Mic, FileText } from 'lucide-react'

import { EpisodeProfilesPanel } from '@/components/podcasts/EpisodeProfilesPanel'
import { SpeakerProfilesPanel } from '@/components/podcasts/SpeakerProfilesPanel'
import { SpeakerProfileFormDialog } from '@/components/podcasts/forms/SpeakerProfileFormDialog'
import { EpisodeProfileFormDialog } from '@/components/podcasts/forms/EpisodeProfileFormDialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useEpisodeProfiles, useSpeakerProfiles } from '@/lib/hooks/use-podcasts'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { SpeakerProfile, EpisodeProfile } from '@/lib/types/podcasts'

const ALL_CATEGORIES = [
  'Interview',
  'Educational',
  'News',
  'Storytelling',
  'Tech Talk',
  'Roundtable',
  'Tutorial',
  'Deep Dive',
  'Professional',
  'Business',
  'Casual',
  'Dramatic',
]

interface SpeakerTemplate {
  name: string
  description: string
  category: string
  speakers: { name: string; voice_id: string; backstory: string; personality: string }[]
}

interface EpisodeTemplate {
  name: string
  description: string
  category: string
  default_briefing: string
  num_segments: number
}

const SPEAKER_TEMPLATES: SpeakerTemplate[] = [
  {
    name: 'Interview Host',
    description: 'Professional interviewer with balanced conversational style',
    category: 'Interview',
    speakers: [
      { name: 'Host', voice_id: 'alloy', backstory: 'Experienced podcast host with a background in journalism', personality: 'Curious, empathetic, and articulate. Asks insightful follow-up questions.' },
    ],
  },
  {
    name: 'News Anchor',
    description: 'Authoritative news delivery with clear pronunciation',
    category: 'News',
    speakers: [
      { name: 'Anchor', voice_id: 'echo', backstory: 'Former broadcast journalist with 15 years of experience', personality: 'Professional, composed, and informative. Delivers facts with clarity.' },
    ],
  },
  {
    name: 'Storyteller Duo',
    description: 'Two narrators for dynamic storytelling',
    category: 'Storytelling',
    speakers: [
      { name: 'Narrator', voice_id: 'alloy', backstory: 'Published author and audiobook narrator', personality: 'Engaging, expressive, and dramatic. Brings stories to life.' },
      { name: 'Commentator', voice_id: 'nova', backstory: 'Literary critic and cultural commentator', personality: 'Witty, insightful, and thought-provoking.' },
    ],
  },
  {
    name: 'Educator',
    description: 'Patient teacher who breaks down complex topics',
    category: 'Educational',
    speakers: [
      { name: 'Teacher', voice_id: 'shimmer', backstory: 'University professor with a gift for explaining complex ideas', personality: 'Patient, encouraging, and thorough. Uses analogies and examples.' },
    ],
  },
  {
    name: 'Tech Talk Host',
    description: 'Enthusiastic tech expert for deep technical discussions',
    category: 'Tech Talk',
    speakers: [
      { name: 'Tech Host', voice_id: 'onyx', backstory: 'Software architect and tech conference speaker', personality: 'Enthusiastic, knowledgeable, and detail-oriented. Loves diving into technical details.' },
    ],
  },
  {
    name: 'Casual Chat',
    description: 'Relaxed conversational style for laid-back episodes',
    category: 'Casual',
    speakers: [
      { name: 'Chat Host', voice_id: 'nova', backstory: 'Friendly podcaster who loves casual conversations', personality: 'Warm, funny, and relatable. Makes listeners feel like friends.' },
    ],
  },
  {
    name: 'AI Architect',
    description: 'Expert breakdown of AI systems, architecture, and real-world applications',
    category: 'Tech Talk',
    speakers: [
      { name: 'AI Architect', voice_id: 'onyx', backstory: 'ML engineer turned AI solutions architect, builds production AI systems daily', personality: 'Technical but accessible. Explains complex architectures with practical examples. Focuses on what actually works in production.' },
    ],
  },
  {
    name: 'Startup Advisor',
    description: 'Seasoned founder who shares actionable startup advice',
    category: 'Professional',
    speakers: [
      { name: 'Advisor', voice_id: 'echo', backstory: 'Serial entrepreneur with 3 exits, now advising early-stage startups', personality: 'Direct, experienced, and pragmatic. Shares hard-won lessons, avoids hype. Focuses on fundamentals: customers, revenue, and focus.' },
    ],
  },
  {
    name: 'Marketing Strategist',
    description: 'Expert in digital marketing, growth, and brand building',
    category: 'Professional',
    speakers: [
      { name: 'Strategist', voice_id: 'nova', backstory: 'Former head of growth at a Series B startup, now running a marketing consultancy', personality: 'Data-driven, creative, and results-oriented. Translates marketing jargon into clear, actionable strategies.' },
    ],
  },
  {
    name: 'YouTube Creator',
    description: 'Experienced YouTuber sharing content strategy and creator economy insights',
    category: 'Casual',
    speakers: [
      { name: 'Creator', voice_id: 'alloy', backstory: 'YouTuber with 500K subscribers who grew from zero in 18 months', personality: 'Energetic, authentic, and practical. Shares real numbers, real strategies, and real mistakes. Talks like a friend who figured it out.' },
    ],
  },
  {
    name: 'Business Analyst',
    description: 'Sharp market analysis and industry trend breakdowns',
    category: 'Professional',
    speakers: [
      { name: 'Analyst', voice_id: 'shimmer', backstory: 'Former Wall Street analyst covering tech and SaaS companies', personality: 'Analytical, precise, and evidence-based. Uses data to tell stories and spot trends others miss.' },
    ],
  },
  {
    name: 'Customer Interviewer',
    description: 'Probes deep into customer needs, pain points, and use cases',
    category: 'Interview',
    speakers: [
      { name: 'Interviewer', voice_id: 'alloy', backstory: 'Product researcher who has conducted 500+ customer interviews', personality: 'Empathetic, curious, and focused on understanding the "why" behind customer behavior. Asks the questions founders forget to ask.' },
    ],
  },
]

const EPISODE_TEMPLATES: EpisodeTemplate[] = [
  {
    name: 'Interview',
    description: 'Classic Q&A format with a guest',
    category: 'Interview',
    default_briefing: 'Welcome to today\'s episode. Our guest will share their insights and experience. Let\'s dive into a thoughtful conversation exploring their journey, key lessons, and advice for our listeners.',
    num_segments: 5,
  },
  {
    name: 'Educational Deep Dive',
    description: 'In-depth exploration of a topic',
    category: 'Educational',
    default_briefing: 'Today we\'re exploring a fascinating topic in depth. We\'ll start with the basics, then build up to advanced concepts, using real-world examples to illustrate key points.',
    num_segments: 7,
  },
  {
    name: 'News Roundup',
    description: 'Weekly news summary and analysis',
    category: 'News',
    default_briefing: 'Here\'s your weekly news roundup. We\'ll cover the most important stories, provide context and analysis, and discuss what they mean for you.',
    num_segments: 6,
  },
  {
    name: 'Story Time',
    description: 'Narrative-driven episode with dramatic elements',
    category: 'Storytelling',
    default_briefing: 'Sit back and enjoy today\'s story. We\'ll take you on a journey through events, characters, and emotions, painting a vivid picture with our words.',
    num_segments: 8,
  },
  {
    name: 'Tech Talk',
    description: 'Technical discussion for developers and engineers',
    category: 'Tech Talk',
    default_briefing: 'Welcome to Tech Talk. Today we\'re diving into the technical details of a key concept. We\'ll cover architecture, implementation, best practices, and real-world case studies.',
    num_segments: 6,
  },
  {
    name: 'Roundtable Discussion',
    description: 'Multiple perspectives on a single topic',
    category: 'Roundtable',
    default_briefing: 'Welcome to our roundtable discussion. We\'ll present multiple viewpoints on today\'s topic, explore different angles, and find common ground.',
    num_segments: 6,
  },
  {
    name: 'AI Industry Update',
    description: 'Latest AI developments, model releases, and practical applications',
    category: 'Tech Talk',
    default_briefing: 'Welcome to our AI industry update. We\'ll break down the latest model releases, research breakthroughs, and what they actually mean for builders and businesses. No hype — just what matters and what to do about it.',
    num_segments: 7,
  },
  {
    name: 'Startup Pitch Breakdown',
    description: 'Analyze a startup\'s pitch, market, and strategy',
    category: 'Professional',
    default_briefing: 'In today\'s episode, we\'re breaking down a startup\'s pitch and business model. We\'ll evaluate the market opportunity, competitive positioning, unit economics, and what we\'d do differently. Real feedback, not just praise.',
    num_segments: 6,
  },
  {
    name: 'Market Analysis',
    description: 'Deep dive into a market segment with data and trends',
    category: 'Professional',
    default_briefing: 'Welcome to our market analysis episode. We\'re examining a specific market segment with real data: size, growth rates, competitive landscape, and where the opportunities are hiding.',
    num_segments: 7,
  },
  {
    name: 'YouTube Strategy Session',
    description: 'Content strategy, algorithm tips, and growth tactics for YouTube creators',
    category: 'Casual',
    default_briefing: 'Welcome to our YouTube strategy session. We\'re covering what\'s working right now on YouTube: content formats, thumbnail strategies, SEO, community building, and monetization. Real numbers from real channels.',
    num_segments: 6,
  },
  {
    name: 'Customer Story',
    description: 'Narrate real customer use cases and success stories',
    category: 'Storytelling',
    default_briefing: 'Today we\'re sharing a real customer story. We\'ll walk through the challenge they faced, the solution they built, and the results they achieved. These are the stories that don\'t make the marketing page.',
    num_segments: 5,
  },
  {
    name: 'Tool Comparison',
    description: 'Head-to-head comparison of tools, frameworks, or platforms',
    category: 'Educational',
    default_briefing: 'Welcome to our tool comparison. We\'re putting two solutions head-to-head: features, pricing, performance, and the trade-offs nobody talks about. By the end, you\'ll know which one fits your needs.',
    num_segments: 5,
  },
]

export function TemplatesTab() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [speakerTemplate, setSpeakerTemplate] = useState<SpeakerProfile | null>(null)
  const [episodeTemplate, setEpisodeTemplate] = useState<EpisodeProfile | null>(null)
  const [speakerTemplateOpen, setSpeakerTemplateOpen] = useState(false)
  const [episodeTemplateOpen, setEpisodeTemplateOpen] = useState(false)

  const {
    episodeProfiles,
    isLoading: loadingEpisodeProfiles,
    error: episodeProfilesError,
  } = useEpisodeProfiles()

  const {
    speakerProfiles,
    usage,
    isLoading: loadingSpeakerProfiles,
    error: speakerProfilesError,
  } = useSpeakerProfiles(episodeProfiles)

  const isLoading = loadingEpisodeProfiles || loadingSpeakerProfiles
  const hasError = episodeProfilesError || speakerProfilesError

  const filteredSpeakerProfiles = useMemo(() => {
    return speakerProfiles.filter((p) => {
      const matchesSearch = !search ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.description && p.description.toLowerCase().includes(search.toLowerCase()))
      const matchesCategory = !activeCategory || p.category === activeCategory
      return matchesSearch && matchesCategory
    })
  }, [speakerProfiles, search, activeCategory])

  const filteredEpisodeProfiles = useMemo(() => {
    return episodeProfiles.filter((p) => {
      const matchesSearch = !search ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.description && p.description.toLowerCase().includes(search.toLowerCase()))
      const matchesCategory = !activeCategory || p.category === activeCategory
      return matchesSearch && matchesCategory
    })
  }, [episodeProfiles, search, activeCategory])

  const usedCategories = useMemo(() => {
    const cats = new Set<string>()
    for (const p of speakerProfiles) {
      if (p.category) cats.add(p.category)
    }
    for (const p of episodeProfiles) {
      if (p.category) cats.add(p.category)
    }
    return ALL_CATEGORIES.filter((c) => cats.has(c))
  }, [speakerProfiles, episodeProfiles])

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{t('podcasts.templatesWorkspaceTitle')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('podcasts.templatesWorkspaceDesc')}
        </p>
      </div>

      <Accordion type="single" collapsible className="w-full">
        <AccordionItem
          value="overview"
          className="overflow-hidden rounded-xl border border-border bg-muted/40 px-4"
        >
          <AccordionTrigger className="gap-2 py-4 text-left text-sm font-semibold">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-primary" />
              {t('podcasts.howTemplatesPowerTitle')}
            </div>
          </AccordionTrigger>
          <AccordionContent className="text-sm text-muted-foreground">
            <div className="space-y-4">
              <p className="text-muted-foreground/90">
                {t('podcasts.howTemplatesPowerDesc')}
              </p>

              <div className="space-y-2">
                <h4 className="font-medium text-foreground">{t('podcasts.episodeProfilesSetFormat')}</h4>
                <ul className="list-disc space-y-1 pl-5">
                  <li>{t('podcasts.episodeProfilesList1')}</li>
                  <li>{t('podcasts.episodeProfilesList2')}</li>
                  <li>{t('podcasts.episodeProfilesList3')}</li>
                </ul>
              </div>

              <div className="space-y-2">
                <h4 className="font-medium text-foreground">{t('podcasts.speakerProfilesBringVoices')}</h4>
                <ul className="list-disc space-y-1 pl-5">
                  <li>{t('podcasts.speakerProfilesList1')}</li>
                  <li>{t('podcasts.speakerProfilesList2')}</li>
                  <li>{t('podcasts.speakerProfilesList3')}</li>
                </ul>
              </div>

              <div className="space-y-2">
                <h4 className="font-medium text-foreground">{t('podcasts.recommendedWorkflow')}</h4>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>{t('podcasts.workflowStep1')}</li>
                  <li>{t('podcasts.workflowStep2')}</li>
                  <li>{t('podcasts.workflowStep3')}</li>
                </ol>
                <p className="text-xs text-muted-foreground/80">
                  {t('podcasts.workflowHint')}
                </p>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {hasError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('podcasts.failedToLoadTemplates')}</AlertTitle>
          <AlertDescription>
            {t('podcasts.failedToLoadTemplatesDesc')}
          </AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && (speakerProfiles.length > 0 || episodeProfiles.length > 0) && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search profiles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background pl-9 pr-3 text-sm"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted"
              >
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
          </div>

          {usedCategories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setActiveCategory(null)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  activeCategory === null
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                All
              </button>
              {usedCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    activeCategory === cat
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('podcasts.loadingTemplates')}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Quick Start Templates</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Create profiles instantly from pre-built templates. Click to customize before saving.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {SPEAKER_TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.name}
                  onClick={() => {
                    setSpeakerTemplate({
                      id: '',
                      name: tmpl.name,
                      description: tmpl.description,
                      category: tmpl.category,
                      voice_model: null,
                      speakers: tmpl.speakers,
                    } as SpeakerProfile)
                    setSpeakerTemplateOpen(true)
                  }}
                  className="text-left rounded-lg border p-3 hover:bg-muted/50 transition-colors space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <Mic className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate">{tmpl.name}</span>
                    <Badge variant="secondary" className="text-[10px] ml-auto shrink-0">{tmpl.category}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{tmpl.description}</p>
                </button>
              ))}
              {EPISODE_TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.name}
                  onClick={() => {
                    setEpisodeTemplate({
                      id: '',
                      name: tmpl.name,
                      description: tmpl.description,
                      category: tmpl.category,
                      speaker_config: speakerProfiles[0]?.name ?? '',
                      outline_llm: null,
                      transcript_llm: null,
                      language: null,
                      default_briefing: tmpl.default_briefing,
                      num_segments: tmpl.num_segments,
                    } as EpisodeProfile)
                    setEpisodeTemplateOpen(true)
                  }}
                  className="text-left rounded-lg border p-3 hover:bg-muted/50 transition-colors space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate">{tmpl.name}</span>
                    <Badge variant="secondary" className="text-[10px] ml-auto shrink-0">{tmpl.category}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{tmpl.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <SpeakerProfilesPanel
              speakerProfiles={filteredSpeakerProfiles}
              usage={usage}
            />
            <EpisodeProfilesPanel
              episodeProfiles={filteredEpisodeProfiles}
              speakerProfiles={speakerProfiles}
            />
          </div>
        </>
      )}

      <SpeakerProfileFormDialog
        mode="create"
        open={speakerTemplateOpen}
        onOpenChange={setSpeakerTemplateOpen}
        initialData={speakerTemplate ?? undefined}
      />

      <EpisodeProfileFormDialog
        mode="create"
        open={episodeTemplateOpen}
        onOpenChange={setEpisodeTemplateOpen}
        speakerProfiles={speakerProfiles}
        initialData={episodeTemplate ?? undefined}
      />
    </div>
  )
}
