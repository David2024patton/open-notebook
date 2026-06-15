'use client'

import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { TFunction } from 'i18next'
import {
  Home,
  ArrowLeft,
  ArrowRight,
  Plus,
  Search,
  Book,
  FileText,
  Settings
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface NavItem {
  name: string
  icon: React.ElementType
  href?: string
  action?: () => void
}

const getNavItems = (t: TFunction) => [
  { name: t('navigation.sources'), icon: FileText, href: '/sources' },
  { name: t('navigation.notebooks'), icon: Book, href: '/notebooks' },
  { name: t('navigation.askAndSearch'), icon: Search, href: '/search' },
  { name: t('navigation.settings'), icon: Settings, href: '/settings' },
] as const

export function MobileNav() {
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const navItems = getNavItems(t)

  const canGoBack = typeof window !== 'undefined' && window.history.length > 1
  const canGoForward = false // Cannot reliably detect forward history

  const handleHome = () => {
    router.push('/notebooks')
  }

  const handleBack = () => {
    if (canGoBack) {
      router.back()
    }
  }

  const handleForward = () => {
    if (canGoForward) {
      router.forward()
    }
  }

  const isActive = (href: string) => pathname?.startsWith(href) || false

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-background border-t border-border">
      <div className="flex items-center justify-between h-14 px-4">
        {/* Left side - Back/Forward */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            disabled={!canGoBack}
            className="h-9 w-9 p-0"
            aria-label={t('common.back')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleForward}
            disabled={!canGoForward}
            className="h-9 w-9 p-0"
            aria-label={t('common.forward')}
          >
            <ArrowRight className="h-5 w-5" />
          </Button>
        </div>

        {/* Center - Home button */}
        <Button
          variant="default"
          size="sm"
          onClick={handleHome}
          className="h-10 w-10 p-0 rounded-full bg-primary hover:bg-primary/90"
          aria-label={t('common.home')}
        >
          <Home className="h-5 w-5 text-primary-foreground" />
        </Button>

        {/* Right side - Navigation menu (max 5 items) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 p-0"
              aria-label={t('common.menu')}
            >
              <Plus className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="mb-2">
            {navItems.slice(0, 4).map((item) => (
              <DropdownMenuItem
                key={item.name}
                onSelect={() => item.href && router.push(item.href)}
                className={cn(
                  'gap-2',
                  isActive(item.href || '') && 'bg-accent'
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}