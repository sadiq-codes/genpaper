import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const { query, projectId } = await request.json();
    
    if (!query || !projectId) {
      return NextResponse.json(
        { error: 'Query and projectId are required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    
    // Verify user has access to project
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Search citations in user's library
    // Using PostgreSQL full-text search or simple ILIKE for now
    const { data: citations, error } = await supabase
      .from('citations')
      .select('*')
      .eq('project_id', projectId)
      .or(`title.ilike.%${query}%,doi.ilike.%${query}%,journal.ilike.%${query}%`)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Search error:', error);
      return NextResponse.json(
        { error: 'Failed to search citations' },
        { status: 500 }
      );
    }

    // Also search in authors JSONB field
    const { data: authorMatches } = await supabase
      .from('citations')
      .select('*')
      .eq('project_id', projectId)
      .filter('authors', 'cs', `[{"family":"${query}"}]`)
      .limit(10);

    // Combine and deduplicate results
    const allResults = [...(citations || []), ...(authorMatches || [])];
    const uniqueResults = Array.from(
      new Map(allResults.map(item => [item.id, item])).values()
    );

    return NextResponse.json(uniqueResults);
  } catch (error) {
    console.error('Search API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 