/**
 * Test Cross-Document Analysis
 * 
 * Extracts findings from multiple papers, then analyzes them together
 * to find patterns, contradictions, and gaps.
 * 
 * Run with: npx tsx scripts/test-analysis.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { readFile } from 'fs/promises'
import pdfParse from 'pdf-parse'
import { extractPaper } from '../lib/extraction'
import { analyzeFindings, type FindingWithPaper } from '../lib/analysis/cross-document'

interface PaperInfo {
  name: string
  path: string
}

const TEST_PAPERS: PaperInfo[] = [
  {
    name: 'Tomato Spoilage Study',
    path: './AJPB+2022+4+2+no+4+Garba+Tomato+28+31+-+Copy.pdf'
  },
  {
    name: 'Greenland Identity Politics',
    path: './lbaulund,+What+kind+of+nation+state+will+Greenland+be_+Securitization+theory+as+a+strategy+for+analyzing+identity+politics++.pdf'
  }
]

async function extractPaperFindings(paper: PaperInfo): Promise<FindingWithPaper[]> {
  console.log(`\n📄 Extracting: ${paper.name}`)
  
  const pdfBuffer = await readFile(paper.path)
  const pdfData = await pdfParse(pdfBuffer)
  
  const result = await extractPaper({
    paperId: `paper-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: pdfData.text
  })
  
  if (!result.success || !result.extraction) {
    console.log(`   ❌ Extraction failed: ${result.error}`)
    return []
  }
  
  const ext = result.extraction
  console.log(`   ✅ Extracted ${ext.findings.length} findings`)
  
  // Convert to FindingWithPaper format
  return ext.findings.map(f => ({
    ...f,
    paperId: ext.paperId,
    paperTitle: ext.metadata.title,
    paperYear: ext.metadata.year,
    paperDomain: ext.metadata.domain
  }))
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗')
  console.log('║                    CROSS-DOCUMENT ANALYSIS TEST                              ║')
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝')
  
  // Step 1: Extract findings from all papers
  console.log('\n' + '='.repeat(80))
  console.log('STEP 1: EXTRACT FINDINGS FROM PAPERS')
  console.log('='.repeat(80))
  
  const allFindings: FindingWithPaper[] = []
  
  for (const paper of TEST_PAPERS) {
    const findings = await extractPaperFindings(paper)
    allFindings.push(...findings)
  }
  
  console.log(`\n📊 Total findings extracted: ${allFindings.length}`)
  
  // Step 2: Analyze findings across papers
  console.log('\n' + '='.repeat(80))
  console.log('STEP 2: CROSS-DOCUMENT ANALYSIS')
  console.log('='.repeat(80))
  
  const analysis = await analyzeFindings({
    projectId: 'test-project',
    findings: allFindings
  })
  
  // Display results
  console.log('\n' + '-'.repeat(80))
  console.log('PATTERNS')
  console.log('-'.repeat(80))
  
  if (analysis.patterns.length === 0) {
    console.log('No patterns found (expected with very different papers)')
  } else {
    analysis.patterns.forEach((p, i) => {
      console.log(`\n${i + 1}. ${p.claim}`)
      console.log(`   Summary: ${p.summary}`)
      console.log(`   Support: ${p.support.count}/${p.support.total} papers`)
      console.log(`   Consistency: ${p.consistency}`)
      if (p.values) {
        console.log(`   Values: ${p.values.summary}`)
      }
      console.log(`   Confidence: ${(p.confidence * 100).toFixed(0)}%`)
      console.log(`   Papers:`)
      p.support.papers.forEach(ps => {
        console.log(`     - ${ps.paperTitle}: "${ps.claim.slice(0, 60)}..."`)
      })
    })
  }
  
  console.log('\n' + '-'.repeat(80))
  console.log('CONTRADICTIONS')
  console.log('-'.repeat(80))
  
  if (analysis.contradictions.length === 0) {
    console.log('No contradictions found')
  } else {
    analysis.contradictions.forEach((c, i) => {
      console.log(`\n${i + 1}. ${c.description}`)
      console.log(`   Severity: ${c.severity}`)
      c.sides.forEach((side, j) => {
        console.log(`   Side ${j + 1}: ${side.position}`)
        side.papers.forEach(p => {
          console.log(`     - ${p.paperTitle}`)
        })
      })
      if (c.possibleExplanation) {
        console.log(`   Explanation: ${c.possibleExplanation}`)
      }
    })
  }
  
  console.log('\n' + '-'.repeat(80))
  console.log('GAPS')
  console.log('-'.repeat(80))
  
  if (analysis.gaps.length === 0) {
    console.log('No gaps identified')
  } else {
    analysis.gaps.forEach((g, i) => {
      console.log(`\n${i + 1}. ${g.description}`)
      console.log(`   Type: ${g.type}`)
      console.log(`   Relevance: ${g.relevance}`)
      console.log(`   Confidence: ${(g.confidence * 100).toFixed(0)}%`)
    })
  }
  
  console.log('\n' + '-'.repeat(80))
  console.log('SUMMARY')
  console.log('-'.repeat(80))
  console.log(analysis.summary)
  
  console.log('\n' + '-'.repeat(80))
  console.log('KEY INSIGHTS')
  console.log('-'.repeat(80))
  analysis.keyInsights.forEach((insight, i) => {
    console.log(`${i + 1}. ${insight}`)
  })
  
  console.log('\n' + '-'.repeat(80))
  console.log('METADATA')
  console.log('-'.repeat(80))
  console.log(`Papers analyzed: ${analysis.analyzedPapers}`)
  console.log(`Total findings: ${analysis.totalFindings}`)
  console.log(`Analysis time: ${analysis.analysisTimeMs}ms`)
  console.log(`Findings hash: ${analysis.findingsHash}`)
  
  console.log('\n✅ Analysis complete!')
}

main().catch(console.error)
