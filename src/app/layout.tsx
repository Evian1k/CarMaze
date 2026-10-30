import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/layout/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "CARMAZE — Find. Connect. Drive.",
    template: "%s | CARMAZE",
  },
  description:
    "CARMAZE is Kenya's connected automotive ecosystem: buy and sell vehicles, verified dealerships, 3D customizer, trusted garages, roadside assistance and vehicle ownership records.",
  keywords: [
    "cars for sale Kenya", "vehicle marketplace Kenya", "car dealerships Nairobi",
    "sell my car Kenya", "car garage Kenya", "roadside assistance Kenya", "CARMAZE",
  ],
  applicationName: "CARMAZE",
  openGraph: {
    title: "CARMAZE — Find. Connect. Drive.",
    description:
      "Buy, sell, customise and care for vehicles on Kenya's connected automotive ecosystem.",
    siteName: "CARMAZE",
    type: "website",
    locale: "en_KE",
    images: [{ url: "/brand/carmaze-og.png", width: 1200, height: 630, alt: "CARMAZE — Find. Connect. Drive." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "CARMAZE — Find. Connect. Drive.",
    description:
      "Buy, sell, customise and care for vehicles on Kenya's connected automotive ecosystem.",
    images: ["/brand/carmaze-og.png"],
  },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#141613" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider>
          {children}
          <Toaster position="top-center" richColors />
        </ThemeProvider>
        <noscript>
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#ffffff',
              padding: '1.5rem',
              textAlign: 'center',
            }}
          >
            <p style={{ maxWidth: '28rem', fontSize: '0.9rem', lineHeight: 1.6, color: '#374151' }}>
              CARMAZE needs JavaScript to run. Please enable JavaScript in your
              browser settings and reload the page.
            </p>
          </div>
        </noscript>
      </body>
    </html>
  );
}
