#!/usr/bin/env tsx

/**
 * PDF Domain Discovery Script
 * 
 * Discovers which domains successfully allow PDF downloads by testing
 * URLs from papers we haven't processed yet.
 * 
 * This script is READ-ONLY for papers - it doesn't modify paper data,
 * just tests URLs and outputs statistics.
 * 
 * Usage:
 *   npx tsx scripts/discover-pdf-domains.ts
 *   npx tsx scripts/discover-pdf-domains.ts --samples-per-domain 50
 *   npx tsx scripts/discover-pdf-domains.ts --min-papers 20
 *   npx tsx scripts/discover-pdf-domains.ts --timeout 10000
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { 
  PDF_FRIENDLY_DOMAIN_SET, 
  PAYWALL_DOMAIN_SET, 
  SKIP_DOMAIN_SET,
  extractBaseDomain 
} from '@/lib/config/pdf-domains'
import fs from 'fs'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RESULTS_FILE = '.pdf-domain-discovery.json'
const DEFAULT_SAMPLES_PER_DOMAIN = 50
const DEFAULT_MIN_PAPERS = 10  // Minimum papers with a domain to bother testing
const DEFAULT_TIMEOUT = 10000  // 10 seconds (fast fail for discovery)
const CONCURRENCY = 5  // Parallel downloads per domain
const SUCCESS_THRESHOLD = 0.30  // 30% success rate = recommend adding

// Use centralized domain lists from lib/config/pdf-domains.ts
const KNOWN_DOMAINS = PDF_FRIENDLY_DOMAIN_SET
const SKIP_DOMAINS = new Set([...PAYWALL_DOMAIN_SET, ...SKIP_DOMAIN_SET,
  // Additional domains to skip testing (paywalled but not in central list)
  'ingentaconnect.com',
  'emerald.com', 'www.emerald.com',
])

// User agents for testing
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
]

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DomainStats {
  domain: string
  totalPapers: number
  tested: number
  success: number
  failed: number
  successRate: number
  errors: Record<string, number>  // Error type -> count
  sampleUrls: string[]  // A few successful URLs for reference
  verdict: 'add' | 'skip' | 'maybe'
}

interface DiscoveryResults {
  testedAt: string
  config: {
    samplesPerDomain: number
    timeout: number
    successThreshold: number
  }
  summary: {
    domainsDiscovered: number
    domainsToAdd: number
    domainsToSkip: number
    totalUrlsTested: number
  }
  domains: Record<string, DomainStats>
  recommendedAdditions: string[]
}

interface TestResult {
  success: boolean
  error?: string
  contentType?: string
  size?: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

async function testPdfUrl(url: string, timeout: number): Promise<TestResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    // Small random delay to be polite
    await new Promise(r => setTimeout(r, Math.random() * 500 + 200))

    const response = await fetch(url, {
      signal: controller.signal,
      method: 'GET',
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'application/pdf,application/octet-stream,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` }
    }

    const contentType = response.headers.get('content-type') || ''
    
    // Check if it's actually a PDF
    if (contentType.includes('text/html')) {
      return { success: false, error: 'HTML (paywall/landing page)', contentType }
    }

    // Read first few bytes to verify PDF magic number
    const reader = response.body?.getReader()
    if (!reader) {
      return { success: false, error: 'No response body' }
    }

    const { value } = await reader.read()
    reader.cancel()  // Don't download the whole file

    if (!value || value.length < 4) {
      return { success: false, error: 'Empty response' }
    }

    // Check PDF magic number: %PDF
    const header = String.fromCharCode(...value.slice(0, 4))
    if (header !== '%PDF') {
      return { success: false, error: `Not PDF (header: ${header.slice(0, 10)})`, contentType }
    }

    const contentLength = response.headers.get('content-length')
    return {
      success: true,
      contentType,
      size: contentLength ? parseInt(contentLength, 10) : undefined,
    }

  } catch (err) {
    clearTimeout(timeoutId)
    const msg = err instanceof Error ? err.message : String(err)
    
    if (msg.includes('abort')) {
      return { success: false, error: 'Timeout' }
    }
    if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
      return { success: false, error: 'DNS failed' }
    }
    if (msg.includes('ECONNREFUSED')) {
      return { success: false, error: 'Connection refused' }
    }
    if (msg.includes('certificate')) {
      return { success: false, error: 'SSL error' }
    }
    
    return { success: false, error: msg.slice(0, 50) }
  }
}

async function testDomain(
  domain: string,
  urls: string[],
  samplesPerDomain: number,
  timeout: number
): Promise<DomainStats> {
  // Sample URLs randomly
  const sampled = urls
    .sort(() => Math.random() - 0.5)
    .slice(0, samplesPerDomain)

  const stats: DomainStats = {
    domain,
    totalPapers: urls.length,
    tested: 0,
    success: 0,
    failed: 0,
    successRate: 0,
    errors: {},
    sampleUrls: [],
    verdict: 'skip',
  }

  // Test in batches with concurrency
  for (let i = 0; i < sampled.length; i += CONCURRENCY) {
    const batch = sampled.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map(url => testPdfUrl(url, timeout))
    )

    for (let j = 0; j < results.length; j++) {
      const result = results[j]
      stats.tested++

      if (result.success) {
        stats.success++
        if (stats.sampleUrls.length < 3) {
          stats.sampleUrls.push(batch[j])
        }
      } else {
        stats.failed++
        const errKey = result.error || 'Unknown'
        stats.errors[errKey] = (stats.errors[errKey] || 0) + 1
      }
    }

    // Progress indicator
    process.stdout.write(`\r  Testing ${domain}: ${stats.tested}/${sampled.length} (${stats.success} OK)`)
  }

  console.log()  // Newline after progress

  stats.successRate = stats.tested > 0 ? stats.success / stats.tested : 0

  // Determine verdict
  if (stats.successRate >= SUCCESS_THRESHOLD) {
    stats.verdict = 'add'
  } else if (stats.successRate >= 0.1) {
    stats.verdict = 'maybe'
  } else {
    stats.verdict = 'skip'
  }

  return stats
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)

  let samplesPerDomain = DEFAULT_SAMPLES_PER_DOMAIN
  let minPapers = DEFAULT_MIN_PAPERS
  let timeout = DEFAULT_TIMEOUT

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--samples-per-domain':
        samplesPerDomain = parseInt(args[++i], 10)
        break
      case '--min-papers':
        minPapers = parseInt(args[++i], 10)
        break
      case '--timeout':
        timeout = parseInt(args[++i], 10)
        break
    }
  }

  console.log('='.repeat(60))
  console.log('🔍 PDF Domain Discovery')
  console.log('='.repeat(60))
  console.log(`Samples per domain: ${samplesPerDomain}`)
  console.log(`Min papers to test: ${minPapers}`)
  console.log(`Timeout:            ${timeout}ms`)
  console.log(`Success threshold:  ${(SUCCESS_THRESHOLD * 100).toFixed(0)}%`)
  console.log('='.repeat(60))

  // Fetch ALL papers with PDF URLs using pagination
  console.log('\n📊 Fetching papers with PDF URLs (paginated)...')
  
  const PAGE_SIZE = 1000
  const papers: { id: string; pdf_url: string }[] = []
  let offset = 0
  
  while (true) {
    const { data, error } = await supabase
      .from('papers')
      .select('id, pdf_url')
      .not('pdf_url', 'is', null)
      .eq('processing_status', 'pending')
      .range(offset, offset + PAGE_SIZE - 1)
    
    if (error) {
      console.error('Error fetching papers:', error.message)
      process.exit(1)
    }
    
    if (!data || data.length === 0) break
    
    papers.push(...data)
    process.stdout.write(`\r   Fetched ${papers.length.toLocaleString()} papers...`)
    
    if (data.length < PAGE_SIZE) break // Last page
    offset += PAGE_SIZE
  }
  
  console.log(`\n   Total: ${papers.length.toLocaleString()} papers with PDF URLs`)

  if (papers.length === 0) {
    console.log('No papers to analyze')
    return
  }

  // Group URLs by domain
  const urlsByDomain: Record<string, string[]> = {}
  
  for (const paper of papers) {
    const domain = extractDomain(paper.pdf_url)
    if (!domain) continue
    
    // Skip known domains
    if (KNOWN_DOMAINS.has(domain)) continue
    
    // Skip known paywalled domains
    if (SKIP_DOMAINS.has(domain)) continue
    
    // Normalize www variants
    const normalizedDomain = domain.replace(/^www\./, '')
    if (KNOWN_DOMAINS.has(normalizedDomain) || KNOWN_DOMAINS.has('www.' + normalizedDomain)) continue
    if (SKIP_DOMAINS.has(normalizedDomain) || SKIP_DOMAINS.has('www.' + normalizedDomain)) continue

    if (!urlsByDomain[domain]) {
      urlsByDomain[domain] = []
    }
    urlsByDomain[domain].push(paper.pdf_url)
  }

  // Filter domains with enough papers
  const domainsToTest = Object.entries(urlsByDomain)
    .filter(([_, urls]) => urls.length >= minPapers)
    .sort((a, b) => b[1].length - a[1].length)  // Most papers first

  console.log(`\n📋 Found ${Object.keys(urlsByDomain).length} unique unknown domains`)
  console.log(`📋 Testing ${domainsToTest.length} domains with >= ${minPapers} papers\n`)

  if (domainsToTest.length === 0) {
    console.log('No new domains to test!')
    return
  }

  // Show top domains
  console.log('Top domains by paper count:')
  domainsToTest.slice(0, 15).forEach(([domain, urls]) => {
    console.log(`  ${domain}: ${urls.length} papers`)
  })
  console.log()

  // Test each domain
  const results: DiscoveryResults = {
    testedAt: new Date().toISOString(),
    config: { samplesPerDomain, timeout, successThreshold: SUCCESS_THRESHOLD },
    summary: {
      domainsDiscovered: domainsToTest.length,
      domainsToAdd: 0,
      domainsToSkip: 0,
      totalUrlsTested: 0,
    },
    domains: {},
    recommendedAdditions: [],
  }

  for (const [domain, urls] of domainsToTest) {
    console.log(`\n🌐 Testing: ${domain} (${urls.length} papers)`)
    
    const stats = await testDomain(domain, urls, samplesPerDomain, timeout)
    results.domains[domain] = stats
    results.summary.totalUrlsTested += stats.tested

    const ratePercent = (stats.successRate * 100).toFixed(1)
    const verdictIcon = stats.verdict === 'add' ? '✅' : stats.verdict === 'maybe' ? '🤔' : '❌'
    console.log(`   Result: ${stats.success}/${stats.tested} success (${ratePercent}%) ${verdictIcon} ${stats.verdict.toUpperCase()}`)
    
    if (Object.keys(stats.errors).length > 0) {
      const topErrors = Object.entries(stats.errors)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([err, count]) => `${err}: ${count}`)
        .join(', ')
      console.log(`   Errors: ${topErrors}`)
    }

    if (stats.verdict === 'add') {
      results.summary.domainsToAdd++
      results.recommendedAdditions.push(domain)
    } else {
      results.summary.domainsToSkip++
    }

    // Save progress after each domain
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2))
  }

  // Final summary
  console.log('\n' + '='.repeat(60))
  console.log('📊 Discovery Complete!')
  console.log('='.repeat(60))
  console.log(`Domains tested:     ${domainsToTest.length}`)
  console.log(`URLs tested:        ${results.summary.totalUrlsTested}`)
  console.log(`Domains to ADD:     ${results.summary.domainsToAdd}`)
  console.log(`Domains to SKIP:    ${results.summary.domainsToSkip}`)
  console.log('='.repeat(60))

  if (results.recommendedAdditions.length > 0) {
    console.log('\n✅ RECOMMENDED ADDITIONS to PDF_FRIENDLY_DOMAINS:')
    console.log('─'.repeat(50))
    for (const domain of results.recommendedAdditions) {
      const stats = results.domains[domain]
      console.log(`  '${domain}',  // ${(stats.successRate * 100).toFixed(0)}% success, ${stats.totalPapers} papers`)
    }
    console.log('─'.repeat(50))
  }

  // Show "maybe" domains too
  const maybeDomains = Object.values(results.domains).filter(d => d.verdict === 'maybe')
  if (maybeDomains.length > 0) {
    console.log('\n🤔 MAYBE domains (10-30% success - review manually):')
    for (const stats of maybeDomains) {
      console.log(`  ${stats.domain}: ${(stats.successRate * 100).toFixed(0)}% success, ${stats.totalPapers} papers`)
    }
  }

  console.log(`\n📁 Full results saved to: ${RESULTS_FILE}`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
