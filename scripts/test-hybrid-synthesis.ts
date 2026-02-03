/**
 * Test Hybrid Synthesis System (Phase 5)
 * 
 * Full end-to-end test: Extraction → Analysis → Plan → Hybrid Write (with chunks)
 * 
 * This demonstrates the complete hybrid architecture:
 * - Brain: Structured analysis (patterns, contradictions, gaps)
 * - Brawn: Targeted RAG chunk retrieval
 * - Combined: Rich, data-driven synthesis
 * 
 * Run with: npx tsx scripts/test-hybrid-synthesis.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { readFile } from 'fs/promises'
import pdfParse from 'pdf-parse'
import { extractPaper } from '../lib/extraction'
import { analyzeFindings, type FindingWithPaper } from '../lib/analysis/cross-document'
import { 
  buildSynthesisPlan, 
  writeHybridSynthesis,
  analysisResultToThemeAnalysis,
  type PaperInfo 
} from '../lib/synthesis-engine'

interface TestPaper {
  name: string
  path: string
}

const TEST_PAPERS: TestPaper[] = [
  {
    name: 'Tomato Spoilage Study',
    path: './AJPB+2022+4+2+no+4+Garba+Tomato+28+31+-+Copy.pdf'
  },
  {
    name: 'Greenland Identity Politics',
    path: './lbaulund,+What+kind+of+nation+state+will+Greenland+be_+Securitization+theory+as+a+strategy+for+analyzing+identity+politics++.pdf'
  }
]

interface ExtractedPaper {
  id: string
  title: string
  authors: string[]
  year?: number
  domain: string
  findings: FindingWithPaper[]
}

async function extractPaperData(paper: TestPaper): Promise<ExtractedPaper | null> {
  console.log(`\n📄 Extracting: ${paper.name}`)
  
  const pdfBuffer = await readFile(paper.path)
  const pdfData = await pdfParse(pdfBuffer)
  
  const paperId = `paper-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  
  const result = await extractPaper({
    paperId,
    text: pdfData.text
  })
  
  if (!result.success || !result.extraction) {
    console.log(`   ❌ Extraction failed: ${result.error}`)
    return null
  }
  
  const ext = result.extraction
  console.log(`   ✅ Extracted ${ext.findings.length} findings`)
  console.log(`   Title: "${ext.metadata.title}"`)
  
  // Convert findings to FindingWithPaper format
  const findings: FindingWithPaper[] = ext.findings.map(f => ({
    ...f,
    paperId: ext.paperId,
    paperTitle: ext.metadata.title,
    paperYear: ext.metadata.year,
    paperDomain: ext.metadata.domain
  }))
  
  return {
    id: ext.paperId,
    title: ext.metadata.title,
    authors: ext.metadata.authors,
    year: ext.metadata.year,
    domain: ext.metadata.domain,
    findings
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗')
  console.log('║                     HYBRID SYNTHESIS TEST (PHASE 5)                          ║')
  console.log('║          Extraction → Analysis → Plan → Hybrid Write (with chunks)          ║')
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝')
  
  const totalStartTime = Date.now()
  
  // =========================================================================
  // STEP 1: EXTRACT FINDINGS FROM PAPERS
  // =========================================================================
  console.log('\n' + '='.repeat(80))
  console.log('STEP 1: EXTRACT FINDINGS FROM PAPERS (Brain - Structured Data)')
  console.log('='.repeat(80))
  
  const extractedPapers: ExtractedPaper[] = []
  const allFindings: FindingWithPaper[] = []
  
  for (const paper of TEST_PAPERS) {
    const extracted = await extractPaperData(paper)
    if (extracted) {
      extractedPapers.push(extracted)
      allFindings.push(...extracted.findings)
    }
  }
  
  console.log(`\n📊 Total papers: ${extractedPapers.length}`)
  console.log(`📊 Total findings: ${allFindings.length}`)
  
  if (allFindings.length === 0) {
    console.log('❌ No findings extracted. Cannot proceed.')
    return
  }
  
  // =========================================================================
  // STEP 2: CROSS-DOCUMENT ANALYSIS
  // =========================================================================
  console.log('\n' + '='.repeat(80))
  console.log('STEP 2: CROSS-DOCUMENT ANALYSIS (Brain - Pattern Recognition)')
  console.log('='.repeat(80))
  
  const analysis = await analyzeFindings({
    projectId: 'test-project',
    findings: allFindings
  })
  
  console.log(`\n📊 Analysis Results:`)
  console.log(`   Patterns: ${analysis.patterns.length}`)
  console.log(`   Contradictions: ${analysis.contradictions.length}`)
  console.log(`   Gaps: ${analysis.gaps.length}`)
  console.log(`   Key Insights: ${analysis.keyInsights.length}`)
  
  // =========================================================================
  // STEP 3: TEST THEME ADAPTER (Pipeline Compatibility)
  // =========================================================================
  console.log('\n' + '='.repeat(80))
  console.log('STEP 3: TEST THEME ADAPTER (Pipeline Compatibility)')
  console.log('='.repeat(80))
  
  const papers: PaperInfo[] = extractedPapers.map(p => ({
    id: p.id,
    title: p.title,
    authors: p.authors,
    year: p.year,
    domain: p.domain
  }))
  
  const themeAnalysis = analysisResultToThemeAnalysis(analysis, papers)
  
  console.log(`\n📋 ThemeAnalysis (for pipeline compatibility):`)
  console.log(`   Emergent Themes: ${themeAnalysis.emergentThemes.length}`)
  console.log(`   Scholarly Debates: ${themeAnalysis.debates.length}`)
  console.log(`   Literature Gaps: ${themeAnalysis.gaps.length}`)
  console.log(`   Pivotal Papers: ${themeAnalysis.pivotalPapers.length}`)
  console.log(`   Organization: ${themeAnalysis.organizationSuggestion.approach}`)
  console.log(`   Confidence: ${(themeAnalysis.confidence * 100).toFixed(0)}%`)
  
  // =========================================================================
  // STEP 4: BUILD SYNTHESIS PLAN
  // =========================================================================
  console.log('\n' + '='.repeat(80))
  console.log('STEP 4: BUILD SYNTHESIS PLAN (Brain - Writing Strategy)')
  console.log('='.repeat(80))
  
  const planResult = await buildSynthesisPlan({
    projectId: 'test-project',
    analysis,
    papers,
    targetWordCount: 1500,
    audienceLevel: 'academic'
  })
  
  if (!planResult.success || !planResult.plan) {
    console.log(`\n❌ Plan generation failed: ${planResult.error}`)
    return
  }
  
  const plan = planResult.plan
  console.log(`\n📋 Plan created:`)
  console.log(`   Title: "${plan.overview.title}"`)
  console.log(`   Sections: ${plan.sections.length}`)
  console.log(`   Target words: ${plan.overview.totalWordCount}`)
  console.log(`   Narrative strategy: ${plan.overview.narrativeStrategy}`)
  
  // =========================================================================
  // STEP 5: HYBRID WRITE (Brain + Brawn)
  // =========================================================================
  console.log('\n' + '='.repeat(80))
  console.log('STEP 5: HYBRID WRITE (Brain + Brawn = Rich Synthesis)')
  console.log('='.repeat(80))
  
  console.log('\n🧠 Brain (Structured Data): Pre-computed patterns and statistics')
  console.log('💪 Brawn (RAG Chunks): Rich context and quotable material')
  console.log('✨ Combined: Data-driven synthesis with depth\n')
  
  const writerResult = await writeHybridSynthesis({
    projectId: 'test-project',
    plan,
    analysis,
    papers,
    onSectionStart: (title, index, total) => {
      console.log(`\n⏳ Section ${index + 1}/${total}: ${title}`)
    },
    onSectionComplete: (title, wordCount) => {
      console.log(`   ✅ ${wordCount} words`)
    }
  })
  
  if (!writerResult.success) {
    console.log(`\n❌ Hybrid writing failed: ${writerResult.error}`)
    return
  }
  
  // =========================================================================
  // DISPLAY RESULTS
  // =========================================================================
  console.log('\n' + '='.repeat(80))
  console.log('HYBRID SYNTHESIS OUTPUT')
  console.log('='.repeat(80))
  
  console.log('\n' + '-'.repeat(80))
  console.log('METADATA')
  console.log('-'.repeat(80))
  console.log(`Total words: ${writerResult.metadata.totalWords}`)
  console.log(`Sections: ${writerResult.metadata.sectionsGenerated}`)
  console.log(`Patterns discussed: ${writerResult.metadata.patternsDiscussed}`)
  console.log(`Contradictions addressed: ${writerResult.metadata.contradictionsAddressed}`)
  console.log(`Gaps identified: ${writerResult.metadata.gapsIdentified}`)
  console.log(`Chunks used: ${writerResult.metadata.totalChunksUsed}`)
  console.log(`Generation time: ${writerResult.metadata.totalGenerationTimeMs}ms`)
  
  console.log('\n' + '-'.repeat(80))
  console.log('FULL CONTENT')
  console.log('-'.repeat(80))
  console.log(writerResult.fullContent)
  
  console.log('\n' + '-'.repeat(80))
  console.log('SECTION BREAKDOWN')
  console.log('-'.repeat(80))
  
  writerResult.sections.forEach((section, i) => {
    console.log(`\n${i + 1}. ${section.title}`)
    console.log(`   Words: ${section.wordCount}`)
    console.log(`   Citations: ${section.citationsUsed.length}`)
    console.log(`   Chunks used: ${section.chunksUsed}`)
    console.log(`   Patterns: ${section.elementsIncluded.patterns.length}`)
    console.log(`   Contradictions: ${section.elementsIncluded.contradictions.length}`)
    console.log(`   Gaps: ${section.elementsIncluded.gaps.length}`)
    console.log(`   Time: ${section.generationTimeMs}ms`)
  })
  
  // =========================================================================
  // TIMING SUMMARY
  // =========================================================================
  const totalTime = Date.now() - totalStartTime
  
  console.log('\n' + '='.repeat(80))
  console.log('TIMING SUMMARY')
  console.log('='.repeat(80))
  console.log(`Total pipeline time: ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`)
  console.log(`  - Extraction: ~${extractedPapers.length * 12}s (estimated)`)
  console.log(`  - Analysis: ${analysis.analysisTimeMs}ms`)
  console.log(`  - Planning: ${planResult.timeMs}ms`)
  console.log(`  - Hybrid Writing: ${writerResult.metadata.totalGenerationTimeMs}ms`)
  console.log(`    (includes targeted chunk retrieval per section)`)
  
  // =========================================================================
  // HYBRID ARCHITECTURE SUMMARY
  // =========================================================================
  console.log('\n' + '='.repeat(80))
  console.log('HYBRID ARCHITECTURE SUMMARY')
  console.log('='.repeat(80))
  console.log(`
The hybrid system combines:

🧠 BRAIN (Structured Analysis):
   - ${analysis.patterns.length} patterns with exact statistics ("6 of 8 studies found...")
   - ${analysis.contradictions.length} contradictions with both sides identified
   - ${analysis.gaps.length} gaps with significance ratings
   - Pre-computed, verified, accurate

💪 BRAWN (RAG Chunks):
   - ${writerResult.metadata.totalChunksUsed} chunks retrieved across all sections
   - Targeted retrieval: chunks selected for specific patterns
   - Rich context: mechanisms, methods, quotable material
   - The "flesh" that makes the paper readable

✨ RESULT:
   - ${writerResult.metadata.totalWords} words of synthesized prose
   - Data-driven claims backed by chunks
   - No hallucinated statistics
   - Rich academic writing with proper citations
`)
  
  console.log('='.repeat(80))
  console.log('✅ HYBRID SYNTHESIS COMPLETE!')
  console.log('='.repeat(80))
}

main().catch(console.error)
