'use client'

import { useState } from 'react'
import { Copy, Check, ChevronDown, ChevronRight, BookOpen, FileText, Mic, Search, MessageSquare, Users, Settings, Key, Wand2, Lightbulb, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

interface Action {
  title: string
  description: string
  steps: string[]
  tip?: string
  endpoint?: { method: string; path: string; body?: string }
}

interface ActionGroup {
  title: string
  description: string
  icon: React.ReactNode
  actions: Action[]
}

const ACTION_GROUPS: ActionGroup[] = [
  {
    title: 'Getting Started',
    description: 'First steps to set up your account',
    icon: <Lightbulb className="h-4 w-4" />,
    actions: [
      {
        title: 'Log in to your account',
        description: 'Get your API token to use all other features.',
        steps: [
          'Go to Settings > API Keys to find your base URL',
          'Send a POST request with your email and password',
          'Copy the "access_token" from the response',
          'Use it in all future requests as: Authorization: Bearer YOUR_TOKEN'
        ],
        endpoint: { method: 'POST', path: '/api/auth/login', body: '{"email": "you@example.com", "password": "your-password"}' }
      },
      {
        title: 'Update your profile',
        description: 'Change your display name, email, or avatar.',
        steps: [
          'Send a PUT request to update your info',
          'For avatars, use DiceBear URLs or upload a base64 image'
        ],
        endpoint: { method: 'PUT', path: '/api/auth/me', body: '{"display_name": "Your Name", "email": "you@example.com"}' }
      },
      {
        title: 'Change your password',
        description: 'Update your account password.',
        steps: [
          'Provide your current password and new password',
          'The new password must be at least 8 characters'
        ],
        endpoint: { method: 'POST', path: '/api/auth/change-password', body: '{"current_password": "old", "new_password": "new"}' }
      }
    ]
  },
  {
    title: 'Add Content (Sources)',
    description: 'Import articles, documents, and web pages to build your knowledge base',
    icon: <FileText className="h-4 w-4" />,
    actions: [
      {
        title: 'Add a web page',
        description: 'Paste any URL and the system will fetch, parse, and index the content automatically.',
        steps: [
          'Send the URL to the sources endpoint',
          'Wait for processing (usually 10-30 seconds)',
          'The source is now searchable and can be used in notebooks and podcasts'
        ],
        endpoint: { method: 'POST', path: '/api/sources', body: '{"url": "https://example.com/article", "source_type": "url"}' },
        tip: 'Works with articles, blog posts, documentation, YouTube transcripts, and most web content.'
      },
      {
        title: 'Add raw text',
        description: 'Paste text content directly — great for notes, meeting transcripts, or pasted documents.',
        steps: [
          'Send your text with a title',
          'Content is automatically indexed for search'
        ],
        endpoint: { method: 'POST', path: '/api/sources/json', body: '{"name": "Meeting Notes", "content": "Full text here...", "source_type": "text"}' }
      },
      {
        title: 'Check if a source finished processing',
        description: 'Sources go through fetch → parse → embed. Check the status before using them.',
        steps: [
          'Poll this endpoint until status is "completed"',
          'If "failed", you can retry it'
        ],
        endpoint: { method: 'GET', path: '/api/sources/{id}/status' },
        tip: 'Most sources process in under 30 seconds. Large PDFs may take longer.'
      },
      {
        title: 'Chat with a source',
        description: 'Ask questions about a specific source and get AI-powered answers based on its content.',
        steps: [
          'Create a chat session linked to the source',
          'Send messages and get AI responses',
          'The AI uses the source content as context'
        ],
        endpoint: { method: 'POST', path: '/api/chat/execute', body: '{"session_id": "chat:abc", "message": "Summarize this source"}' },
        tip: 'You can also do this from the UI — click any source and use the chat panel on the right.'
      },
      {
        title: 'Generate insights from a source',
        description: 'Let AI extract key insights, summaries, and action items from your content.',
        steps: [
          'Select a transformation (like "Summary" or "Key Insights")',
          'Execute it on the source',
          'AI generates structured insights you can save as notes'
        ],
        tip: 'From the UI: click a source > click "Generate Insight" > pick a transformation.'
      },
      {
        title: 'Download source content',
        description: 'Get the raw processed text of a source for external use.',
        steps: [
          'Request the download endpoint with the source ID',
          'Returns the full processed content'
        ],
        endpoint: { method: 'GET', path: '/api/sources/{id}/download' }
      },
      {
        title: 'Delete a source',
        description: 'Remove a source and all its embeddings permanently.',
        steps: [
          'Send a DELETE request with the source ID',
          'This cannot be undone'
        ],
        endpoint: { method: 'DELETE', path: '/api/sources/{id}' },
        tip: 'If the source is in a notebook, it will be unlinked but not deleted from your library.'
      }
    ]
  },
  {
    title: 'Organize with Notebooks',
    description: 'Group related sources into notebooks for focused research and podcast generation',
    icon: <BookOpen className="h-4 w-4" />,
    actions: [
      {
        title: 'Create a notebook',
        description: 'Start a collection to organize your sources by topic.',
        steps: [
          'Give it a name and optional description',
          'Add sources to it after creation'
        ],
        endpoint: { method: 'POST', path: '/api/notebooks', body: '{"name": "AI Research", "description": "Everything about AI"}' }
      },
      {
        title: 'Add a source to a notebook',
        description: 'Link existing sources to a notebook.',
        steps: [
          'Get the notebook ID and source ID',
          'Link them together'
        ],
        endpoint: { method: 'POST', path: '/api/notebooks/{notebook_id}/sources/{source_id}' },
        tip: 'From the UI: click a source > click "Add to Notebook" > pick a notebook.'
      },
      {
        title: 'Search within a notebook',
        description: 'Ask questions scoped to a specific notebook.',
        steps: [
          'Include the notebook_id in your search',
          'Only sources in that notebook are used as context'
        ],
        endpoint: { method: 'POST', path: '/api/search/ask', body: '{"query": "What are the key findings?", "notebook_id": "notebook:abc"}' }
      }
    ]
  },
  {
    title: 'Search & Ask Questions',
    description: 'Find information across all your sources using search or AI-powered Q&A',
    icon: <Search className="h-4 w-4" />,
    actions: [
      {
        title: 'Search your content',
        description: 'Full-text search across all sources. Returns matching excerpts.',
        steps: [
          'Send a search query',
          'Results include source titles and matching text snippets'
        ],
        endpoint: { method: 'POST', path: '/api/search', body: '{"query": "machine learning", "limit": 10}' }
      },
      {
        title: 'Ask a question (AI-powered)',
        description: 'Get an AI answer using your sources as knowledge. Like ChatGPT but grounded in YOUR data.',
        steps: [
          'Ask any question',
          'AI searches your sources and generates an answer',
          'Optional: scope to a notebook'
        ],
        endpoint: { method: 'POST', path: '/api/search/ask/simple', body: '{"query": "What are the main trends?"}' },
        tip: 'From the UI: use the Search page to ask questions across all your content.'
      }
    ]
  },
  {
    title: 'AI Chat',
    description: 'Have conversations with AI that remember your content',
    icon: <MessageSquare className="h-4 w-4" />,
    actions: [
      {
        title: 'Start a chat session',
        description: 'Create a conversation that can reference your sources.',
        steps: [
          'Create a session with an optional title',
          'Optionally link it to a notebook for focused context'
        ],
        endpoint: { method: 'POST', path: '/api/chat/sessions', body: '{"title": "Research Discussion", "notebook_id": "notebook:abc"}' }
      },
      {
        title: 'Send a message',
        description: 'Chat with AI that has access to your sources.',
        steps: [
          'Include the session ID and your message',
          'AI responds using your sources as context',
          'Supports streaming for real-time responses'
        ],
        endpoint: { method: 'POST', path: '/api/chat/execute', body: '{"session_id": "chat:abc", "message": "Tell me about..."}' },
        tip: 'From the UI: use the Chat page for a full conversational interface.'
      }
    ]
  },
  {
    title: 'Generate Podcasts',
    description: 'Turn your content into AI-narrated audio episodes',
    icon: <Mic className="h-4 w-4" />,
    actions: [
      {
        title: 'Generate a podcast episode',
        description: 'Create an audio episode from notebook content using AI voices.',
        steps: [
          'Choose an episode profile (format, length, models)',
          'Choose a speaker profile (voices, personalities)',
          'Point to a notebook as source content',
          'The system generates an outline, script, and audio'
        ],
        endpoint: { method: 'POST', path: '/api/podcasts/generate', body: '{"episode_profile": "Interview", "speaker_profile": "Host", "episode_name": "Episode 1", "notebook_id": "notebook:abc"}' },
        tip: 'First create speaker and episode profiles in Settings > Podcast Templates.'
      },
      {
        title: 'Check generation progress',
        description: 'Podcast generation is async — poll to see when it finishes.',
        steps: [
          'Use the job ID from the generate response',
          'Check until status is "completed" or "failed"'
        ],
        endpoint: { method: 'GET', path: '/api/podcasts/jobs/{job_id}' }
      },
      {
        title: 'Download the audio',
        description: 'Get the MP3 file for a completed episode.',
        steps: [
          'Use the episode ID from the completed generation',
          'Download the audio file'
        ],
        endpoint: { method: 'GET', path: '/api/podcasts/episodes/{id}/audio' },
        tip: 'From the UI: go to Podcasts page > click an episode > click the download button.'
      },
      {
        title: 'Create a speaker profile',
        description: 'Define AI voices with names, backstories, and personalities.',
        steps: [
          'Give each speaker a name and voice ID',
          'Write a backstory and personality description',
          'Choose a TTS model for the voice'
        ],
        tip: 'From the UI: go to Podcasts > Templates > click "Create Speaker". Use the Quick Start Templates for common setups.'
      },
      {
        title: 'Create an episode profile',
        description: 'Define the format: how many segments, which AI models, what language.',
        steps: [
          'Set the number of segments (3-20)',
          'Choose outline and transcript AI models',
          'Write a default briefing template',
          'Optionally set the language'
        ],
        tip: 'From the UI: go to Podcasts > Templates > click "Create Profile". Use Quick Start Templates for common formats.'
      }
    ]
  },
  {
    title: 'Manage Users (Admin)',
    description: 'Invite users, approve signups, and manage roles',
    icon: <Users className="h-4 w-4" />,
    actions: [
      {
        title: 'Generate a referral code',
        description: 'Create a single-use code that lets people sign up without admin approval.',
        steps: [
          'Choose what role the new user gets (user, admin, or superuser)',
          'Share the code with the person you want to invite',
          'They enter it during registration and get instant access'
        ],
        endpoint: { method: 'POST', path: '/api/auth/referral-codes', body: '{"role": "user"}' }
      },
      {
        title: 'Approve a signup request',
        description: 'When someone registers without a referral code, you must approve them.',
        steps: [
          'List pending signup requests',
          'Approve with a role or reject'
        ],
        endpoint: { method: 'POST', path: '/api/auth/signup-requests/{request_id}/review', body: '{"action": "approve", "role": "user"}' }
      },
      {
        title: 'Create a user directly',
        description: 'Admins can create accounts without requiring registration.',
        steps: [
          'Provide username, email, password, and role',
          'The user is created and can log in immediately'
        ],
        endpoint: { method: 'POST', path: '/api/auth/users', body: '{"username": "newuser", "email": "new@example.com", "password": "temp123", "role": "user"}' }
      },
      {
        title: 'Change a user\'s role',
        description: 'Promote or demote users between user, admin, and superuser.',
        steps: [
          'Get the user ID',
          'Set the new role'
        ],
        endpoint: { method: 'PUT', path: '/api/auth/users/{user_id}/role', body: '{"role": "admin"}' }
      }
    ]
  },
  {
    title: 'AI Models & Providers',
    description: 'Connect AI providers and manage which models power your features',
    icon: <Wand2 className="h-4 w-4" />,
    actions: [
      {
        title: 'Add an API key',
        description: 'Connect an AI provider (OpenAI, Anthropic, Google, etc.) by adding their API key.',
        steps: [
          'Go to Settings > API Keys',
          'Click "Add Provider" and enter your API key',
          'The system automatically discovers available models'
        ],
        tip: 'From the UI: Settings > API Keys > Add Provider. Supports OpenAI, Anthropic, Google, Groq, and 20+ providers including local LLMs.'
      },
      {
        title: 'Sync models from a provider',
        description: 'Fetch the latest available models from a connected provider.',
        steps: [
          'Pick the provider to sync',
          'New models are added to your registry'
        ],
        endpoint: { method: 'POST', path: '/api/models/sync/{provider}' }
      },
      {
        title: 'Set default models',
        description: 'Choose which model is used for each task (outlines, transcripts, TTS, etc.).',
        steps: [
          'View current defaults',
          'Update which model is used for each task type'
        ],
        endpoint: { method: 'PUT', path: '/api/models/defaults', body: '{"outline_model": "model:id", "transcript_model": "model:id"}' },
        tip: 'From the UI: Settings > API Keys > click "Auto-assign" to let the system pick the best models.'
      },
      {
        title: 'Test if a model works',
        description: 'Verify a model is configured correctly before using it.',
        steps: [
          'Send a test prompt to the model',
          'Check if it responds successfully'
        ],
        endpoint: { method: 'POST', path: '/api/models/{model_id}/test' }
      }
    ]
  },
  {
    title: 'Manage API Keys',
    description: 'View, test, and update your AI provider credentials',
    icon: <Key className="h-4 w-4" />,
    actions: [
      {
        title: 'View your API keys',
        description: 'See all configured provider keys (shown as masked).',
        steps: [
          'List all credentials',
          'Keys are shown as **** for security'
        ],
        endpoint: { method: 'GET', path: '/api/credentials' }
      },
      {
        title: 'Test an API key',
        description: 'Verify a key is valid before using it.',
        steps: [
          'Send a test request to the provider',
          'Check if it succeeds'
        ],
        endpoint: { method: 'POST', path: '/api/credentials/{id}/test' },
        tip: 'From the UI: Settings > API Keys > click the key > click "Test".'
      },
      {
        title: 'Discover models from a key',
        description: 'Auto-detect what models are available with your API key.',
        steps: [
          'The system queries the provider for available models',
          'Register them for use in the app'
        ],
        endpoint: { method: 'POST', path: '/api/credentials/{id}/discover' }
      }
    ]
  },
  {
    title: 'Notes & Insights',
    description: 'Save important findings and create persistent notes',
    icon: <FileText className="h-4 w-4" />,
    actions: [
      {
        title: 'Create a note',
        description: 'Save text content linked to a source.',
        steps: [
          'Write a title and content',
          'Optionally link it to a source'
        ],
        endpoint: { method: 'POST', path: '/api/notes', body: '{"title": "Key Insight", "content": "The research shows...", "source_id": "source:abc"}' }
      },
      {
        title: 'Save an AI insight as a note',
        description: 'Convert a generated insight into a permanent note.',
        steps: [
          'Generate an insight from a source first',
          'Save it as a note for future reference'
        ],
        endpoint: { method: 'POST', path: '/api/insights/{id}/save-as-note' },
        tip: 'From the UI: click a source > Insights tab > click an insight > "Save as Note".'
      }
    ]
  }
]

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  POST: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  PUT: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  DELETE: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

function ActionCard({ action }: { action: Action }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyEndpoint = () => {
    if (!action.endpoint) return
    const url = `http://localhost:5055${action.endpoint.path}`
    navigator.clipboard.writeText(url)
    setCopied(true)
    toast.success('Endpoint URL copied')
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors text-left"
      >
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{action.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{action.description}</p>
        </div>
        {action.endpoint && (
          <span className={`shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${METHOD_COLORS[action.endpoint.method] || ''}`}>
            {action.endpoint.method}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t">
          <div className="pt-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">How to do it</p>
            <ol className="space-y-1.5">
              {action.steps.map((step, i) => (
                <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                  <span className="font-mono text-foreground shrink-0">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {action.endpoint && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">API Endpoint</p>
                <button onClick={copyEndpoint} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                  Copy URL
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${METHOD_COLORS[action.endpoint.method] || ''}`}>
                  {action.endpoint.method}
                </span>
                <code className="text-xs font-mono text-foreground break-all">{action.endpoint.path}</code>
              </div>
              {action.endpoint.body && (
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Request body:</p>
                  <pre className="rounded bg-muted/50 p-2 text-[11px] overflow-x-auto border font-mono">{action.endpoint.body}</pre>
                </div>
              )}
            </div>
          )}

          {action.tip && (
            <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 p-2.5 text-xs text-blue-700 dark:text-blue-300">
              <span className="font-medium">Tip:</span> {action.tip}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ActionGroup({ group }: { group: ActionGroup }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 text-left group"
      >
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className="text-primary group-hover:text-primary/80 transition-colors">{group.icon}</span>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold">{group.title}</span>
          <span className="text-xs text-muted-foreground ml-2">{group.description}</span>
        </div>
        <span className="text-[10px] text-muted-foreground shrink-0">{group.actions.length} actions</span>
      </button>
      {expanded && (
        <div className="pl-6 space-y-2">
          {group.actions.map((action) => (
            <ActionCard key={action.title} action={action} />
          ))}
        </div>
      )}
    </div>
  )
}

export function ApiEndpointsReference() {
  const [search, setSearch] = useState('')

  const filteredGroups = ACTION_GROUPS.map((group) => ({
    ...group,
    actions: group.actions.filter((a) => {
      if (!search) return true
      const q = search.toLowerCase()
      return (
        a.title.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.steps.some(s => s.toLowerCase().includes(q)) ||
        (a.endpoint?.path.toLowerCase().includes(q))
      )
    }),
  })).filter((group) => group.actions.length > 0)

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">What can I do with this system?</h3>
        </div>
        <div className="text-xs text-muted-foreground space-y-2">
          <p>
            <strong>Cortex</strong> is an AI-powered knowledge management system. You can:
          </p>
          <ul className="list-disc pl-4 space-y-1">
            <li><strong>Add content</strong> — Import web pages, documents, and text from any source</li>
            <li><strong>Organize</strong> — Group related content into notebooks by topic</li>
            <li><strong>Search & Ask</strong> — Find information or ask AI questions across your content</li>
            <li><strong>Chat</strong> — Have conversations with AI that reference your knowledge base</li>
            <li><strong>Generate podcasts</strong> — Turn your content into AI-narrated audio episodes</li>
            <li><strong>Collaborate</strong> — Invite team members with different permission levels</li>
          </ul>
          <p className="text-muted-foreground/70">
            Use the UI at <code className="bg-background px-1 rounded">http://localhost:8502</code> for the best experience. The API is for automation and integrations.
          </p>
        </div>
      </div>

      <div className="relative">
        <input
          type="text"
          placeholder="Search for something to do..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
      </div>

      <div className="space-y-6">
        {filteredGroups.map((group) => (
          <ActionGroup key={group.title} group={group} />
        ))}
        {filteredGroups.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No actions match your search.</p>
        )}
      </div>
    </div>
  )
}
