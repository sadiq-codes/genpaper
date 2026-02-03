/**
 * Test the paper extraction system
 * 
 * Run with: npx tsx scripts/test-extraction.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { readFile } from 'fs/promises'
import pdfParse from 'pdf-parse'
import { extractPaper } from '../lib/extraction'

async function testPaper(name: string, pdfPath: string) {
  console.log('\n' + '='.repeat(80))
  console.log(`TESTING: ${name}`)
  console.log('='.repeat(80))
  
  // Read PDF
  const pdfBuffer = await readFile(pdfPath)
  const pdfData = await pdfParse(pdfBuffer)
  
  console.log(`\nPDF text length: ${pdfData.text.length} chars`)
  
  // Extract
  const result = await extractPaper({
    paperId: 'test-' + Date.now(),
    text: pdfData.text
  })
  
  if (!result.success || !result.extraction) {
    console.log('\n❌ Extraction failed:', result.error)
    return
  }
  
  const ext = result.extraction
  
  // Display results
  console.log('\n' + '-'.repeat(80))
  console.log('METADATA')
  console.log('-'.repeat(80))
  console.log(`Title: ${ext.metadata.title}`)
  console.log(`Authors: ${ext.metadata.authors.join(', ')}`)
  console.log(`Year: ${ext.metadata.year || 'unknown'}`)
  console.log(`Domain: ${ext.metadata.domain}`)
  console.log(`Paper Type: ${ext.metadata.paperType}`)
  console.log(`Methodology: ${ext.metadata.methodology}`)
  
  console.log('\n' + '-'.repeat(80))
  console.log('RESEARCH QUESTION')
  console.log('-'.repeat(80))
  console.log(ext.researchQuestion || '(not explicitly stated)')
  
  console.log('\n' + '-'.repeat(80))
  console.log(`FINDINGS (${ext.findings.length} total)`)
  console.log('-'.repeat(80))
  
  ext.findings.forEach((f, i) => {
    const mainTag = f.isMainFinding ? '[MAIN]' : '[secondary]'
    console.log(`\n${i + 1}. ${mainTag} ${f.claim}`)
    if (f.value) {
      console.log(`   Value: ${f.value} (${f.valueType})`)
    }
    if (f.direction) {
      console.log(`   Direction: ${f.direction}`)
    }
    if (f.context) {
      console.log(`   Context: ${f.context}`)
    }
    if (f.comparedTo) {
      console.log(`   Compared to: ${f.comparedTo}`)
    }
    console.log(`   Evidence: "${f.evidence.slice(0, 150)}${f.evidence.length > 150 ? '...' : ''}"`)
    console.log(`   Confidence: ${(f.confidence * 100).toFixed(0)}%`)
  })
  
  console.log('\n' + '-'.repeat(80))
  console.log('CONTRIBUTIONS')
  console.log('-'.repeat(80))
  ext.contributions.forEach((c, i) => {
    console.log(`${i + 1}. ${c}`)
  })
  
  console.log('\n' + '-'.repeat(80))
  console.log('LIMITATIONS')
  console.log('-'.repeat(80))
  ext.limitations.forEach((l, i) => {
    console.log(`${i + 1}. ${l}`)
  })
  
  if (ext.extractionNotes.length > 0) {
    console.log('\n' + '-'.repeat(80))
    console.log('EXTRACTION NOTES')
    console.log('-'.repeat(80))
    ext.extractionNotes.forEach((n, i) => {
      console.log(`${i + 1}. ${n}`)
    })
  }
  
  console.log('\n' + '-'.repeat(80))
  console.log('SUMMARY')
  console.log('-'.repeat(80))
  console.log(`Overall confidence: ${(ext.extractionConfidence * 100).toFixed(0)}%`)
  console.log(`Extraction time: ${ext.extractionTimeMs}ms`)
  console.log(`Main findings: ${ext.findings.filter(f => f.isMainFinding).length}`)
  console.log(`Findings with values: ${ext.findings.filter(f => f.value).length}`)
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗')
  console.log('║                       PAPER EXTRACTION TEST                                  ║')
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝')
  
  // Test both papers
  await testPaper(
    'Tomato Spoilage Study (Microbiology)', 
    './AJPB+2022+4+2+no+4+Garba+Tomato+28+31+-+Copy.pdf'
  )
  
  await testPaper(
    'Greenland Identity Politics (Political Science)',
    './lbaulund,+What+kind+of+nation+state+will+Greenland+be_+Securitization+theory+as+a+strategy+for+analyzing+identity+politics++.pdf'
  )
  
  console.log('\n✅ All tests complete!')
}

main().catch(console.error)
