'use client'

import { create } from 'zustand'
import { useEffect } from 'react'
import { apiGet, apiSend } from '@/lib/client'

export type CurrentUser = {
  id: string
  email: string
  name: string
  phone: string | null
  phoneVerified: boolean
  emailVerified?: boolean
  mfaEnabled?: boolean
  department?: string | null
  roles: string[]
  status: string
  isDemo?: boolean
  createdAt?: string
}

/** Active demo-session scope (from the session JWT, surfaced by /api/auth/me). */
export type DemoSessionInfo = { active: true; roleKey: string; expiresAt: string } | null

export type ApplicationProgress = {
  id: string
  refCode: string
  type: 'DEALER' | 'GARAGE' | 'SELLER' | 'LOGISTICS' | 'SUPPLIER'
  status: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'MORE_INFO_REQUIRED' | 'RESUBMITTED' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'REVOKED'
  orgName: string
  submittedAt: string | null
  decisionNote: string | null
  infoRequestedAt: string | null
  correctionsDueAt: string | null
  createdAt: string
}

type AuthState = {
  user: CurrentUser | null
  applications: ApplicationProgress[]
  demo: DemoSessionInfo
  loading: boolean
  unreadNotifications: number
  refresh: () => Promise<void>
  logout: () => Promise<void>
  refreshNotifications: () => Promise<void>
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  applications: [],
  demo: null,
  loading: true,
  unreadNotifications: 0,
  refresh: async () => {
    try {
      const data = await apiGet<{ user: CurrentUser | null; applications?: ApplicationProgress[]; demo?: DemoSessionInfo }>('/api/auth/me')
      set({ user: data.user, applications: data.user ? (data.applications ?? []) : [], demo: data.user ? (data.demo ?? null) : null, loading: false })
      if (data.user) {
        apiGet<{ unread: number }>('/api/notifications?unread=1&count=1')
          .then((d) => set({ unreadNotifications: d.unread ?? 0 }))
          .catch(() => {})
      } else {
        set({ unreadNotifications: 0 })
      }
    } catch {
      set({ user: null, applications: [], demo: null, loading: false })
    }
  },
  logout: async () => {
    try {
      await apiSend('/api/auth/logout', 'POST')
    } finally {
      set({ user: null, applications: [], demo: null, unreadNotifications: 0 })
      window.location.hash = '#/'
      window.location.reload()
    }
  },
  refreshNotifications: async () => {
    try {
      const d = await apiGet<{ unread: number }>('/api/notifications?unread=1&count=1')
      set({ unreadNotifications: d.unread ?? 0 })
    } catch {
      /* ignore */
    }
  },
}))

/** Fetch session once on app mount. */
export function useAuthInit() {
  const refresh = useAuth((s) => s.refresh)
  useEffect(() => {
    refresh()
  }, [refresh])
}

export function hasAnyRole(user: CurrentUser | null, ...roles: string[]): boolean {
  if (!user) return false
  return roles.some((r) => user.roles.includes(r))
}

export function isStaffUser(user: CurrentUser | null): boolean {
  return hasAnyRole(user, 'SUPPORT', 'REVIEWER', 'MODERATOR', 'FINANCE', 'ADMIN', 'FOUNDER')
}
