'use client'

/* ⌘K command palette — quick navigation + vehicle search in one place.
 * Opens with Cmd/Ctrl+K, the header search button, or "/" shortcut. */

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import {
  Car, Wrench, LifeBuoy, Users, Sparkles, Store, LayoutDashboard, User,
  Search, LogIn, LogOut, KeyRound, Settings, FolderKanban, Home, CircleHelp, Handshake,
  SunMoon, Package, ShoppingCart, Truck,
} from 'lucide-react'
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandSeparator,
} from '@/components/ui/command'
import { navigate } from '@/lib/client'
import { useAuth, hasAnyRole, isStaffUser } from '@/stores/auth'

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent('carmaze:palette'))
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { user, logout } = useAuth()
  const { resolvedTheme, setTheme } = useTheme()

  useEffect(() => {
    const onOpen = () => setOpen(true)
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('carmaze:palette', onOpen)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('carmaze:palette', onOpen)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  function go(href: string) {
    setOpen(false)
    setQuery('')
    navigate(href)
  }

  const pages = [
    { icon: Home, label: 'Home', href: '/' },
    { icon: Car, label: 'Browse cars', href: '/cars' },
    { icon: KeyRound, label: 'Sell a car', href: '/sell' },
    { icon: Store, label: 'Showrooms', href: '/showrooms' },
    { icon: Package, label: 'Supply Network', href: '/supply' },
    { icon: Truck, label: 'Logistics Network — delivery partners & delivery requests', href: '/logistics' },
    { icon: Users, label: 'Business Memberships', href: '/memberships' },
    { icon: Sparkles, label: '3D customizer', href: '/customizer' },
    { icon: Wrench, label: 'Find a garage', href: '/garages' },
    { icon: LifeBuoy, label: 'Roadside help', href: '/roadside' },
    { icon: Handshake, label: 'Partner network', href: '/partners' },
    { icon: Users, label: 'Community', href: '/community' },
    { icon: FolderKanban, label: 'My Garage', href: '/my-garage' },
    { icon: ShoppingCart, label: 'Procurement (GarageOS)', href: '/procurement' },
    { icon: Package, label: 'Supplier Portal', href: '/supplier' },
    { icon: LayoutDashboard, label: 'My Listings', href: '/my-listings' },
    { icon: User, label: 'My Account', href: '/account' },
    { icon: CircleHelp, label: 'FAQ & Help', href: '/info?view=faq' },
  ]

  return (
    <CommandDialog open={open} onOpenChange={setOpen} aria-label="Quick navigation">
      <CommandInput
        placeholder="Search cars or jump to a page…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="scrollbar-thin">
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Search">
          <CommandItem
            value={`search vehicles ${query}`}
            onSelect={() => go(query.trim() ? `/cars?q=${encodeURIComponent(query.trim())}` : '/cars')}
          >
            <Search className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>
              Search vehicles{query.trim() ? <> for “<span className="font-medium">{query.trim()}</span>”</> : ''}
            </span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup heading="Platform">
          {pages.map((p) => (
            <CommandItem key={p.href} value={p.label} onSelect={() => go(p.href)}>
              <p.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              {p.label}
            </CommandItem>
          ))}
        </CommandGroup>

        {(hasAnyRole(user ?? null, 'DEALER_OWNER', 'DEALER_STAFF') || hasAnyRole(user ?? null, 'GARAGE_OWNER', 'GARAGE_STAFF') || hasAnyRole(user ?? null, 'LOGISTICS_OWNER') || isStaffUser(user ?? null)) && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Workspaces">
              {hasAnyRole(user ?? null, 'DEALER_OWNER', 'DEALER_STAFF') && (
                <CommandItem value="DealerOS dealer dashboard" onSelect={() => go('/dealer')}>
                  <LayoutDashboard className="mr-2 h-4 w-4 text-muted-foreground" /> DealerOS
                </CommandItem>
              )}
              {hasAnyRole(user ?? null, 'GARAGE_OWNER', 'GARAGE_STAFF') && (
                <CommandItem value="Garage dashboard" onSelect={() => go('/garage-dashboard')}>
                  <Wrench className="mr-2 h-4 w-4 text-muted-foreground" /> Garage Dashboard
                </CommandItem>
              )}
              {hasAnyRole(user ?? null, 'LOGISTICS_OWNER') && (
                <CommandItem value="LogisticsOS delivery operations" onSelect={() => go('/logistics')}>
                  <Truck className="mr-2 h-4 w-4 text-muted-foreground" /> LogisticsOS — delivery operations
                </CommandItem>
              )}
              {isStaffUser(user ?? null) && (
                <CommandItem value="Control center admin" onSelect={() => go('/admin')}>
                  <Settings className="mr-2 h-4 w-4 text-muted-foreground" /> Control Center
                </CommandItem>
              )}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="Appearance">
          <CommandItem
            value="toggle theme dark light mode appearance"
            onSelect={() => {
              setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
              setOpen(false)
            }}
          >
            <SunMoon className="mr-2 h-4 w-4 text-muted-foreground" />
            Switch to <span className="font-medium">{resolvedTheme === 'dark' ? 'light' : 'dark'}</span>&nbsp;mode
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup heading="Account">
          {user ? (
            <CommandItem value="Sign out" onSelect={() => { setOpen(false); logout() }}>
              <LogOut className="mr-2 h-4 w-4 text-muted-foreground" />
              Sign out ({user.name.split(' ')[0]})
            </CommandItem>
          ) : (
            <>
              <CommandItem value="Sign in" onSelect={() => go('/signin')}>
                <LogIn className="mr-2 h-4 w-4 text-muted-foreground" /> Sign in
              </CommandItem>
              <CommandItem value="Create account register" onSelect={() => go('/signin?mode=register')}>
                <User className="mr-2 h-4 w-4 text-muted-foreground" /> Create account
              </CommandItem>
            </>
          )}
        </CommandGroup>
      </CommandList>
      <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        Press <kbd className="rounded border border-border bg-muted px-1 font-sans">Esc</kbd> to close
      </div>
    </CommandDialog>
  )
}
