/**
 * OCR Diagnostic Script
 * 
 * Run with: npx tsx scripts/test-ocr.ts
 */

import { readFile, writeFile } from 'fs/promises'
import { createWorker } from 'tesseract.js'
import pdf2pic from 'pdf2pic'
import { execSync } from 'child_process'

const TEST_PDF = '/Users/ameer/Projects/sass/genpaper/AJPB+2022+4+2+no+4+Garba+Tomato+28+31+-+Copy.pdf'

async function testOcr() {
  console.log('=== OCR Diagnostic Test ===\n')
  
  // Step 1: Read PDF
  console.log('1. Reading PDF file...')
  const pdfBuffer = await readFile(TEST_PDF)
  console.log(`   ✓ Read ${(pdfBuffer.length / 1024).toFixed(1)} KB\n`)
  
  // Step 2: Convert PDF to image
  console.log('2. Converting PDF to image (pdf2pic)...')
  try {
    console.log('   pdf2pic module:', pdf2pic)
    console.log('   fromBuffer:', typeof pdf2pic.fromBuffer)
    
    const options = {
      density: 150,           // Lower DPI for faster test
      saveFilename: "test-page",
      savePath: "/tmp",
      format: "png",
      width: 1500,
      height: 2000
    }
    console.log('   Options:', options)
    
    const convert = pdf2pic.fromBuffer(pdfBuffer, options)
    console.log('   convert function:', typeof convert)
    
    console.log('   Attempting to convert page 1...')
    const startConvert = Date.now()
    
    // Try different responseType options
    console.log('   Trying responseType: buffer...')
    const pageResult = await convert(1, { responseType: 'buffer' })
    const convertTime = Date.now() - startConvert
    
    console.log('   pageResult:', pageResult)
    console.log('   pageResult keys:', Object.keys(pageResult))
    
    // If pdf2pic returns empty buffer, try direct ImageMagick/Ghostscript
    if (!pageResult.buffer || pageResult.buffer.length === 0) {
      console.log('\n   ⚠️ pdf2pic returned empty buffer, trying direct conversion...')
      
      // Try direct ghostscript conversion
      console.log('   Trying Ghostscript directly...')
      try {
        const gsCmd = `gs -dNOPAUSE -dBATCH -sDEVICE=png16m -r150 -dFirstPage=1 -dLastPage=1 -sOutputFile=/tmp/test-gs-page.png "${TEST_PDF}"`
        console.log(`   Command: ${gsCmd}`)
        execSync(gsCmd, { stdio: 'pipe' })
        
        const gsBuffer = await readFile('/tmp/test-gs-page.png')
        console.log(`   ✓ Ghostscript produced ${(gsBuffer.length / 1024).toFixed(1)} KB image`)
        
        // Use this buffer instead
        pageResult.buffer = gsBuffer
      } catch (gsErr) {
        console.log('   ✗ Ghostscript failed:', gsErr)
      }
    }
    
    if (pageResult.buffer && pageResult.buffer.length > 0) {
      console.log(`   ✓ Converted page 1 in ${convertTime}ms`)
      console.log(`   ✓ Image buffer size: ${(pageResult.buffer.length / 1024).toFixed(1)} KB`)
      console.log(`   ✓ Buffer type: ${typeof pageResult.buffer}\n`)
      
      // Step 3: Run Tesseract OCR
      console.log('3. Running Tesseract OCR...')
      const startOcr = Date.now()
      
      console.log('   Creating worker...')
      const worker = await createWorker('eng')
      console.log('   ✓ Worker created')
      
      console.log('   Running recognition...')
      const { data: { text } } = await worker.recognize(pageResult.buffer)
      const ocrTime = Date.now() - startOcr
      
      await worker.terminate()
      
      console.log(`   ✓ OCR completed in ${ocrTime}ms`)
      console.log(`   ✓ Extracted ${text.length} characters\n`)
      
      console.log('=== Extracted Text (first 500 chars) ===')
      console.log(text.slice(0, 500))
      console.log('...\n')
      
      console.log('=== SUCCESS: OCR is working! ===')
      
    } else {
      console.log('   ✗ No buffer returned from pdf2pic')
    }
  } catch (error) {
    console.log('   ✗ Error:', error)
    console.log('\n=== FAILURE: OCR pipeline broken ===')
    
    if (error instanceof Error) {
      console.log('\nError details:')
      console.log('  Name:', error.name)
      console.log('  Message:', error.message)
      console.log('  Stack:', error.stack?.split('\n').slice(0, 5).join('\n'))
    }
  }
}

testOcr().catch(console.error)
