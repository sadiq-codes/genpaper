import type React from "react"
import type { Metadata } from "next"
import { Geist, Geist_Mono, Caveat } from "next/font/google"
import "./globals.css"
import { AuthProvider } from "@/components/providers/AuthProvider"
import { getUser } from "@/lib/auth/cached"

// Global error handler removed - using unified API error handling

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://genpaper.app'),
  title: {
    default: "GenPaper - AI Research Paper Generator",
    template: "%s | GenPaper",
  },
  description: "Generate high-quality research papers with AI assistance. Create literature reviews, theses, dissertations, and academic articles with intelligent writing support.",
  keywords: ["AI writing", "research paper generator", "academic writing", "literature review", "thesis writing", "dissertation", "citation management"],
  authors: [{ name: "GenPaper" }],
  creator: "GenPaper",
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    other: [
      { rel: 'android-chrome-192x192', url: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { rel: 'android-chrome-512x512', url: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
  },
  manifest: '/site.webmanifest',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://genpaper.app',
    siteName: 'GenPaper',
    title: 'GenPaper - AI Research Paper Generator',
    description: 'Generate high-quality research papers with AI assistance. Create literature reviews, theses, dissertations, and academic articles.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'GenPaper - AI Research Paper Generator',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GenPaper - AI Research Paper Generator',
    description: 'Generate high-quality research papers with AI assistance.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const user = await getUser()
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} ${caveat.variable} antialiased`} suppressHydrationWarning={true}>
        <AuthProvider initialUser={user}>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
