'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useSidebarStore } from '@/lib/stores/sidebar-store'
import { useCreateDialogs } from '@/lib/hooks/use-create-dialogs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ThemeToggle } from '@/components/common/ThemeToggle'
import { LanguageToggle } from '@/components/common/LanguageToggle'
import type { TFunction } from 'i18next'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  FileText,
  Book,
  Search,
  Mic,
  Bot,
  Shuffle,
  Settings,
  ChevronLeft,
  ChevronRight,
  Plus,
  Wrench,
} from 'lucide-react'

const getNavigation = (t: TFunction) => [
  {
    title: t('navigation.collect'),
    items: [
      { name: t('navigation.sources'), href: '/sources', icon: FileText },
    ],
  },
  {
    title: t('navigation.process'),
    items: [
      { name: t('navigation.notebooks'), href: '/notebooks', icon: Book },
      { name: t('navigation.askAndSearch'), href: '/search', icon: Search },
    ],
  },
  {
    title: t('navigation.create'),
    items: [
      { name: t('navigation.podcasts'), href: '/podcasts', icon: Mic },
    ],
  },
  {
    title: t('navigation.manage'),
    items: [
      { name: t('navigation.models'), href: '/settings/api-keys', icon: Bot },
      { name: t('navigation.transformations'), href: '/transformations', icon: Shuffle },
      { name: t('navigation.settings'), href: '/settings', icon: Settings },
      { name: t('navigation.advanced'), href: '/advanced', icon: Wrench },
    ],
  },
] as const

type CreateTarget = 'source' | 'notebook' | 'podcast'

export function AppSidebar() {
  const { t } = useTranslation()
  const navigation = getNavigation(t)
  const pathname = usePathname()
  const { isCollapsed, toggleCollapse } = useSidebarStore()
  const { openSourceDialog, openNotebookDialog, openPodcastDialog } = useCreateDialogs()
  const [createMenuOpen, setCreateMenuOpen] = useState(false)

  const handleCreateSelection = (target: CreateTarget) => {
    setCreateMenuOpen(false)
    if (target === 'source') openSourceDialog()
    else if (target === 'notebook') openNotebookDialog()
    else if (target === 'podcast') openPodcastDialog()
  }

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'on-sidebar',
          isCollapsed ? 'w-14' : 'w-56'
        )}
      >
        {/* Collapse toggle */}
        <div className="on-sidebar-header">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleCollapse}
            className="on-sidebar-toggle"
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Create button */}
        <div className="on-sidebar-create">
          <DropdownMenu open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
            {isCollapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" className="on-create-btn-icon">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="right">{t('common.create')}</TooltipContent>
              </Tooltip>
            ) : (
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="on-create-btn">
                  <Plus className="h-4 w-4" />
                  {t('common.create')}
                </Button>
              </DropdownMenuTrigger>
            )}
            <DropdownMenuContent align={isCollapsed ? 'end' : 'start'} side={isCollapsed ? 'right' : 'bottom'} className="w-44">
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); handleCreateSelection('source') }}>
                <FileText className="h-4 w-4" /> {t('common.source')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); handleCreateSelection('notebook') }}>
                <Book className="h-4 w-4" /> {t('common.notebook')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); handleCreateSelection('podcast') }}>
                <Mic className="h-4 w-4" /> {t('common.podcast')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Navigation sections */}
        <nav className="on-sidebar-nav">
          {navigation.map((section, index) => (
            <div key={section.title} className="on-nav-section">
              {index > 0 && <div className="on-nav-divider" />}

              {!isCollapsed && (
                <div className="on-nav-label">{section.title}</div>
              )}

              <div className="on-nav-items">
                {section.items.map((item) => {
                  const isActive = pathname?.startsWith(item.href) || false
                  const content = (
                    <span className={cn('on-nav-item', isActive && 'on-nav-item-active')}>
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!isCollapsed && <span className="on-nav-item-text">{item.name}</span>}
                    </span>
                  )

                  if (isCollapsed) {
                    return (
                      <Tooltip key={item.name}>
                        <TooltipTrigger asChild>
                          <Link href={item.href}>{content}</Link>
                        </TooltipTrigger>
                        <TooltipContent side="right">{item.name}</TooltipContent>
                      </Tooltip>
                    )
                  }

                  return (
                    <Link key={item.name} href={item.href}>
                      {content}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom controls */}
        <div className="on-sidebar-footer">
          <ThemeToggle iconOnly={isCollapsed} />
          <LanguageToggle iconOnly={isCollapsed} />
        </div>
      </aside>
    </TooltipProvider>
  )
}
