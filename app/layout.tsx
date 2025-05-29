import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AuthButton from "./components/AuthButton";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GenPaper - AI Research Assistant",
  description: "Generate research papers with AI assistance",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning={true}
      >
        <header className="bg-gray-800 text-white p-4">
          <nav className="max-w-7xl mx-auto flex justify-between items-center">
            <h1 className="text-xl font-bold">GenPaper</h1>
            <AuthButton />
          </nav>
        </header>
        <main>
          {children}
        </main>
      </body>
    </html>
  );
}
