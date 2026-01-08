import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <h2 className="text-2xl font-bold mb-4">Page Not Found</h2>
      <p className="text-muted-foreground mb-6">Could not find the requested page.</p>
      <Link 
        href="/"
        className="text-primary hover:underline"
      >
        Return Home
      </Link>
    </div>
  )
}
