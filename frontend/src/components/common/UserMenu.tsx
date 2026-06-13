'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/lib/hooks/use-auth'
import { useAuthStore } from '@/lib/stores/auth-store'
import { LogOut, User, Bell, X, Check, ChevronDown, Shield, BookOpen } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Notification {
  id: string
  for_user: string
  from_user?: string
  title: string
  message: string
  notification_type: string
  is_read: boolean
  link?: string
  created: string
}

export function UserMenu() {
  const { user, logout } = useAuth()
  const { token } = useAuthStore()
  const [isOpen, setIsOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [showNotifications, setShowNotifications] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const notifDropdownRef = useRef<HTMLDivElement>(null)

  const apiBase = process.env.NEXT_PUBLIC_API_URL || ''
  const getHeaders = () => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) h['Authorization'] = `Bearer ${token}`
    return h
  }

  useEffect(() => {
    if (!token) return
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 30000)
    return () => clearInterval(interval)
  }, [token])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
      if (notifDropdownRef.current && !notifDropdownRef.current.contains(event.target as Node)) {
        setShowNotifications(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const fetchNotifications = async () => {
    try {
      const res = await fetch(`${apiBase}/api/auth/notifications`, { headers: getHeaders() })
      if (res.ok) {
        const data = await res.json()
        setNotifications(data)
        setUnreadCount(data.filter((n: Notification) => !n.is_read).length)
      }
    } catch (e) {
      console.error('Failed to fetch notifications', e)
    }
  }

  const markAsRead = async (id: string) => {
    try {
      await fetch(`${apiBase}/api/auth/notifications/${id}/read`, {
        method: 'POST',
        headers: getHeaders(),
      })
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, is_read: true } : n))
      )
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch (e) {
      console.error('Failed to mark notification as read', e)
    }
  }

  const markAllAsRead = async () => {
    try {
      await fetch(`${apiBase}/api/auth/notifications/read-all`, {
        method: 'POST',
        headers: getHeaders(),
      })
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
      setUnreadCount(0)
    } catch (e) {
      console.error('Failed to mark all notifications as read', e)
    }
  }

  const deleteNotification = async (id: string) => {
    try {
      await fetch(`${apiBase}/api/auth/notifications/${id}`, {
        method: 'DELETE',
        headers: getHeaders(),
      })
      setNotifications(prev => prev.filter(n => n.id !== id))
      setUnreadCount(prev => {
        const notif = notifications.find(n => n.id === id)
        return notif && !notif.is_read ? Math.max(0, prev - 1) : prev
      })
    } catch (e) {
      console.error('Failed to delete notification', e)
    }
  }

  if (!user) return null

  const getInitials = () => {
    const name = user.display_name || user.username
    const parts = name.split(' ').filter(Boolean)
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase()
    }
    return name.slice(0, 2).toUpperCase()
  }

  const initials = getInitials()

  const roleBadgeColor = {
    superuser: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    admin: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    user: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  }[user.role] || 'bg-gray-100 text-gray-800'

  return (
    <div className="flex items-center gap-2">
      {/* Notification Bell */}
      <div className="relative" ref={notifDropdownRef}>
        <button
          onClick={() => setShowNotifications(!showNotifications)}
          className="relative p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <Bell className={cn("h-5 w-5", unreadCount > 0 ? "text-yellow-500" : "text-gray-500")} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-5 w-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-bold animate-pulse">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {showNotifications && (
          <div className="absolute right-0 top-full mt-2 w-80 max-h-[420px] overflow-hidden rounded-lg border bg-white dark:bg-gray-900 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-lg">Notifications</h3>
              <div className="flex gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => setShowNotifications(false)}
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto max-h-[420px]">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  No notifications
                </div>
              ) : (
                notifications.map((notif) => (
                  <div
                    key={notif.id}
                    className={cn(
                      "p-4 border-b hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors",
                      !notif.is_read && "bg-blue-50 dark:bg-blue-950/30"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm truncate">{notif.title}</p>
                          {!notif.is_read && (
                            <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                          )}
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          {notif.message}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          {new Date(notif.created).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!notif.is_read && (
                          <button
                            onClick={() => markAsRead(notif.id)}
                            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                            title="Mark as read"
                          >
                            <Check className="h-4 w-4 text-green-600" />
                          </button>
                        )}
                        <button
                          onClick={() => deleteNotification(notif.id)}
                          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                          title="Delete"
                        >
                          <X className="h-4 w-4 text-red-500" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* User Avatar & Menu */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <div
            className="h-9 w-9 rounded-full flex items-center justify-center text-white font-semibold text-sm overflow-hidden border-2 border-white dark:border-gray-800 shadow-sm"
            style={{ backgroundColor: user.avatar_url ? 'transparent' : (user.avatar_color || '#6366f1') }}
          >
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <ChevronDown className="h-4 w-4 text-gray-500" />
        </button>

        {isOpen && (
          <div className="absolute right-0 top-full mt-2 w-64 rounded-lg border bg-white dark:bg-gray-900 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
            <div className="p-4 border-b bg-gray-50 dark:bg-gray-800/50">
              <div className="flex items-center gap-3">
                <div
                  className="h-12 w-12 rounded-full flex items-center justify-center text-white font-bold text-lg overflow-hidden border-2 border-white dark:border-gray-700 shadow-md"
                  style={{ backgroundColor: user.avatar_url ? 'transparent' : (user.avatar_color || '#6366f1') }}
                >
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    initials
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{user.display_name || user.username}</p>
                  <p className="text-sm text-gray-500 truncate">{user.email}</p>
                  <span className={cn("inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium", roleBadgeColor)}>
                    {user.role}
                  </span>
                </div>
              </div>
            </div>
            <div className="py-1">
              <button
                onClick={() => { window.location.href = '/settings/profile'; setIsOpen(false) }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <User className="h-4 w-4 text-gray-500" />
                Profile Settings
              </button>
              {(user.role === 'admin' || user.role === 'superuser') && (
                <button
                  onClick={() => { window.location.href = '/settings/admin'; setIsOpen(false) }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <Shield className="h-4 w-4 text-gray-500" />
                  Admin Settings
                </button>
              )}
              <button
                onClick={() => { window.location.href = '/settings/api-endpoints'; setIsOpen(false) }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <BookOpen className="h-4 w-4 text-gray-500" />
                API Endpoints
              </button>
              <button
                onClick={logout}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 text-red-600 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function NotificationBell() {
  return null
}
