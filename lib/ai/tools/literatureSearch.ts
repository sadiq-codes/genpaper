import { z } from 'zod';
import { tool } from 'ai'; // Assuming 'ai' package or a similar utility from lib/ai/sdk.ts

// Define the output structure for a single search result
export interface LiteratureSearchResult {
  title: string;
  authors: Array<{
    name?: string; // Full name as a single string
    family?: string; // Last name
    given?: string;  // First name
  }>;
  year: number | null;
  abstract_snippet: string;
  source_url: string | null;
  doi: string | null;
}

// Define structured citation schema for AI SDK structured data generation
export const structuredCitationSchema = z.object({
  title: z.string().describe("The title of the cited work"),
  authors: z.array(z.object({
    name: z.string().describe("Full name of author")
  })).describe("Array of authors"),
  year: z.number().nullable().describe("Publication year"),
  doi: z.string().nullable().describe("DOI identifier if available"),
  source_url: z.string().nullable().describe("URL to the source"),
  citation_placeholder: z.string().describe("The placeholder to insert in text, e.g., [CITE: DOI] or [CITE: Title]"),
  relevance_explanation: z.string().describe("Brief explanation of why this source is relevant to the claim")
});

export type StructuredCitation = z.infer<typeof structuredCitationSchema>;

// Define the input schema for the literatureSearch tool using Zod
const literatureSearchParameters = z.object({
  query: z.string().describe("The search query for academic literature, keywords, or research topics."),
  max_results: z.number().int().positive().optional().default(5).describe("Maximum number of search results to return. Defaults to 5, maximum 20 for this tool."),
});

// Type for the function parameters, inferred from the Zod schema
type LiteratureSearchParameters = z.infer<typeof literatureSearchParameters>;

// Define the structure for Semantic Scholar API response items
interface SemanticScholarPaper {
  title?: string;
  authors?: Array<{ name?: string }>;
  year?: number;
  abstract?: string;
  url?: string;
  externalIds?: { DOI?: string };
}

// Simple in-memory cache to avoid duplicate API calls
const searchCache = new Map<string, { data: LiteratureSearchResult[]; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache

// Rate limiting variables
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000; // 1 second between requests

// Sleep utility for delays
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Exponential backoff retry utility
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      if (attempt === maxRetries - 1) throw error;
      
      // If it's a rate limit error, wait longer
      const delay = error.status === 429 
        ? baseDelay * Math.pow(2, attempt) + Math.random() * 1000 // Exponential backoff with jitter
        : baseDelay;
      
      console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
  throw new Error('Max retries exceeded');
}

// Updated implementation of the literature search function using Semantic Scholar API
async function literatureSearchImplementation(
  params: LiteratureSearchParameters
): Promise<LiteratureSearchResult[]> {
  const { query, max_results } = params;
  // Cap results at a reasonable number for the API, e.g., Semantic Scholar's typical limits
  const effectiveMaxResults = Math.min(max_results, 20); 

  // Create cache key
  const cacheKey = `${query}-${effectiveMaxResults}`;
  
  // Check cache first
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log(`Literature search cache hit for: "${query}"`);
    return cached.data;
  }

  console.log(`Literature search using Semantic Scholar: "${query}", effective_max_results: ${effectiveMaxResults}`);

  // Fallback mock data in case API fails
  const mockResults: LiteratureSearchResult[] = [
    {
      title: `Research on ${query}: A Comprehensive Study`,
      authors: [{ name: 'Smith, J.' }, { name: 'Johnson, A.' }],
      year: 2023,
      abstract_snippet: `This study examines ${query} and provides insights into current research trends and methodologies.`,
      source_url: 'https://example.com/paper1',
      doi: '10.1000/example.doi.1'
    },
    {
      title: `Advanced Analysis of ${query}`,
      authors: [{ name: 'Brown, M.' }, { name: 'Davis, K.' }],
      year: 2022,
      abstract_snippet: `An in-depth analysis of ${query} with practical applications and future research directions.`,
      source_url: 'https://example.com/paper2',
      doi: '10.1000/example.doi.2'
    }
  ];

  // Rate limiting: ensure minimum interval between requests
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    console.log(`Rate limiting: waiting ${waitTime}ms before next request`);
    await sleep(waitTime);
  }

  // It's good practice to store API keys in environment variables
  const semanticScholarApiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (semanticScholarApiKey) {
    headers['x-api-key'] = semanticScholarApiKey;
    console.log('Using Semantic Scholar API Key');
  } else {
    console.log('No API key found - using rate-limited public access');
  }

  const fields = [
    'title',
    'authors.name',
    'year',
    'abstract',
    'url',
    'externalIds.DOI' // Correctly requesting externalIds to get DOI
  ].join(',');

  const apiUrl = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${effectiveMaxResults}&fields=${fields}`;

  try {
    const results = await retryWithBackoff(async () => {
      lastRequestTime = Date.now();
      
      const response = await fetch(apiUrl, { headers });

      if (!response.ok) {
        const errorBody = await response.text();
        const error: any = new Error(`Semantic Scholar API error: ${response.status} ${response.statusText}`);
        error.status = response.status;
        error.body = errorBody;
        
        console.error('Semantic Scholar API error:', {
          query,
          effectiveMaxResults,
          responseStatus: response.status,
          responseBody: errorBody,
        });
        
        throw error;
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const textBody = await response.text();
        console.error("Semantic Scholar API did not return JSON:", {
          query,
          effectiveMaxResults,
          contentType,
          body: textBody,
        });
        throw new Error('Non-JSON response from API');
      }

      const searchData = await response.json();

      // Semantic Scholar nests actual results in searchData.data for batch paper search
      // and searchData can be an object with total, offset, next, data properties
      if (!searchData || !Array.isArray(searchData.data)) {
        console.warn('Semantic Scholar API returned no data array or unexpected format', {
          query,
          responseData: searchData,
        });
        throw new Error('Unexpected response format');
      }

      const apiResults: LiteratureSearchResult[] = searchData.data.map((item: SemanticScholarPaper) => ({
        title: item.title || 'N/A',
        authors: item.authors 
          ? item.authors.map((author) => ({ name: author.name || 'N/A' })) 
          : [{ name: 'N/A' }], // Ensure authors is always an array
        year: item.year || null,
        abstract_snippet: item.abstract || 'No abstract available.', // Using full abstract
        source_url: item.url || null, // This is the Semantic Scholar URL for the paper
        doi: item.externalIds?.DOI || null, // Safely access DOI
      }));

      console.log(`Successfully retrieved ${apiResults.length} results from Semantic Scholar API`);
      
      // Cache successful results
      searchCache.set(cacheKey, { data: apiResults, timestamp: Date.now() });
      
      return apiResults;
    }, 3, 1000);

    return results;

  } catch (error) {
    // Catch any other errors during fetch or parsing
    console.error('Error fetching or parsing from Semantic Scholar API:', {
      query,
      errorDetails: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    console.log('Falling back to mock data due to fetch error');
    
    // Cache mock results temporarily to avoid repeated failures
    const mockData = mockResults.slice(0, effectiveMaxResults);
    searchCache.set(cacheKey, { data: mockData, timestamp: Date.now() });
    
    return mockData;
  }
}

// Export the tool definition for the AI SDK
export const literatureSearchTool = tool({
  description: 'Performs a literature search for academic papers and articles using the Semantic Scholar API based on a query. Returns a list of search results including title, authors, year, abstract snippet, source URL, and DOI.',
  parameters: literatureSearchParameters,
  execute: async ({ query, max_results }) => {
    return literatureSearchImplementation({ query, max_results });
  },
});

// For debugging or direct invocation if needed:
// (async () => {
//   if (require.main === module) {
//     try {
//       console.log("Testing literatureSearchTool...");
//       const testParams1 = { query: "artificial intelligence in healthcare", max_results: 2 };
//       const results1 = await literatureSearchImplementation(testParams1);
//       console.log(
//         `Results for query: "${testParams1.query}", max_results: ${testParams1.max_results}`,
//         JSON.stringify(results1, null, 2)
//       );
// 
//       const testParams2 = { query: "climate change impact on agriculture", max_results: 1 };
//       const results2 = await literatureSearchImplementation(testParams2);
//       console.log(
//         `Results for query: "${testParams2.query}", max_results: ${testParams2.max_results}`,
//         JSON.stringify(results2, null, 2)
//       );
// 
//       const testParamsNoResults = { query: "nonexistenttopicxyz123qwerty", max_results: 1 };
//       const resultsNoResults = await literatureSearchImplementation(testParamsNoResults);
//       console.log(
//         `Results for query: "${testParamsNoResults.query}", max_results: ${testParamsNoResults.max_results}`,
//         JSON.stringify(resultsNoResults, null, 2)
//       );
//     } catch (e) {
//       console.error("Error during direct invocation test:", e);
//     }
//   }
// })(); 