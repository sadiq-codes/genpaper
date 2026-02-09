export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background relative flex items-center justify-center">
      {/* Background gradients */}
      <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="absolute top-0 right-1/4 w-[600px] h-[500px] bg-[radial-gradient(ellipse,oklch(0.93_0.03_250)_0%,transparent_70%)] dark:bg-[radial-gradient(ellipse,oklch(0.20_0.04_250)_0%,transparent_70%)]" />
        <div className="absolute bottom-0 left-1/4 w-[500px] h-[400px] bg-[radial-gradient(ellipse,oklch(0.95_0.02_30)_0%,transparent_70%)] dark:bg-[radial-gradient(ellipse,oklch(0.18_0.02_30)_0%,transparent_70%)]" />
      </div>

      {/* Grain texture */}
      <div
        className="pointer-events-none fixed inset-0 z-100 opacity-[0.025] dark:opacity-[0.04]"
        aria-hidden="true"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "128px 128px",
        }}
      />

      {children}
    </div>
  )
}
