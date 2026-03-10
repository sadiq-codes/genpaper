import { ImageResponse } from 'next/og'

export const size = {
  width: 1200,
  height: 630,
}

export const contentType = 'image/png'

export default function TwitterImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: 'linear-gradient(135deg, #faf8f3 0%, #f3efe6 100%)',
          color: '#231f1a',
          fontFamily: 'system-ui, sans-serif',
          padding: '72px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: '100%',
            border: '1px solid rgba(35, 31, 26, 0.08)',
            borderRadius: '32px',
            background: 'rgba(255,255,255,0.6)',
            padding: '56px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '92px',
                height: '92px',
                borderRadius: '24px',
                background: '#231f1a',
                color: '#faf8f3',
                fontSize: '38px',
                fontWeight: 700,
              }}
            >
              GP
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '68px', fontWeight: 700, letterSpacing: '-0.05em' }}>
                GenPaper
              </div>
              <div style={{ fontSize: '28px', color: '#5c554c' }}>
                AI Research Paper Generator
              </div>
            </div>
          </div>
          <div style={{ fontSize: '24px', color: '#6b6358', maxWidth: '860px' }}>
            Write research papers faster with real sources, citations, and structured academic
            drafting support.
          </div>
        </div>
      </div>
    ),
    size
  )
}
