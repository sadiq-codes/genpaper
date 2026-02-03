/**
 * Test Synthesis Writer (Phase 4)
 * 
 * Full end-to-end test: Extraction → Analysis → Plan → Write
 * 
 * Run with: npx tsx scripts/test-synthesis-writer.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { readFile } from 'fs/promises'
import pdfParse from 'pdf-parse'
import { extractPaper } from '../lib/extraction'
import { analyzeFindings, type FindingWithPaper } from '../lib/analysis/cross-document'
import { buildSynthesisPlan, writeSynthesis, type PaperInfo } from '../lib/synthesis-engine'

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
  console.log('║                     SYNTHESIS WRITER TEST (PHASE 4)                          ║')
  console.log('║              Extraction → Analysis → Plan → Write                            ║')
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝')
  
  const totalStartTime = Date.now()
  
  // =========================================================================
  // STEP 1: EXTRACT FINDINGS FROM PAPERS
  // =========================================================================
  console.log('\n' + '='.repeat(80))
  console.log('STEP 1: EXTRACT FINDINGS FROM PAPERS')
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
  console.log('STEP 2: CROSS-DOCUMENT ANALYSIS')
  console.log('='.repeat(80))
  
  const analysis = await analyzeFindings({
    projectId: 'test-project',
    findings: allFindings
  })
  
  console.log(`\n📊 Analysis Results:`)
  console.log(`   Patterns: ${analysis.patterns.length}`)
  console.log(`   Contradictions: ${analysis.contradictions.length}`)
  console.log(`   Gaps: ${analysis.gaps.length}`)
  
  // =========================================================================
  // STEP 3: BUILD SYNTHESIS PLAN
  // =========================================================================
  console.log('\n' + '='.repeat(80))
  console.log('STEP 3: BUILD SYNTHESIS PLAN')
  console.log('='.repeat(80))
  
  // Prepare paper info for citation
  const papers: PaperInfo[] = extractedPapers.map(p => ({
    id: p.id,
    title: p.title,
    authors: p.authors,
    year: p.year,
    domain: p.domain
  }))
  
  const planResult = await buildSynthesisPlan({
    projectId: 'test-project',
    analysis,
    papers,
    targetWordCount: 1500,  // Shorter for testing
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
  
  // =========================================================================
  // STEP 4: WRITE SYNTHESIS
  // =========================================================================
  console.log('\n' + '='.repeat(80))
  console.log('STEP 4: WRITE SYNTHESIS')
  console.log('='.repeat(80))
  
  const writerResult = await writeSynthesis({
    projectId: 'test-project',
    plan,
    analysis,
    papers,
    onSectionStart: (title, index, total) => {
      console.log(`\n⏳ Starting section ${index + 1}/${total}: ${title}`)
    },
    onSectionComplete: (title, wordCount) => {
      console.log(`   ✅ Completed: ${wordCount} words`)
    }
  })
  
  if (!writerResult.success) {
    console.log(`\n❌ Writing failed: ${writerResult.error}`)
    return
  }
  
  // =========================================================================
  // DISPLAY RESULTS
  // =========================================================================
  console.log('\n' + '='.repeat(80))
  console.log('GENERATED SYNTHESIS')
  console.log('='.repeat(80))
  
  console.log('\n' + '-'.repeat(80))
  console.log('METADATA')
  console.log('-'.repeat(80))
  console.log(`Total words: ${writerResult.metadata.totalWords}`)
  console.log(`Sections: ${writerResult.metadata.sectionsGenerated}`)
  console.log(`Patterns discussed: ${writerResult.metadata.patternsDiscussed}`)
  console.log(`Contradictions addressed: ${writerResult.metadata.contradictionsAddressed}`)
  console.log(`Gaps identified: ${writerResult.metadata.gapsIdentified}`)
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
  console.log(`  - Writing: ${writerResult.metadata.totalGenerationTimeMs}ms`)
  
  console.log('\n' + '='.repeat(80))
  console.log('✅ FULL PIPELINE COMPLETE!')
  console.log('='.repeat(80))
}

main().catch(console.error)
