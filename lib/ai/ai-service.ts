import 'server-only'
import { streamText, type ToolCallPart } from 'ai'
import { ai } from '@/lib/ai/vercel-client'

/**
 * AIService - Streaming Adapter
 * 
 * Isolates Vercel AI SDK usage and streaming concerns.
 * Provides mockable interface for tests and error handling.
 */

export interface StreamTextParams {
  model?: string
  system: string
  prompt: string
  tools?: Record<string, any>
  temperature?: number
  maxTokens?: number
}

export interface StreamEvent {
  type: 'text-delta' | 'tool-call' | 'finish' | 'error'
  data: any
}

export interface StreamResult {
  events: AsyncIterable<StreamEvent>
  usage: Promise<{ totalTokens?: number; promptTokens?: number; completionTokens?: number }>
}

export class AIService {
  private constructor() {}

  static async streamText(params: StreamTextParams): Promise<StreamResult> {
    const {
      model = 'gpt-4o',
      system,
      prompt,
      tools = {},
      temperature = 0.4,
      maxTokens
    } = params

    try {
      const result = await streamText({
        model: ai(model),
        system,
        prompt,
        tools,
        temperature,
        maxTokens
      })

      // Transform the Vercel AI stream into our standardized format
      const events = this.transformStream(result.fullStream)
      
      return {
        events,
        usage: result.usage.then(usage => ({
          totalTokens: usage?.totalTokens,
          promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens
        })).catch(() => ({}))
      }

    } catch (error) {
      // Convert to async iterable error stream
      const errorEvents: AsyncIterable<StreamEvent> = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'error',
            data: {
              message: error instanceof Error ? error.message : 'Unknown AI service error',
              error
            }
          }
        }
      }

      return {
        events: errorEvents,
        usage: Promise.resolve({})
      }
    }
  }

  private static async *transformStream(stream: AsyncIterable<any>): AsyncIterable<StreamEvent> {
    try {
      for await (const delta of stream) {
        if (delta.type === 'text-delta') {
          yield {
            type: 'text-delta',
            data: {
              textDelta: delta.textDelta
            }
          }
        } else if (delta.type === 'tool-call') {
          yield {
            type: 'tool-call',
            data: {
              toolName: delta.toolName,
              toolCallId: delta.toolCallId,
              args: delta.args
            }
          }
        } else if (delta.type === 'tool-result') {
          // Pass through tool results
          yield {
            type: 'tool-call',
            data: {
              toolName: delta.toolName,
              toolCallId: delta.toolCallId,
              result: delta.result
            }
          }
        } else if (delta.type === 'finish') {
          yield {
            type: 'finish',
            data: {
              finishReason: delta.finishReason,
              usage: delta.usage
            }
          }
        }
      }
    } catch (error) {
      yield {
        type: 'error',
        data: {
          message: error instanceof Error ? error.message : 'Stream processing error',
          error
        }
      }
    }
  }

  // Legacy support for simple text streaming
  static async *streamTextSimple(params: Omit<StreamTextParams, 'tools'>): AsyncIterable<string> {
    const result = await this.streamText(params)
    
    for await (const event of result.events) {
      if (event.type === 'text-delta') {
        yield event.data.textDelta
      } else if (event.type === 'error') {
        throw new Error(event.data.message)
      }
    }
  }

  // Helper for getting full text without streaming (for planning, reflection, etc.)
  static async generateText(params: Omit<StreamTextParams, 'tools'>): Promise<{ text: string; usage?: any }> {
    const chunks: string[] = []
    let usage: any = {}

    const result = await this.streamText(params)
    
    for await (const event of result.events) {
      if (event.type === 'text-delta') {
        chunks.push(event.data.textDelta)
      } else if (event.type === 'finish') {
        usage = event.data.usage
      } else if (event.type === 'error') {
        throw new Error(event.data.message)
      }
    }

    return {
      text: chunks.join(''),
      usage
    }
  }
}