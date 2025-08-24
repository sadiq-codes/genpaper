import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock heavy dependencies used via dynamic require/import
vi.mock('pdf-parse', () => ({
  default: vi.fn(async () => ({ text: '', numpages: 5 }))
}))

vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(async () => ({
    recognize: vi.fn(async () => ({ data: { text: 'Recognized OCR text from page' } })),
    terminate: vi.fn(async () => undefined)
  }))
}))

vi.mock('pdf2pic', () => ({
  default: {
    fromBuffer: (_buf: Buffer) => {
      return async (_page: number, _opts: any) => ({ buffer: Buffer.from('fake-image') })
    }
  }
}))

// Import after mocks
import { extractPdfMetadataTiered } from '@/lib/pdf/tiered-extractor'

describe('Tiered extractor behavior without GROBID', () => {
  const pdfHeader = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  const pdfBody = Buffer.from('Fake content')
  const pdfBuffer = Buffer.concat([pdfHeader, pdfBody])

  beforeEach(() => {
    vi.resetAllMocks()
    // Disable GROBID explicitly
    process.env.ENABLE_GROBID = '0'
    // Ensure OCR is enabled
    process.env.ENABLE_SERVER_OCR = '1'

    // Mock fetch for GROBID health (should not be called due to ENABLE_GROBID=0)
    global.fetch = vi.fn(async () => new Response(null, { status: 404 })) as any
  })

  it('skips GROBID and uses OCR by default', async () => {
    const result = await extractPdfMetadataTiered(pdfBuffer, { enableOcr: true, maxTimeoutMs: 5000 })
    expect(result).toBeTruthy()
    expect(result.extractionMethod).toBe('ocr')
    expect(result.fullText && result.fullText.length).toBeGreaterThan(0)
  })
})

