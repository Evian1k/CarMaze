import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
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
  },
  twitter: {
    card: "summary_large_image",
    title: "CARMAZE — Find. Connect. Drive.",
    description:
      "Buy, sell, customise and care for vehicles on Kenya's connected automotive ecosystem.",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#315E4B",
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
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
