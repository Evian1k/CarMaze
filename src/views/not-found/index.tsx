'use client'

import { Button } from '@/components/ui/button'
import { navigate } from '@/lib/client'
import { Compass } from 'lucide-react'

export default function NotFoundView() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <Compass className="h-10 w-10 text-muted-foreground" />
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The page you were looking for doesn&apos;t exist or has moved. It may have been a link to a vehicle that is no longer listed.
      </p>
      <Button onClick={() => navigate('/')}>Back to homepage</Button>
    </div>
  )
}
