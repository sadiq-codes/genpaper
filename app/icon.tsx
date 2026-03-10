import { ImageResponse } from 'next/og'

export const size = {
  width: 512,
  height: 512,
}

export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #faf8f3 0%, #f3efe6 100%)',
          borderRadius: 96,
          color: '#231f1a',
          fontSize: 220,
          fontWeight: 700,
          letterSpacing: -12,
        }}
      >
        GP
      </div>
    ),
    size
  )
}
