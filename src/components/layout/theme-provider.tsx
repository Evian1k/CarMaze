'use client'

/* Theme provider: wires next-themes into the CARMAZE app shell.
 *
 * - attribute="class": toggling adds/removes `.dark` on <html>, which flips
 *   the token palette defined in globals.css (warm off-white ↔ charcoal).
 * - defaultTheme="light": the brand was designed light-first; dark mode is
 *   opt-in via the header toggle and persisted under `carmaze-theme`.
 * - disableTransitionOnChange: prevents the ugly half-second where every
 *   element cross-fades its colors at different speeds on toggle.
 */

import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from 'next-themes'

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      storageKey="carmaze-theme"
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}
