'use client'

import { useEffect, useState, useCallback } from 'react'
import { type RouteInfo, parseHash } from '@/lib/client'

/** Subscribe to hash-route changes (SPA navigation on the single / route). */
export function useHashRoute(): RouteInfo {
  const [route, setRoute] = useState<RouteInfo>(() => parseHash())

  const update = useCallback(() => {
    setRoute(parseHash())
  }, [])

  useEffect(() => {
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [update])

  return route
}
