import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();
    
    if (!query) {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    // CrossRef API search
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=10`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'GenPaper/1.0 (mailto:support@genpaper.ai)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`CrossRef API returned ${response.status}`);
    }
    
    const data = await response.json();
    
    return NextResponse.json({
      items: data.message?.items || [],
      totalResults: data.message?.['total-results'] || 0
    });
  } catch (error) {
    console.error('CrossRef API error:', error);
    return NextResponse.json(
      { error: 'Failed to search CrossRef' },
      { status: 500 }
    );
  }
} 