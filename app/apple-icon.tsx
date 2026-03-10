import { ImageResponse } from 'next/og'

export const size = {
  width: 180,
  height: 180,
}

export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#faf8f3',
          color: '#231f1a',
          fontSize: 78,
          fontWeight: 700,
          letterSpacing: -4,
          borderRadius: 36,
        }}
      >
        GP
      </div>
    ),
    size
  )
}
