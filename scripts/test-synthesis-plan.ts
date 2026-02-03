/**
 * Test Synthesis Plan Builder
 * 
 * Extracts findings from papers, analyzes them, then generates a synthesis plan.
 * End-to-end test of Phases 1-3.
 * 
 * Run with: npx tsx scripts/test-synthesis-plan.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { readFile } from 'fs/promises'
import pdfParse from 'pdf-parse'
import { extractPaper } from '../lib/extraction'
import { analyzeFindings, type FindingWithPaper } from '../lib/analysis/cross-document'
import { buildSynthesisPlan, type PaperInfo } from '../lib/synthesis-engine'

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
  console.log('║                     SYNTHESIS PLAN BUILDER TEST                              ║')
  console.log('║                   Extraction → Analysis → Plan                               ║')
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝')
  
  // Step 1: Extract findings from all papers
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
  
  // Step 2: Analyze findings across papers
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
  
  // Step 3: Build synthesis plan
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
    targetWordCount: 2500,
    audienceLevel: 'academic'
  })
  
  if (!planResult.success || !planResult.plan) {
    console.log(`\n❌ Plan generation failed: ${planResult.error}`)
    return
  }
  
  const plan = planResult.plan
  
  // Display the plan
  console.log('\n' + '-'.repeat(80))
  console.log('SYNTHESIS PLAN OVERVIEW')
  console.log('-'.repeat(80))
  console.log(`Title: "${plan.overview.title}"`)
  console.log(`\nAbstract:\n${plan.overview.abstract}`)
  console.log(`\nNarrative Strategy: ${plan.overview.narrativeStrategy}`)
  console.log(`Total Sections: ${plan.overview.totalSections}`)
  console.log(`Target Word Count: ${plan.overview.totalWordCount}`)
  
  console.log('\n' + '-'.repeat(80))
  console.log('GLOBAL GUIDANCE')
  console.log('-'.repeat(80))
  console.log(`Audience: ${plan.globalGuidance.audienceLevel}`)
  console.log(`Writing Style: ${plan.globalGuidance.writingStyle}`)
  console.log(`Citation Approach: ${plan.globalGuidance.citationApproach}`)
  console.log(`Key Themes:`)
  plan.globalGuidance.keyThemes.forEach((theme, i) => {
    console.log(`  ${i + 1}. ${theme}`)
  })
  
  console.log('\n' + '-'.repeat(80))
  console.log('SECTIONS')
  console.log('-'.repeat(80))
  
  plan.sections.forEach((section, i) => {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`SECTION ${i + 1}: ${section.title}`)
    console.log(`${'─'.repeat(60)}`)
    console.log(`Purpose: ${section.purpose}`)
    console.log(`Target Words: ${section.targetWordCount}`)
    
    console.log(`\nWriting Guidance:`)
    console.log(`  Approach: ${section.writingGuidance.approach}`)
    console.log(`  Tone: ${section.writingGuidance.tone}`)
    if (section.writingGuidance.transitionFrom) {
      console.log(`  Transition From: ${section.writingGuidance.transitionFrom}`)
    }
    if (section.writingGuidance.transitionTo) {
      console.log(`  Transition To: ${section.writingGuidance.transitionTo}`)
    }
    
    if (section.content.patterns.length > 0) {
      console.log(`\nPatterns to Cover (${section.content.patterns.length}):`)
      section.content.patterns.forEach((p, j) => {
        console.log(`  ${j + 1}. ${p.claim}`)
        console.log(`     Importance: ${p.importance}`)
        console.log(`     Presentation: ${p.presentationApproach}`)
        console.log(`     Support: ${p.data.supportStatement}`)
        if (p.data.valuesSummary) {
          console.log(`     Values: ${p.data.valuesSummary}`)
        }
      })
    }
    
    if (section.content.contradictions.length > 0) {
      console.log(`\nContradictions to Address (${section.content.contradictions.length}):`)
      section.content.contradictions.forEach((c, j) => {
        console.log(`  ${j + 1}. ${c.description}`)
        console.log(`     Approach: ${c.presentationApproach}`)
        if (c.resolutionStrategy) {
          console.log(`     Resolution: ${c.resolutionStrategy}`)
        }
      })
    }
    
    if (section.content.gaps.length > 0) {
      console.log(`\nGaps to Discuss (${section.content.gaps.length}):`)
      section.content.gaps.forEach((g, j) => {
        console.log(`  ${j + 1}. ${g.description}`)
        console.log(`     Importance: ${g.importance}`)
        if (g.suggestedFutureWork) {
          console.log(`     Future Work: ${g.suggestedFutureWork}`)
        }
      })
    }
    
    if (section.content.additionalPoints.length > 0) {
      console.log(`\nAdditional Points:`)
      section.content.additionalPoints.forEach((p, j) => {
        console.log(`  ${j + 1}. ${p}`)
      })
    }
    
    console.log(`\nKey Points to Make:`)
    section.keyPointsToMake.forEach((p, j) => {
      console.log(`  ${j + 1}. ${p}`)
    })
    
    console.log(`\nPapers to Cite:`)
    console.log(`  Primary: ${section.papers.primary.length > 0 ? section.papers.primary.join(', ') : 'None specified'}`)
    console.log(`  Supporting: ${section.papers.supporting.length > 0 ? section.papers.supporting.join(', ') : 'None specified'}`)
  })
  
  console.log('\n' + '-'.repeat(80))
  console.log('INPUT SUMMARY')
  console.log('-'.repeat(80))
  console.log(`Total Papers: ${plan.inputSummary.totalPapers}`)
  console.log(`Total Findings: ${plan.inputSummary.totalFindings}`)
  console.log(`Patterns Found: ${plan.inputSummary.patternsFound}`)
  console.log(`Contradictions Found: ${plan.inputSummary.contradictionsFound}`)
  console.log(`Gaps Found: ${plan.inputSummary.gapsFound}`)
  
  console.log('\n' + '-'.repeat(80))
  console.log('GENERATION METADATA')
  console.log('-'.repeat(80))
  console.log(`Plan ID: ${plan.id}`)
  console.log(`Generated: ${plan.generatedAt.toISOString()}`)
  console.log(`Generation Time: ${plan.generationTimeMs}ms`)
  console.log(`Model: ${plan.modelUsed}`)
  
  console.log('\n' + '='.repeat(80))
  console.log('✅ SYNTHESIS PLAN COMPLETE!')
  console.log('='.repeat(80))
  console.log(`\nTotal Pipeline Time:`)
  console.log(`  Extraction: ~${extractedPapers.length * 8}s (estimated)`)
  console.log(`  Analysis: ${analysis.analysisTimeMs}ms`)
  console.log(`  Plan Building: ${planResult.timeMs}ms`)
}

main().catch(console.error)
