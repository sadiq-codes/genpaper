import type { SearchOptions } from '@/contracts/search-sources'

/**
 * Generate up to k alternative keyword search queries that are semantically
 * similar to the input query. Falls back to returning the original query if
 * no LLM key is present or API fails.
 */
export async function generateQueryRewrites(query: string, k = 3): Promise<string[]> {
  const rewrites: string[] = [query.trim()]

  if (!process.env.OPENAI_API_KEY) return rewrites

  try {
    const body = {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are an academic search assistant.' },
        {
          role: 'user',
          content: `Generate ${k} alternative keyword-style academic search queries that would find papers similar to: "${query}".
Return the list as a JSON array of plain strings. Do not add any explanation.`
        }
      ],
      temperature: 0.7,
      max_tokens: 150
    }

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(body)
    })

    if (!resp.ok) throw new Error(`OpenAI ${resp.status}`)

    const data = (await resp.json()) as any
    const text: string = data.choices?.[0]?.message?.content || '[]'
    let arr: string[] = []
    try {
      arr = JSON.parse(text)
    } catch {
      // fallback: attempt to split by newline / dash
      arr = text.split(/\n|\r|-/).map((s: string) => s.trim()).filter(Boolean)
    }

    rewrites.push(...arr.slice(0, k))
  } catch (err) {
    console.warn('query-rewrite failed', err)
  }

  // Remove dups & empty, limit to k+1 items
  return Array.from(new Set(rewrites)).filter(Boolean).slice(0, k + 1)
} 