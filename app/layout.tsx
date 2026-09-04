import type React from "react"
import type { Metadata } from "next"
import { Geist, Geist_Mono, Caveat, Instrument_Serif } from "next/font/google"
import Script from "next/script"
import "./globals.css"
import { AuthProvider } from "@/components/providers/AuthProvider"
import { TopLoadingBar } from "@/components/ui/top-loading-bar"
import { FoglampHUDClient } from "@/components/FoglampHUDClient"
import { getUser } from "@/lib/auth/cached"
import { isAppError } from "@/lib/errors"

const GA_MEASUREMENT_ID = "G-ZYDPFH365F"

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

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
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
    icon: '/icon',
    apple: '/apple-icon',
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
        url: '/opengraph-image',
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
    images: ['/twitter-image'],
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
  let user: Awaited<ReturnType<typeof getUser>> = null
  try {
    user = await getUser()
  } catch (error) {
    // Do not crash the whole app shell on transient auth dependency outages.
    if (isAppError(error) && error.code === 'SERVICE_UNAVAILABLE') {
      console.warn('RootLayout: transient auth outage, rendering with unauthenticated initial state')
    } else {
      throw error
    }
  }
  return (
    <html lang="en">
      <head>
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');
          `}
        </Script>
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} ${caveat.variable} ${instrumentSerif.variable} antialiased`} suppressHydrationWarning={true}>
        <FoglampHUDClient />
        <TopLoadingBar />
        <AuthProvider initialUser={user}>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
