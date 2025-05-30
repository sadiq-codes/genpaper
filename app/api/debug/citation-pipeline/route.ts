import { NextRequest, NextResponse } from 'next/server'
import { literatureSearchTool } from '@/lib/ai/tools/literatureSearch'
import { extractStructuredCitations, saveStructuredCitations } from '@/lib/citations/utils'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const results = {
    timestamp: new Date().toISOString(),
    tests: [] as any[]
  }

  // Test 1: Literature Search Tool
  try {
    console.log('🔍 Testing literature search tool...')
    const searchResults = await literatureSearchTool.execute({
      query: 'machine learning neural networks',
      max_results: 3
    })

    results.tests.push({
      name: 'Literature Search Tool',
      status: 'success',
      data: {
        resultCount: searchResults.length,
        sampleResult: searchResults[0] || null
      }
    })
    console.log(`✅ Literature search returned ${searchResults.length} results`)
  } catch (error) {
    results.tests.push({
      name: 'Literature Search Tool',
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
    console.log('❌ Literature search failed:', error)
  }

  // Test 2: Citation Extraction
  try {
    console.log('🔍 Testing citation extraction...')
    const testText = `
      Machine learning has revolutionized many fields [CN: machine learning impact studies].
      Recent advances in neural networks have shown significant improvements [CITE: Neural Network Advances].
      Deep learning algorithms are now widely used [CN: deep learning adoption statistics].
    `

    const mockLiteratureResults = [{
      title: 'Neural Network Advances in Machine Learning',
      authors: [{ name: 'Smith, J.' }],
      year: 2023,
      doi: '10.1000/example',
      source_url: 'https://example.com/paper',
      abstract_snippet: 'Recent advances...'
    }]

    const extracted = extractStructuredCitations(testText, mockLiteratureResults)

    results.tests.push({
      name: 'Citation Extraction',
      status: 'success',
      data: {
        extractedCount: extracted.length,
        citations: extracted
      }
    })
    console.log(`✅ Extracted ${extracted.length} citations`)
  } catch (error) {
    results.tests.push({
      name: 'Citation Extraction',
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
    console.log('❌ Citation extraction failed:', error)
  }

  // Test 3: Database Connection
  try {
    console.log('🔍 Testing database connection...')
    const supabase = await createClient()
    
    const { data: citations, error } = await supabase
      .from('citations')
      .select('id, title, created_at')
      .limit(5)

    if (error) throw error

    results.tests.push({
      name: 'Database Connection',
      status: 'success',
      data: {
        existingCitations: citations?.length || 0,
        citations: citations || []
      }
    })
    console.log(`✅ Database connection successful, found ${citations?.length || 0} existing citations`)
  } catch (error) {
    results.tests.push({
      name: 'Database Connection',
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
    console.log('❌ Database connection failed:', error)
  }

  // Test 4: AI SDK Configuration Check
  try {
    console.log('🔍 Testing AI SDK configuration...')
    const hasOpenAIKey = !!process.env.OPENAI_API_KEY
    const hasSemanticScholarKey = !!process.env.SEMANTIC_SCHOLAR_API_KEY

    results.tests.push({
      name: 'AI SDK Configuration',
      status: 'success',
      data: {
        openaiConfigured: hasOpenAIKey,
        semanticScholarConfigured: hasSemanticScholarKey,
        envVars: {
          NODE_ENV: process.env.NODE_ENV,
          hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
          hasSupabaseKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        }
      }
    })
    console.log(`✅ AI SDK configuration checked`)
  } catch (error) {
    results.tests.push({
      name: 'AI SDK Configuration',
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
    console.log('❌ AI SDK configuration check failed:', error)
  }

  // Summary
  const successCount = results.tests.filter(t => t.status === 'success').length
  const totalCount = results.tests.length

  console.log(`\n✨ Testing complete: ${successCount}/${totalCount} tests passed`)

  return NextResponse.json({
    ...results,
    summary: {
      totalTests: totalCount,
      passedTests: successCount,
      failedTests: totalCount - successCount,
      allPassed: successCount === totalCount
    }
  })
}

export async function POST(request: NextRequest) {
  try {
    const { projectId, testCitationSave } = await request.json()

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 })
    }

    if (testCitationSave) {
      // Test saving citations to database
      console.log('🔍 Testing citation save to database...')
      
      const mockCitations = [{
        title: 'Test Citation for Debugging',
        authors: [{ name: 'Debug, A.' }, { name: 'Test, B.' }],
        year: 2024,
        doi: '10.1000/debug.test',
        source_url: 'https://example.com/debug',
        citation_placeholder: '[CITE: Debug Test]',
        relevance_explanation: 'Test citation for debugging pipeline'
      }]

      const result = await saveStructuredCitations(projectId, mockCitations, 'Debug Section')

      return NextResponse.json({
        message: 'Citation save test completed',
        result
      })
    }

    return NextResponse.json({ error: 'No test specified' }, { status: 400 })
  } catch (error) {
    console.error('Debug POST error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
} 