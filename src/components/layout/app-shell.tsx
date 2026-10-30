'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, ChevronDown, LayoutDashboard, LogOut, Menu, Search, Settings, User, Wrench } from 'lucide-react'
import { Logo } from '@/components/brand/logo'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { navigate, type RouteInfo } from '@/lib/client'
import { useAuth, hasAnyRole, isStaffUser } from '@/stores/auth'
import { timeAgo } from '@/lib/format'
import { apiGet, apiSend } from '@/lib/client'
import { CommandPalette, openCommandPalette } from '@/components/layout/command-palette'
import { MobileTabBar, BackToTop } from '@/components/layout/mobile-tabbar'

type NotificationItem = {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  readAt: string | null
  createdAt: string
}

const NAV = [
  { label: 'Cars', href: '/cars' },
  { label: 'Sell a Car', href: '/sell' },
  { label: 'Showrooms', href: '/showrooms' },
  { label: 'Customizer', href: '/customizer' },
  { label: 'Garages', href: '/garages' },
  { label: 'Roadside Help', href: '/roadside' },
  { label: 'Community', href: '/community' },
]

export function AppShell({ route, children }: { route: RouteInfo; children: React.ReactNode }) {
  const { user, unreadNotifications, refreshNotifications, logout } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [scrolled, setScrolled] = useState(false)

  // Header gains elevation once the page scrolls — depth cue for the blur bar.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const active = (href: string) => route.view === href.replace(/^\//, '').split('?')[0]

  function go(href: string) {
    navigate(href)
    setMobileOpen(false)
  }

  async function openBell() {
    const next = !bellOpen
    setBellOpen(next)
    if (next && user) {
      try {
        const data = await apiGet<{ notifications: NotificationItem[] }>('/api/notifications?take=10')
        setNotifications(data.notifications)
        await apiSend('/api/notifications', 'PATCH', { all: true })
        refreshNotifications()
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <div className="flex min-h-screen flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
        Skip to content
      </a>
      <header
        className={cn(
          'sticky top-0 z-40 border-b border-transparent bg-background/85 backdrop-blur-md transition-[border-color,box-shadow] duration-300',
          scrolled && 'border-border/70 shadow-[0_1px_12px_rgba(0,0,0,0.06)]'
        )}
      >
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-3 sm:px-6">
          <button
            onClick={() => navigate('/')}
            className="flex shrink-0 items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="CARMAZE home"
          >
            <Logo size="sm" className="sm:hidden" />
            <Logo size="md" className="hidden sm:flex md:hidden" />
            <Logo size="lg" className="hidden md:flex" />
          </button>

          <nav className="ml-4 hidden flex-1 items-center gap-0.5 lg:flex" aria-label="Primary">
            {NAV.map((item) => (
              <button
                key={item.href}
                onClick={() => go(item.href)}
                className={cn(
                  'rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  active(item.href) && 'bg-muted text-foreground'
                )}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex flex-1 items-center justify-end gap-1.5 lg:flex-none">
            <Button
              variant="ghost"
              size="icon"
              onClick={openCommandPalette}
              aria-label="Quick search (Command K)"
              title="Quick search (⌘K)"
            >
              <Search className="h-5 w-5" />
            </Button>
            {user ? (
              <>
                <DropdownMenu open={bellOpen} onOpenChange={(o) => { if (o !== bellOpen) openBell() }}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Notifications${unreadNotifications ? ` (${unreadNotifications} unread)` : ''}`} className="relative">
                      <Bell className="h-5 w-5" />
                      {unreadNotifications > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground">
                          {unreadNotifications > 9 ? '9+' : unreadNotifications}
                        </span>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-80 scrollbar-thin max-h-[70vh] overflow-y-auto">
                    <DropdownMenuLabel className="flex items-center justify-between">
                      Notifications
                      {notifications.length === 0 && <span className="text-xs font-normal text-muted-foreground">None yet</span>}
                    </DropdownMenuLabel>
                    {notifications.length === 0 ? (
                      <div className="px-3 py-6 text-center text-sm text-muted-foreground">You have no notifications yet.</div>
                    ) : (
                      notifications.map((n) => (
                        <DropdownMenuItem
                          key={n.id}
                          className="flex cursor-pointer flex-col items-start gap-0.5 py-2.5"
                          onClick={() => {
                            if (n.link) navigate(n.link)
                            setBellOpen(false)
                          }}
                        >
                          <span className="line-clamp-1 w-full text-sm font-medium">{n.title}</span>
                          {n.body && <span className="line-clamp-2 w-full text-xs text-muted-foreground">{n.body}</span>}
                          <span className="text-[10px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                        </DropdownMenuItem>
                      ))
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="cursor-pointer" onClick={() => { navigate('/account?tab=notifications'); setBellOpen(false) }}>
                      View all notifications
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5 px-2.5">
                      <span className="hidden max-w-24 truncate sm:inline">{user.name.split(' ')[0]}</span>
                      <User className="h-4 w-4 sm:hidden" />
                      <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>
                      <div className="text-sm font-medium">{user.name}</div>
                      <div className="truncate text-xs font-normal text-muted-foreground">{user.email}</div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="cursor-pointer" onClick={() => navigate('/account')}>
                      <User className="mr-2 h-4 w-4" /> My Account
                    </DropdownMenuItem>
                    <DropdownMenuItem className="cursor-pointer" onClick={() => navigate('my-listings')}>
                      <LayoutDashboard className="mr-2 h-4 w-4" /> My Listings
                    </DropdownMenuItem>
                    <DropdownMenuItem className="cursor-pointer" onClick={() => navigate('my-garage')}>
                      <Wrench className="mr-2 h-4 w-4" /> My Garage
                    </DropdownMenuItem>
                    {hasAnyRole(user, 'DEALER_OWNER', 'DEALER_STAFF') && (
                      <DropdownMenuItem className="cursor-pointer" onClick={() => navigate('dealer')}>
                        <LayoutDashboard className="mr-2 h-4 w-4" /> DealerOS
                      </DropdownMenuItem>
                    )}
                    {hasAnyRole(user, 'GARAGE_OWNER', 'GARAGE_STAFF') && (
                      <DropdownMenuItem className="cursor-pointer" onClick={() => navigate('garage-dashboard')}>
                        <Wrench className="mr-2 h-4 w-4" /> Garage Dashboard
                      </DropdownMenuItem>
                    )}
                    {isStaffUser(user) && (
                      <DropdownMenuItem className="cursor-pointer" onClick={() => navigate('admin')}>
                        <Settings className="mr-2 h-4 w-4" /> Control Center
                        <Badge variant="secondary" className="ml-auto">staff</Badge>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive" onClick={() => logout()}>
                      <LogOut className="mr-2 h-4 w-4" /> Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => navigate('signin')}>
                  Sign In
                </Button>
                <Button size="sm" onClick={() => navigate('signin?mode=register')} className="hidden sm:inline-flex">
                  Get Started
                </Button>
              </>
            )}

            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="lg:hidden" aria-label="Open menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72">
                <SheetTitle>
                  <Logo size="md" />
                </SheetTitle>
                <nav className="mt-4 flex flex-col gap-1" aria-label="Mobile">
                  {NAV.map((item) => (
                    <button
                      key={item.href}
                      onClick={() => go(item.href)}
                      className={cn(
                        'rounded-lg px-3 py-2.5 text-left text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
                        active(item.href) && 'bg-muted text-foreground'
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                  <div className="my-2 border-t border-border" />
                  <button onClick={() => go('my-garage')} className="rounded-lg px-3 py-2.5 text-left text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                    My Garage
                  </button>
                  <button onClick={() => go('my-listings')} className="rounded-lg px-3 py-2.5 text-left text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                    My Listings
                  </button>
                  <button onClick={() => go('info?view=faq')} className="rounded-lg px-3 py-2.5 text-left text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                    FAQ &amp; Help
                  </button>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        {children}
      </main>

      <footer className="mt-auto border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-4">
          <div>
            <Logo size="lg" showTagline />
            <p className="mt-3 max-w-56 text-xs leading-relaxed text-muted-foreground">
              Kenya&apos;s connected automotive ecosystem. Buy, sell, customise and care for vehicles — all in one place.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Marketplace</h3>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li><button className="hover:text-foreground" onClick={() => navigate('cars')}>Browse cars</button></li>
              <li><button className="hover:text-foreground" onClick={() => navigate('sell')}>Sell your car</button></li>
              <li><button className="hover:text-foreground" onClick={() => navigate('showrooms')}>Verified showrooms</button></li>
              <li><button className="hover:text-foreground" onClick={() => navigate('customizer')}>3D customizer</button></li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Services</h3>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li><button className="hover:text-foreground" onClick={() => navigate('garages')}>Find a garage</button></li>
              <li><button className="hover:text-foreground" onClick={() => navigate('roadside')}>Roadside assistance</button></li>
              <li><button className="hover:text-foreground" onClick={() => navigate('my-garage')}>My Garage records</button></li>
              <li><button className="hover:text-foreground" onClick={() => navigate('dealer')}>DealerOS for dealers</button></li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Company</h3>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li><button className="hover:text-foreground" onClick={() => navigate('info?view=about')}>About &amp; contact</button></li>
              <li><button className="hover:text-foreground" onClick={() => navigate('info?view=faq')}>FAQ</button></li>
              <li><button className="hover:text-foreground" onClick={() => navigate('info?view=terms')}>Terms of Service</button></li>
              <li><button className="hover:text-foreground" onClick={() => navigate('info?view=privacy')}>Privacy Policy</button></li>
              <li><button className="hover:text-foreground" onClick={() => navigate('info?view=safety')}>Trust &amp; safety</button></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border">
          <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:px-6">
            <span>© {new Date().getFullYear()} CARMAZE. Nairobi, Kenya. All rights reserved.</span>
            <span>Vehicle payments are arranged directly between buyers and sellers. CARMAZE is not an emergency service.</span>
          </div>
        </div>
      </footer>

      <MobileTabBar route={route} />
      <BackToTop />
      <CommandPalette />
    </div>
  )
}
