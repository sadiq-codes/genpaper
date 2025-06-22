import { createClient } from '@/lib/supabase/client'

/**
 * Check PDF extraction health and return alert message if fallback/ocr ratio exceeds threshold.
 */
export async function checkPdfExtractionHealth(thresholdPercent = 15): Promise<string | null> {
  const sb = await createClient()
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)

  const { data, error } = await sb
    .from('pdf_extraction_metrics')
    .select('extraction_method')
    .gte('timestamp', yesterday.toISOString())
    .lte('timestamp', now.toISOString()) as { data: { extraction_method: string }[] | null, error: unknown }

  if (error || !data) return null

  const total = data.length
  if (total === 0) return null

  const problematic = data.filter(d => d.extraction_method === 'fallback' || d.extraction_method === 'ocr').length
  const ratio = (problematic / total) * 100

  if (ratio > thresholdPercent) {
    return `⚠️ PDF extraction alert: ${ratio.toFixed(1)}% of extractions used fallback/OCR in last 24h.`
  }
  return null
} 