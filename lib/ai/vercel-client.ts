import { createOpenAI } from '@ai-sdk/openai'

// Vercel AI SDK client for paper generation
// Keeps existing OpenAI SDK for embeddings until AI SDK supports them
export const ai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  // You can add custom headers or baseURL here if needed
  // baseURL: process.env.OPENAI_BASE_URL
})

// Re-export commonly used types for convenience
export type { 
  CoreMessage,
  LanguageModel
} from 'ai' 