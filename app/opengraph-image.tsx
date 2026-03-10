import { ImageResponse } from 'next/og'

export const size = {
  width: 1200,
  height: 630,
}

export const contentType = 'image/png'

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: 'linear-gradient(135deg, #faf8f3 0%, #f3efe6 100%)',
          color: '#231f1a',
          fontFamily: 'system-ui, sans-serif',
          padding: '72px',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(circle at top right, rgba(188, 138, 79, 0.14), transparent 36%), radial-gradient(circle at bottom left, rgba(90, 122, 180, 0.12), transparent 32%)',
          }}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: '100%',
            border: '1px solid rgba(35, 31, 26, 0.08)',
            borderRadius: '32px',
            background: 'rgba(255,255,255,0.55)',
            padding: '56px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '88px',
                height: '88px',
                borderRadius: '24px',
                background: '#231f1a',
                color: '#faf8f3',
                fontSize: '36px',
                fontWeight: 700,
              }}
            >
              GP
            </div>
            <div style={{ fontSize: '68px', fontWeight: 700, letterSpacing: '-0.05em' }}>
              GenPaper
            </div>
            <div style={{ fontSize: '30px', color: '#5c554c' }}>
              AI Research Paper Generator
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              gap: '24px',
            }}
          >
            <div style={{ fontSize: '24px', color: '#6b6358', maxWidth: '760px' }}>
              Generate literature reviews, theses, dissertations, and academic articles with
              grounded AI writing support.
            </div>
            <div style={{ fontSize: '22px', color: '#8b7355', fontWeight: 600 }}>
              genpaper.app
            </div>
          </div>
        </div>
      </div>
    ),
    size
  )
}
