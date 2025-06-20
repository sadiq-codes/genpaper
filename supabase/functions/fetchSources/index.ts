// deno-lint-ignore-file
// @ts-nocheck

import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { searchAndIngestPapers } from "../../../lib/services/paper-aggregation.ts"

// Minimal JSON POST handler. Delegates search to shared helper.
serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Use POST { topic }' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  let body: { topic?: string; maxResults?: number }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const topic = body.topic?.trim()
  if (!topic) {
    return new Response(JSON.stringify({ error: 'Missing "topic"' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const { papers, ingestedIds } = await searchAndIngestPapers(topic, {
      maxResults: body.maxResults ?? 50,
      sources: ['openalex', 'crossref', 'semantic_scholar']
    })

    return new Response(JSON.stringify({ count: papers.length, ingestedIds }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (e) {
    console.error('fetchSources error', e)
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}) 