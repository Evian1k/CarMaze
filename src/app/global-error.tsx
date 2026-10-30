'use client'

/* Global error screen — the final safety net that catches failures at the
 * root level (outside layout/page trees). It renders its own <html>/<body>
 * with inline styles only, because global stylesheets may not be present
 * when this fires. Stale-chunk crashes auto-reload exactly once. */

import { useEffect } from 'react'
import { sessionGet, sessionSet } from '@/lib/safe-storage'

const CHUNK_ERROR = /ChunkLoadError|Loading chunk [\d]+ failed|dynamically imported module/i

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[CARMAZE] global error:', error)
    if (CHUNK_ERROR.test(`${error.name} ${error.message}`)) {
      try {
        if (sessionGet('carmaze_chunk_recovered') !== '1') {
          sessionSet('carmaze_chunk_recovered', '1')
          window.location.reload()
          return
        }
      } catch {
        /* storage blocked — fall through to the recovery UI */
      }
    }
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F7F7F5',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          padding: '1.5rem',
        }}
        role="alert"
      >
        <div
          style={{
            width: '100%',
            maxWidth: '26rem',
            textAlign: 'center',
            background: '#ffffff',
            border: '1px solid #e5e3de',
            borderRadius: '1rem',
            padding: '2rem',
            boxShadow: '0 1px 12px rgba(0,0,0,0.06)',
          }}
        >
          {/* Official brand emblem — never redrawn or re-typed */}
          <img
            src="/brand/carmaze-logo-128.png"
            alt="CARMAZE — Find. Connect. Drive."
            width={96}
            height={96}
            style={{ width: 96, height: 96, objectFit: 'contain', borderRadius: 12 }}
          />
          <h1 style={{ margin: '1rem 0 0.35rem', fontSize: '1.1rem', color: '#1c1c1a' }}>
            Something hit a bump
          </h1>
          <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.6, color: '#6b6b66' }}>
            The application hit an unexpected error while starting. Reloading
            usually gets you back on the road.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: '1.25rem',
              height: '2.75rem',
              padding: '0 1.5rem',
              borderRadius: '0.6rem',
              border: 'none',
              background: '#315E4B',
              color: '#ffffff',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload CARMAZE
          </button>
        </div>
      </body>
    </html>
  )
}
