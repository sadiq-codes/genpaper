/**
 * PDF Domain Configuration
 * 
 * Centralized source of truth for:
 * - PDF-friendly domains (open access, preprints, repositories)
 * - Paywall domains to skip
 * - URL patterns for PDF detection and transformation
 * 
 * Used by:
 * - Bulk ingestion scripts
 * - Generation pipeline (paper discovery)
 * - PDF download utilities
 * - Domain discovery script
 */

// =============================================================================
// PDF-Friendly Domains
// =============================================================================

/**
 * Domains known to allow direct PDF downloads.
 * Organized by category for easier maintenance.
 * 
 * To add new domains:
 * 1. Run `npx tsx scripts/discover-pdf-domains.ts`
 * 2. Review .pdf-domain-discovery.json
 * 3. Add domains with >30% success rate here
 */
export const PDF_FRIENDLY_DOMAINS: readonly string[] = [
  // -------------------------------------------------------------------------
  // Preprint Servers
  // -------------------------------------------------------------------------
  'arxiv.org', 'www.arxiv.org', 'export.arxiv.org',
  'biorxiv.org', 'www.biorxiv.org',
  'medrxiv.org', 'www.medrxiv.org',
  'chemrxiv.org',
  'eartharxiv.org',
  'engrxiv.org',
  'psyarxiv.com',
  'osf.io',
  'preprints.org',
  'ssrn.com', 'papers.ssrn.com',
  
  // -------------------------------------------------------------------------
  // Open Access Publishers
  // -------------------------------------------------------------------------
  'peerj.com', 'www.peerj.com',
  'mdpi.com', 'www.mdpi.com',
  'frontiersin.org', 'www.frontiersin.org',
  'plos.org', 'journals.plos.org',
  'elifesciences.org',
  'hindawi.com', 'www.hindawi.com',
  'biomedcentral.com', 'www.biomedcentral.com',
  'nature.com', 'www.nature.com',  // Some OA content
  'f1000research.com',
  'www.intechopen.com',
  'bioone.org',
  
  // -------------------------------------------------------------------------
  // Government & Institutional Repositories
  // -------------------------------------------------------------------------
  'ncbi.nlm.nih.gov', 'www.ncbi.nlm.nih.gov', 'pubmed.ncbi.nlm.nih.gov',
  'europepmc.org', 'www.europepmc.org',
  'www.osti.gov', 'osti.gov',  // US Dept of Energy
  'wwwnc.cdc.gov', 'www.cdc.gov',  // CDC
  
  // -------------------------------------------------------------------------
  // Academic Repositories
  // -------------------------------------------------------------------------
  'scielo.org', 'www.scielo.org',
  'doaj.org', 'www.doaj.org',
  'zenodo.org', 'www.zenodo.org',
  'figshare.com', 'www.figshare.com',
  'hal.science', 'hal.archives-ouvertes.fr',
  'researchgate.net', 'www.researchgate.net',
  'academia.edu', 'www.academia.edu',
  'dspace.mit.edu', 'dash.harvard.edu',
  'repec.org', 'ideas.repec.org',
  'escholarship.org',  // UC eScholarship
  'ueaeprints.uea.ac.uk',
  'research.vu.nl',
  'biblio.ugent.be',
  
  // -------------------------------------------------------------------------
  // BMJ Journals
  // -------------------------------------------------------------------------
  'www.bmj.com', 'bmj.com',
  'gut.bmj.com',
  'thorax.bmj.com',
  'bjsm.bmj.com',
  'jitc.bmj.com',
  'gh.bmj.com',
  'jmg.bmj.com',
  'bjo.bmj.com',
  
  // -------------------------------------------------------------------------
  // BMC Journals (BioMed Central)
  // -------------------------------------------------------------------------
  'genomebiology.biomedcentral.com',
  'microbiomejournal.biomedcentral.com',
  'molecular-cancer.biomedcentral.com',
  'bmcmicrobiol.biomedcentral.com',
  'genomemedicine.biomedcentral.com',
  'bmcgenomics.biomedcentral.com',
  'biotechnologyforbiofuels.biomedcentral.com',
  'jhoonline.biomedcentral.com',
  'bmcmedicine.biomedcentral.com',
  'microbialcellfactories.biomedcentral.com',
  'bmcinfectdis.biomedcentral.com',
  'bmcpregnancychildbirth.biomedcentral.com',
  'translational-medicine.biomedcentral.com',
  'aricjournal.biomedcentral.com',
  'jeccr.biomedcentral.com',
  'bmcplantbiol.biomedcentral.com',
  'bmcbiol.biomedcentral.com',
  'ann-clinmicrob.biomedcentral.com',
  'gutpathogens.biomedcentral.com',
  'jneuroinflammation.biomedcentral.com',
  'amb-express.springeropen.com',
  
  // -------------------------------------------------------------------------
  // Copernicus (Earth/Environmental Science)
  // -------------------------------------------------------------------------
  'essd.copernicus.org',
  'acp.copernicus.org',
  'gmd.copernicus.org',
  'bg.copernicus.org',
  'www.geosci-model-dev.net',
  'www.earth-syst-sci-data.net',
  
  // -------------------------------------------------------------------------
  // JCI (Journal of Clinical Investigation)
  // -------------------------------------------------------------------------
  'www.jci.org', 'jci.org',
  'insight.jci.org',
  
  // -------------------------------------------------------------------------
  // Medical & Biology Journals
  // -------------------------------------------------------------------------
  'www.oncotarget.com',
  'www.spandidos-publications.com',
  'www.thno.org',  // Theranostics
  'www.ijbs.com',  // Int J Biological Sciences
  'www.aging-us.com',
  'www.jcancer.org',
  'haematologica.org',
  'jnm.snmjournals.org',  // Journal of Nuclear Medicine
  'rnajournal.cshlp.org',  // RNA Journal (Cold Spring Harbor)
  
  // -------------------------------------------------------------------------
  // Chemistry
  // -------------------------------------------------------------------------
  'pubs.rsc.org',  // Royal Society of Chemistry
  
  // -------------------------------------------------------------------------
  // Computer Science & AI Conferences
  // -------------------------------------------------------------------------
  'www.aclweb.org',
  'aclanthology.org',
  'www.ijcai.org',
  
  // -------------------------------------------------------------------------
  // Other Publishers
  // -------------------------------------------------------------------------
  'www.jstage.jst.go.jp',  // Japan Science & Technology
  'www.thieme-connect.de',
  'www.protocols.io',
  'www.jmir.org',  // Journal of Medical Internet Research
  'www.termedia.pl',
] as const

// =============================================================================
// Paywall Domains (Known to Block Downloads)
// =============================================================================

/**
 * Domains that typically require institutional access or subscriptions.
 * URLs from these domains are filtered out before download attempts.
 */
export const PAYWALL_DOMAINS: readonly string[] = [
  // Major commercial publishers (subscription-based)
  'api.elsevier.com',
  'api.wiley.com',
  'aeaweb.org',
  'pubsonline.informs.org',
  
  // Paywalled journal sites
  'linkinghub.elsevier.com',
  'sciencedirect.com', 'www.sciencedirect.com',
  'wiley.com', 'onlinelibrary.wiley.com',
  'springer.com', 'link.springer.com',  // Mostly paywalled (except OA)
  'tandfonline.com', 'www.tandfonline.com',
  'sagepub.com', 'journals.sagepub.com',
  'cambridge.org', 'www.cambridge.org',
  'oup.com', 'academic.oup.com',  // Oxford - mostly paywalled
  'ieee.org', 'ieeexplore.ieee.org',
  'acm.org', 'dl.acm.org',
  'jstor.org', 'www.jstor.org',
  'karger.com', 'www.karger.com',
  'thieme.com', 'www.thieme-connect.com',
  'degruyter.com', 'www.degruyter.com',
  'ingentaconnect.com',
  'emerald.com', 'www.emerald.com',
] as const

// =============================================================================
// Skip Domains (Never Attempt)
// =============================================================================

/**
 * Domains to skip entirely - not PDFs or always fail.
 * Includes redirect services and landing page hosts.
 */
export const SKIP_DOMAINS: readonly string[] = [
  'doi.org',  // Just a redirect service
  'dx.doi.org',
  'hdl.handle.net',  // Handle redirects
] as const

// =============================================================================
// URL Patterns for PDF Detection
// =============================================================================

/**
 * Patterns that indicate a URL points to a landing page, not a PDF.
 */
export const LANDING_PAGE_PATTERNS: readonly RegExp[] = [
  /\/full\/?$/i,                              // "Full text" pages
  /\/abstract\/?$/i,                          // Abstract pages
  /\/summary\/?$/i,                           // Summary pages
  /hdl\.handle\.net\//i,                      // Handle.net redirects
  /doi\.org\/(?!.*\.pdf)/i,                   // DOI resolvers (not ending in .pdf)
  /\/abstract\//i,                            // Abstract pages
  /\/abs\//i,                                 // ArXiv abstract pages (not /pdf/)
]

/**
 * Patterns that indicate a URL is likely a direct PDF download.
 */
export const DIRECT_PDF_PATTERNS: readonly RegExp[] = [
  /\.pdf$/i,
  /arxiv\.org\/pdf\//i,
  /biorxiv\.org\/content\/.*\.full\.pdf/i,
  /medrxiv\.org\/content\/.*\.full\.pdf/i,
  /researchgate\.net\/.*\.pdf/i,
  /academia\.edu\/.*\.pdf/i,
  /core\.ac\.uk\/download/i,
  /europepmc\.org\/.*\.pdf/i,
  /ncbi\.nlm\.nih\.gov\/pmc\/articles\/.*\/pdf/i,
  /pmc\.ncbi\.nlm\.nih\.gov\/.*\/pdf/i,
  /link\.springer\.com\/content\/pdf/i,
  /biomedcentral\.com\/track\/pdf/i,
  /mdpi\.com\/.*\/pdf/i,
  /frontiersin\.org\/.*\/pdf/i,
  /plos\.org\/.*\.pdf/i,
  /nature\.com\/.*\.pdf/i,
  /doi\.org\/.*\.pdf$/i,
  /onlinelibrary\.wiley\.com\/doi\/pdf\//i,
  /onlinelibrary\.wiley\.com\/doi\/pdfdirect\//i,
  /sciencedirect\.com\/.*\/pdf/i,
  /tandfonline\.com\/doi\/pdf\//i,
  /journals\.sagepub\.com\/doi\/pdf\//i,
  /academic\.oup\.com\/.*\/pdf/i,
]

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a URL's domain is in the PDF-friendly list.
 * Handles both exact matches and subdomain matches.
 */
export function isPdfFriendlyDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return PDF_FRIENDLY_DOMAINS.some(domain => 
      hostname === domain || hostname.endsWith('.' + domain)
    )
  } catch {
    return false
  }
}

/**
 * Check if a URL points to a known paywall domain.
 */
export function isPaywalledDomain(url: string): boolean {
  if (!url) return false
  return PAYWALL_DOMAINS.some(domain => url.includes(domain))
}

/**
 * Check if a URL should be skipped entirely.
 */
export function isSkipDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return SKIP_DOMAINS.some(domain => 
      hostname === domain || hostname.endsWith('.' + domain)
    )
  } catch {
    return false
  }
}

/**
 * Check if URL matches a landing page pattern.
 */
export function isLandingPageUrl(url: string): boolean {
  if (!url) return false
  return LANDING_PAGE_PATTERNS.some(pattern => pattern.test(url))
}

/**
 * Check if URL is likely a direct PDF download.
 */
export function isDirectPdfUrl(url: string): boolean {
  if (!url) return false
  
  // Reject known paywalls and landing pages
  if (isPaywalledDomain(url) || isLandingPageUrl(url)) {
    return false
  }
  
  return DIRECT_PDF_PATTERNS.some(pattern => pattern.test(url))
}

/**
 * Filter PDF URL - returns empty string if URL should be skipped.
 * Use this before attempting PDF downloads.
 */
export function filterPdfUrl(url: string): string {
  if (!url) return ''
  if (isPaywalledDomain(url)) return ''
  if (isLandingPageUrl(url)) return ''
  if (isSkipDomain(url)) return ''
  return url
}

/**
 * Extract the base domain from a hostname.
 * e.g., "genomebiology.biomedcentral.com" -> "biomedcentral.com"
 */
export function extractBaseDomain(hostname: string): string {
  const parts = hostname.split('.')
  if (parts.length <= 2) return hostname
  return parts.slice(-2).join('.')
}

// =============================================================================
// Domain Set for Fast Lookups
// =============================================================================

/**
 * Pre-built Set for O(1) domain lookups.
 * Includes both exact domains and their base domains.
 */
export const PDF_FRIENDLY_DOMAIN_SET: ReadonlySet<string> = new Set([
  ...PDF_FRIENDLY_DOMAINS,
  // Also add base domains for subdomain matching
  ...PDF_FRIENDLY_DOMAINS.map(d => extractBaseDomain(d)),
])

export const PAYWALL_DOMAIN_SET: ReadonlySet<string> = new Set(PAYWALL_DOMAINS)
export const SKIP_DOMAIN_SET: ReadonlySet<string> = new Set(SKIP_DOMAINS)
