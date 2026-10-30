'use client'

/*
 * CARMAZE — 3D Car Customizer view.
 * Left: live WebGL showroom (Canvas lives here; the scene contents are in
 * ./car-scene). Right: control panel where every control mutates the CarConfig
 * state and therefore the 3D scene. Saving posts the validated config to
 * /api/customizer/configs and rewrites the hash to ?cfg=<shareId> so the URL
 * itself becomes the share link; ?cfg=… restores stored configurations.
 */

import { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useTheme } from 'next-themes'
import Image from 'next/image'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  ACCESSORY_OPTIONS,
  CUSTOMIZER_MODEL_ID,
  DEFAULT_CONFIG,
  describeConfig,
  FINISH_OPTIONS,
  paintName,
  PAINTS,
  rimColorName,
  RIM_COLORS,
  RIM_STYLE_OPTIONS,
  type CarConfig,
} from '@/components/customizer/presets'
import { CarScene, type OrbitControlsRef } from '@/components/customizer/car-scene'
import { apiGet, apiSend, ClientApiError, navigate } from '@/lib/client'
import { KENYA_COUNTIES } from '@/lib/format'
import { useHashRoute } from '@/hooks/use-hash-route'
import { useAuth } from '@/stores/auth'
import { toast } from 'sonner'
import { Camera, Car, Check, Copy, Info, Loader2, RotateCcw, Share2, Wrench } from 'lucide-react'

type WebGLState = 'checking' | 'ok' | 'unsupported'

type QuoteResponse = {
  refCode?: string
  request?: { refCode?: string }
  serviceRequest?: { refCode?: string }
}

function rideLabel(v: number): string {
  if (v > 0.005) return `Lifted +${v.toFixed(2)}`
  if (v < -0.005) return `Lowered ${v.toFixed(2)}`
  return 'Standard ride height'
}

export default function View() {
  const route = useHashRoute()
  const cfgParam = route.query.get('cfg')
  const user = useAuth((s) => s.user)
  const { resolvedTheme } = useTheme()

  const [webgl, setWebgl] = useState<WebGLState>('checking')
  const [config, setConfig] = useState<CarConfig>(DEFAULT_CONFIG)
  const [configId, setConfigId] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [signinOpen, setSigninOpen] = useState(false)
  const [shareLink, setShareLink] = useState('')
  const [copied, setCopied] = useState(false)

  // Quote form
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [quoteCounty, setQuoteCounty] = useState('')
  const [quoteTown, setQuoteTown] = useState('')
  const [quoteDesc, setQuoteDesc] = useState('')
  const [quoteVehicle, setQuoteVehicle] = useState('')
  const [descDirty, setDescDirty] = useState(false)
  const [requesting, setRequesting] = useState(false)

  const controlsRef = useRef<OrbitControlsRef | null>(null)
  const appliedRef = useRef<string | null>(null)
  const configIdRef = useRef<string | null>(null)
  const savedSnapshotRef = useRef<string | null>(null)

  // ── WebGL capability probe (async so we never setState in the effect body) ──
  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      try {
        const probe = document.createElement('canvas')
        const supported = Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'))
        setWebgl(supported ? 'ok' : 'unsupported')
      } catch {
        setWebgl('unsupported')
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // ── Restore a shared configuration from ?cfg=<shareId> ──
  useEffect(() => {
    if (!cfgParam || appliedRef.current === cfgParam) return
    appliedRef.current = cfgParam
    let cancelled = false
    apiGet<{ modelId: string; config: CarConfig; createdAt: string; views: number }>(
      `/api/customizer/configs/${encodeURIComponent(cfgParam)}`
    )
      .then((data) => {
        if (cancelled) return
        setConfig(data.config)
        setConfigId(cfgParam)
        configIdRef.current = cfgParam
        savedSnapshotRef.current = JSON.stringify(data.config)
        setShareLink(`${window.location.origin}/#/customizer?cfg=${cfgParam}`)
        setBanner(null)
      })
      .catch(() => {
        if (cancelled) return
        setBanner('This shared configuration is no longer available — showing default setup')
        setConfigId(null)
        configIdRef.current = null
        savedSnapshotRef.current = null
      })
    return () => {
      cancelled = true
    }
  }, [cfgParam])

  function patch(p: Partial<CarConfig>) {
    setConfig((c) => ({ ...c, ...p }))
  }

  function resetAll() {
    setConfig(DEFAULT_CONFIG)
    setBanner(null)
    controlsRef.current?.reset()
    toast('Setup reset to the showroom default')
  }

  /** POST the current config (deduped) and return its share id. */
  async function ensureSaved(current: CarConfig): Promise<string | null> {
    const snapshot = JSON.stringify(current)
    if (configIdRef.current && savedSnapshotRef.current === snapshot) return configIdRef.current
    setSaving(true)
    try {
      const res = await apiSend<{ shareId: string }>('/api/customizer/configs', 'POST', {
        modelId: CUSTOMIZER_MODEL_ID,
        config: current,
      })
      configIdRef.current = res.shareId
      savedSnapshotRef.current = snapshot
      setConfigId(res.shareId)
      setShareLink(`${window.location.origin}/#/customizer?cfg=${res.shareId}`)
      appliedRef.current = res.shareId
      // Make the current URL the share link itself.
      navigate(`customizer?cfg=${res.shareId}`, { replace: true })
      return res.shareId
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : 'Could not save the configuration. Please try again.')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveAndShare() {
    if (!user) {
      setSigninOpen(true)
      return
    }
    const id = await ensureSaved(config)
    if (id) setShareOpen(true)
  }

  async function handleQuoteClick() {
    if (!user) {
      setSigninOpen(true)
      return
    }
    const id = await ensureSaved(config)
    if (!id) return
    if (!descDirty) setQuoteDesc(describeConfig(config))
    setQuoteOpen(true)
  }

  async function submitQuote() {
    if (!configId) {
      toast.error('Save the configuration first.')
      return
    }
    if (!quoteCounty) {
      toast.error('Select your county so garages can respond.')
      return
    }
    setRequesting(true)
    try {
      const data = await apiSend<QuoteResponse>('/api/service-requests', 'POST', {
        category: 'MODIFICATIONS',
        description: quoteDesc.trim() || describeConfig(config),
        county: quoteCounty,
        town: quoteTown.trim() || undefined,
        configId,
        vehicleDesc: quoteVehicle.trim() || undefined,
      })
      const ref = data.refCode ?? data.request?.refCode ?? data.serviceRequest?.refCode
      toast.success(ref ? `Quote request ${ref} received` : 'Quote request received', {
        description: 'Nearby garages can now quote. Quotes appear in your account requests tab.',
      })
      setQuoteOpen(false)
      setDescDirty(false)
    } catch (e) {
      if (e instanceof ClientApiError && e.status === 401) {
        setQuoteOpen(false)
        setSigninOpen(true)
        return
      }
      toast.error(e instanceof ClientApiError ? e.message : 'Could not submit the request. Please try again.')
    } finally {
      setRequesting(false)
    }
  }

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(shareLink)
      setCopied(true)
      toast.success('Link copied to clipboard')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Copy failed — select the link text and copy manually.')
    }
  }

  const swatchButton = (hex: string, name: string, active: boolean, onSelect: () => void, keyPrefix: string) => (
    <button
      key={`${keyPrefix}-${hex}`}
      type="button"
      onClick={onSelect}
      title={name}
      aria-label={`${name}${active ? ' (selected)' : ''}`}
      aria-pressed={active}
      className={`flex h-11 w-full items-center justify-center rounded-xl border transition-transform hover:scale-[1.04] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${
        active ? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-background' : 'border-border'
      }`}
    >
      <span className="h-7 w-7 rounded-full border border-black/10 shadow-inner" style={{ backgroundColor: hex }} />
    </button>
  )

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-12 pt-6 sm:px-6">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">3D Studio</h1>
          <p className="text-sm text-muted-foreground">
            Build your Sedan Classic — paint, rims, glass, stance. Every control updates the live model.
          </p>
        </div>
        <Badge variant="outline" className="ml-auto gap-1.5">
          <Car className="h-3.5 w-3.5" aria-hidden="true" />
          Sedan Classic · {configId ? `Shared (${configId})` : 'Unsaved draft'}
        </Badge>
      </div>

      {banner && (
        <Alert className="mb-5">
          <Info className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>{banner}</AlertDescription>
        </Alert>
      )}

      {webgl === 'unsupported' ? (
        <WebglFallback />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* ── Showroom canvas ── */}
          <div className="relative h-[52vh] overflow-hidden rounded-2xl border bg-[#EFEFEA] shadow-sm lg:h-[64vh] dark:bg-[#191c18]">
            {webgl === 'ok' && (
              <Canvas
                dpr={[1, 1.75]}
                shadows="soft"
                camera={{ position: [4.2, 1.8, 5.2], fov: 40 }}
                gl={{ antialias: true, alpha: true }}
              >
                <Suspense
                  fallback={
                    <Html center>
                      <div className="rounded-full bg-background/85 px-4 py-2 text-xs text-muted-foreground shadow-sm">
                        Preparing showroom…
                      </div>
                    </Html>
                  }
                >
                  <CarScene config={config} controlsRef={controlsRef} dark={resolvedTheme === 'dark'} />
                </Suspense>
              </Canvas>
            )}
            {webgl === 'checking' && (
              <div className="flex h-full items-center justify-center">
                <Skeleton className="h-full w-full rounded-none" />
              </div>
            )}

            <div className="pointer-events-none absolute left-3 top-3">
              <Badge className="bg-[#202421]/85 text-[#F7F7F5] hover:bg-[#202421]/85">Drag to orbit · Pinch or scroll to zoom</Badge>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="absolute right-3 top-3 gap-1.5"
              onClick={() => controlsRef.current?.reset()}
              aria-label="Reset camera position"
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              Camera
            </Button>
          </div>

          {/* ── Control panel ── */}
          <Card className="self-start">
            <CardContent className="p-4">
              <Tabs defaultValue="paint">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="paint">Paint</TabsTrigger>
                  <TabsTrigger value="wheels">Wheels</TabsTrigger>
                  <TabsTrigger value="stance">Stance</TabsTrigger>
                </TabsList>

                {/* Paint & finish */}
                <TabsContent value="paint" className="mt-4 space-y-5">
                  <div>
                    <Label className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Paint</Label>
                    <div className="grid grid-cols-5 gap-2" role="group" aria-label="Paint color swatches">
                      {PAINTS.map((p) => swatchButton(p.hex, p.name, config.paint.toLowerCase() === p.hex.toLowerCase(), () => patch({ paint: p.hex }), 'paint'))}
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <input
                        type="color"
                        value={config.paint}
                        onChange={(e) => patch({ paint: e.target.value.toUpperCase() })}
                        aria-label="Custom paint color"
                        className="h-9 w-12 cursor-pointer rounded-lg border bg-background p-1"
                      />
                      <span className="font-mono text-xs text-muted-foreground">{config.paint.toUpperCase()} · {paintName(config.paint)}</span>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <Label className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Finish</Label>
                    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Paint finish">
                      {FINISH_OPTIONS.map((f) => (
                        <Button
                          key={f.value}
                          type="button"
                          size="sm"
                          variant={config.finish === f.value ? 'default' : 'outline'}
                          aria-pressed={config.finish === f.value}
                          onClick={() => patch({ finish: f.value })}
                        >
                          {f.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </TabsContent>

                {/* Wheels & glass */}
                <TabsContent value="wheels" className="mt-4 space-y-5">
                  <div>
                    <Label className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Rim style</Label>
                    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Rim style">
                      {RIM_STYLE_OPTIONS.map((r) => (
                        <Button
                          key={r.value}
                          type="button"
                          size="sm"
                          variant={config.rimStyle === r.value ? 'default' : 'outline'}
                          aria-pressed={config.rimStyle === r.value}
                          onClick={() => patch({ rimStyle: r.value })}
                        >
                          {r.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Rim color</Label>
                    <div className="grid grid-cols-6 gap-2" role="group" aria-label="Rim color swatches">
                      {RIM_COLORS.map((r) => swatchButton(r.hex, r.name, config.rimColor.toLowerCase() === r.hex.toLowerCase(), () => patch({ rimColor: r.hex }), 'rim'))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">Selected: {rimColorName(config.rimColor)}</p>
                  </div>

                  <Separator />

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">Glass tint</Label>
                      <span className="text-xs font-medium">{Math.round(config.glassTint * 100)}%</span>
                    </div>
                    <Slider
                      value={[config.glassTint]}
                      min={0}
                      max={0.9}
                      step={0.05}
                      onValueChange={(v) => patch({ glassTint: v[0] ?? 0 })}
                      aria-label="Glass tint"
                    />
                  </div>
                </TabsContent>

                {/* Stance & accessories */}
                <TabsContent value="stance" className="mt-4 space-y-5">
                  <div>
                    <Label className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Accessory</Label>
                    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Accessory">
                      {ACCESSORY_OPTIONS.map((a) => (
                        <Button
                          key={a.value}
                          type="button"
                          size="sm"
                          variant={config.accessory === a.value ? 'default' : 'outline'}
                          aria-pressed={config.accessory === a.value}
                          onClick={() => patch({ accessory: a.value })}
                        >
                          {a.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">Ride height</Label>
                      <span className="text-xs font-medium">{rideLabel(config.rideHeight)}</span>
                    </div>
                    <Slider
                      value={[config.rideHeight]}
                      min={-0.06}
                      max={0.1}
                      step={0.01}
                      onValueChange={(v) => patch({ rideHeight: v[0] ?? 0 })}
                      aria-label="Ride height"
                    />
                    <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                      <span>Lowered</span>
                      <span>Lifted</span>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              <Separator className="my-4" />

              <p className="min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground">{describeConfig(config)}</p>

              {/* Actions */}
              <div className="mt-3 grid gap-2">
                <Button type="button" onClick={handleSaveAndShare} disabled={saving} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Share2 className="h-4 w-4" aria-hidden="true" />}
                  {saving ? 'Saving…' : 'Save & Share'}
                </Button>
                <Button type="button" variant="outline" onClick={handleQuoteClick} disabled={saving} className="gap-2">
                  <Wrench className="h-4 w-4" aria-hidden="true" />
                  Request garage quote
                </Button>
                <Button type="button" variant="ghost" onClick={resetAll} className="gap-2">
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Reset setup
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <p className="mt-6 flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Configurations are validated and stored server-side; share links restore the exact setup.
      </p>

      {/* ── Share success dialog ── */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Configuration saved</DialogTitle>
            <DialogDescription>
              Anyone with this link opens the studio with this exact setup already applied.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={shareLink} aria-label="Share link" className="font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button type="button" size="sm" variant="outline" onClick={copyShareLink} className="shrink-0 gap-1.5">
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setShareOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Sign-in prompt ── */}
      <Dialog open={signinOpen} onOpenChange={setSigninOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Sign in to continue</DialogTitle>
            <DialogDescription>
              Create a free account or sign in to save configurations, share them and request garage quotes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setSigninOpen(false)}>
              Not now
            </Button>
            <Button
              type="button"
              onClick={() => {
                setSigninOpen(false)
                navigate('signin')
              }}
            >
              Sign in
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Garage quote request dialog ── */}
      <Dialog open={quoteOpen} onOpenChange={setQuoteOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request garage quotes</DialogTitle>
            <DialogDescription>
              Send this build to garages near you for modification quotes. Your saved configuration is attached automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full border border-black/10" style={{ backgroundColor: config.paint }} aria-hidden="true" />
                {paintName(config.paint)} ({config.finish})
              </Badge>
              <Badge variant="outline">
                {RIM_STYLE_OPTIONS.find((r) => r.value === config.rimStyle)?.label} rims · {rimColorName(config.rimColor)}
              </Badge>
              {config.accessory !== 'none' && (
                <Badge variant="outline">{ACCESSORY_OPTIONS.find((a) => a.value === config.accessory)?.label}</Badge>
              )}
              <Badge variant="outline">Tint {Math.round(config.glassTint * 100)}%</Badge>
              <Badge variant="outline">{rideLabel(config.rideHeight)}</Badge>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="quote-county">County</Label>
              <Select value={quoteCounty} onValueChange={setQuoteCounty}>
                <SelectTrigger id="quote-county" aria-label="County">
                  <SelectValue placeholder="Select county" />
                </SelectTrigger>
                <SelectContent>
                  {KENYA_COUNTIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="quote-town">Town (optional)</Label>
              <Input id="quote-town" value={quoteTown} onChange={(e) => setQuoteTown(e.target.value)} placeholder="e.g. Westlands" maxLength={60} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="quote-desc">What should the garage do?</Label>
              <Textarea
                id="quote-desc"
                rows={4}
                value={quoteDesc}
                onChange={(e) => {
                  setQuoteDesc(e.target.value)
                  setDescDirty(true)
                }}
                placeholder="Describe the work…"
                maxLength={2000}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="quote-vehicle">Your vehicle (optional)</Label>
              <Input id="quote-vehicle" value={quoteVehicle} onChange={(e) => setQuoteVehicle(e.target.value)} placeholder="e.g. 2018 Toyota Axio, silver" maxLength={120} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setQuoteOpen(false)} disabled={requesting}>
              Cancel
            </Button>
            <Button type="button" onClick={submitQuote} disabled={requesting || !quoteCounty} className="gap-2">
              {requesting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {requesting ? 'Sending…' : 'Send request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Static fallback for browsers without WebGL. */
function WebglFallback() {
  return (
    <Card className="overflow-hidden">
      <div className="relative h-56 w-full bg-[#202421] sm:h-72">
        <Image src="/images/hero.png" alt="CARMAZE showroom sedan illustration" fill className="object-cover" priority />
      </div>
      <CardContent className="space-y-3 p-6">
        <h2 className="text-lg font-semibold">3D Studio needs WebGL</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Your browser or device does not support WebGL, which powers the live 3D customizer. You can still browse the
          marketplace and request modification quotes from verified garages — our team can apply any configuration with
          you directly.
        </p>
        <Button type="button" onClick={() => navigate('cars')} className="gap-2">
          <Car className="h-4 w-4" aria-hidden="true" />
          Browse cars
        </Button>
      </CardContent>
    </Card>
  )
}
