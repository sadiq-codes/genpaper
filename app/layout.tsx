import type React from "react"
import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"

import AuthButton from "./components/AuthButton"
import { QueryProvider } from "@/lib/tanstack-query/provider"
import { ErrorBoundary } from "@/components/ErrorBoundary"

// Initialize global error handler
import "@/lib/error-handling/global-error-handler"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "GenPaper - AI Research Assistant",
  description: "Generate research papers with AI assistance",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning={true}>
        <ErrorBoundary>
          <QueryProvider>
            <main>{children}</main>
          </QueryProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}
