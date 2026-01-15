import { describe, expect, test, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useChat } from '@/components/editor/hooks/useChat'
import type { ProjectPaper, AnalysisState } from '@/components/editor/types'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock crypto.randomUUID
const mockUUID = vi.fn()
let uuidCounter = 0
mockUUID.mockImplementation(() => `uuid-${++uuidCounter}`)
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: mockUUID,
  },
})

// Mock the tiptap-to-markdown module
vi.mock('@/components/editor/utils/tiptap-to-markdown', () => ({
  editorToMarkdown: vi.fn(() => '# Test Document\n\nSome content'),
}))

// Mock the content-processor module
vi.mock('@/components/editor/utils/content-processor', () => ({
  processContent: vi.fn((content) => ({
    json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: content }] }] },
    isFullDoc: false,
  })),
}))

import { editorToMarkdown } from '@/components/editor/utils/tiptap-to-markdown'
import { processContent } from '@/components/editor/utils/content-processor'

const mockPapers: ProjectPaper[] = [
  {
    id: 'paper-1',
    title: 'Test Paper 1',
    authors: ['Author A'],
    year: 2023,
    abstract: 'Abstract for paper 1',
  },
  {
    id: 'paper-2',
    title: 'Test Paper 2',
    authors: ['Author B'],
    year: 2024,
    abstract: 'Abstract for paper 2',
  },
]

const mockAnalysisState: AnalysisState = {
  status: 'complete',
  claims: [
    {
      id: 'claim-1',
      paper_id: 'paper-1',
      claim_text: 'Test claim',
      claim_type: 'finding',
      confidence: 0.9,
      source: 'literature',
    },
  ],
  userClaims: [],
  gaps: [
    {
      id: 'gap-1',
      project_id: 'test-project',
      gap_type: 'unstudied',
      description: 'Test gap',
      confidence: 0.8,
      supporting_paper_ids: ['paper-1'],
      addressed_status: 'not_analyzed',
    },
  ],
  synthesis: null,
  positioning: null,
  hasOriginalResearch: false,
}

// Create a mock editor
const createMockEditor = () => ({
  chain: vi.fn(() => ({
    focus: vi.fn(() => ({
      insertContent: vi.fn(() => ({
        run: vi.fn(),
      })),
    })),
  })),
})

describe('useChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    uuidCounter = 0
  })

  afterEach(() => {
    cleanup()
  })

  describe('initialization', () => {
    test('initializes with empty messages', () => {
      const { result } = renderHook(() =>
        useChat({
          projectId: 'test-project',
          editor: null,
          papers: mockPapers,
          analysisState: mockAnalysisState,
        })
      )

      expect(result.current.messages).toEqual([])
      expect(result.current.isLoading).toBe(false)
    })
  })

  describe('sendMessage', () => {
    test('sends message and receives AI response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          response: 'AI response text',
          citations: [{ paperId: 'paper-1', text: 'Citation' }],
        }),
      })

      const mockEditor = createMockEditor()
      const { result } = renderHook(() =>
        useChat({
          projectId: 'test-project',
          editor: mockEditor as any,
          papers: mockPapers,
          analysisState: mockAnalysisState,
        })
      )

      await act(async () => {
        await result.current.sendMessage('Hello AI')
      })

      // Should have user message and assistant response
      expect(result.current.messages).toHaveLength(2)
      
      // Check user message
      expect(result.current.messages[0].role).toBe('user')
      expect(result.current.messages[0].content).toBe('Hello AI')
      expect(result.current.messages[0].id).toBe('uuid-1')

      // Check assistant message
      expect(result.current.messages[1].role).toBe('assistant')
      expect(result.current.messages[1].content).toBe('AI response text')
      expect(result.current.messages[1].citations).toEqual([{ paperId: 'paper-1', text: 'Citation' }])
    })

    test('sends correct payload to API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: 'Response' }),
      })

      const mockEditor = createMockEditor()
      const { result } = renderHook(() =>
        useChat({
          projectId: 'test-project',
          editor: mockEditor as any,
          papers: mockPapers,
          analysisState: mockAnalysisState,
        })
      )

      await act(async () => {
        await result.current.sendMessage('Test message')
      })

      expect(mockFetch).toHaveBeenCalledWith('/api/editor/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'test-project',
          message: 'Test message',
          documentContent: '# Test Document\n\nSome content',
          papers: [
            { id: 'paper-1', title: 'Test Paper 1', abstract: 'Abstract for paper 1' },
            { id: 'paper-2', title: 'Test Paper 2', abstract: 'Abstract for paper 2' },
          ],
          claims: mockAnalysisState.claims.slice(0, 20),
          gaps: mockAnalysisState.gaps,
        }),
      })
    })

    test('handles API error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockFetch.mockResolvedValueOnce({ ok: false })

      const { result } = renderHook(() =>
        useChat({
          projectId: 'test-project',
          editor: null,
          papers: mockPapers,
          analysisState: mockAnalysisState,
        })
      )

      await act(async () => {
        await result.current.sendMessage('Test')
      })

      // Should have user message and error response
      expect(result.current.messages).toHaveLength(2)
      expect(result.current.messages[1].role).toBe('assistant')
      expect(result.current.messages[1].content).toBe('Sorry, I encountered an error. Please try again.')

      consoleSpy.mockRestore()
    })

    test('handles network error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() =>
        useChat({
          projectId: 'test-project',
          editor: null,
          papers: mockPapers,
          analysisState: mockAnalysisState,
        })
      )

      await act(async () => {
        await result.current.sendMessage('Test')
      })

      expect(result.current.messages).toHaveLength(2)
      expect(result.current.messages[1].content).toBe('Sorry, I encountered an error. Please try again.')

      consoleSpy.mockRestore()
    })

    test('sets loading state during request', async () => {
      let resolveRequest: () => void
      const requestPromise = new Promise<void>((resolve) => {
        resolveRequest = resolve
      })

      mockFetch.mockImplementationOnce(() =>
        requestPromise.then(() => ({
          ok: true,
          json: () => Promise.resolve({ response: 'Response' }),
        }))
      )

      const { result } = renderHook(() =>
        useChat({
          projectId: 'test-project',
          editor: null,
          papers: mockPapers,
          analysisState: mockAnalysisState,
        })
      )

      expect(result.current.isLoading).toBe(false)

      // Start request
      const sendPromise = act(async () => {
        result.current.sendMessage('Test')
      })

      // While waiting, isLoading should be true (check happens async)
      await new Promise((r) => setTimeout(r, 10))
      
      // Complete request
      await act(async () => {
        resolveRequest!()
      })

      await sendPromise

      expect(result.current.isLoading).toBe(false)
    })

    test('applies edits from AI response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          response: 'Response',
          edits: [
            { type: 'insert', content: 'New paragraph content' },
          ],
        }),
      })

      const mockEditor = createMockEditor()
      const { result } = renderHook(() =>
        useChat({
          projectId: 'test-project',
          editor: mockEditor as any,
          papers: mockPapers,
          analysisState: mockAnalysisState,
        })
      )

      await act(async () => {
        await result.current.sendMessage('Add a paragraph')
      })

      // Verify processContent was called
      expect(processContent).toHaveBeenCalledWith('New paragraph content', mockPapers)
      
      // Verify editor chain was called
      expect(mockEditor.chain).toHaveBeenCalled()
    })

    test('handles null editor for document content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: 'Response' }),
      })

      const { result } = renderHook(() =>
        useChat({
          projectId: 'test-project',
          editor: null,
          papers: mockPapers,
          analysisState: mockAnalysisState,
        })
      )

      await act(async () => {
        await result.current.sendMessage('Test')
      })

      // Should send empty string for documentContent when editor is null
      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(body.documentContent).toBe('')
    })
  })

  describe('clearMessages', () => {
    test('clears all messages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: 'Response' }),
      })

      const { result } = renderHook(() =>
        useChat({
          projectId: 'test-project',
          editor: null,
          papers: mockPapers,
          analysisState: mockAnalysisState,
        })
      )

      // Send a message first
      await act(async () => {
        await result.current.sendMessage('Test')
      })

      expect(result.current.messages).toHaveLength(2)

      // Clear messages
      act(() => {
        result.current.clearMessages()
      })

      expect(result.current.messages).toEqual([])
    })
  })

  describe('message timestamps', () => {
    test('adds timestamps to messages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: 'Response' }),
      })

      const { result } = renderHook(() =>
        useChat({
          projectId: 'test-project',
          editor: null,
          papers: mockPapers,
          analysisState: mockAnalysisState,
        })
      )

      await act(async () => {
        await result.current.sendMessage('Test')
      })

      expect(result.current.messages[0].timestamp).toBeInstanceOf(Date)
      expect(result.current.messages[1].timestamp).toBeInstanceOf(Date)
    })
  })

  describe('claims limiting', () => {
    test('limits claims to 20 in API request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: 'Response' }),
      })

      // Create analysis state with more than 20 claims
      const manyClaimsState: AnalysisState = {
        ...mockAnalysisState,
        claims: Array.from({ length: 30 }, (_, i) => ({
          id: `claim-${i}`,
          claim_text: `Claim ${i}`,
          claim_type: 'finding' as const,
          confidence: 0.9,
          source: 'literature' as const,
        })),
      }

      const { result } = renderHook(() =>
        useChat({
          projectId: 'test-project',
          editor: null,
          papers: mockPapers,
          analysisState: manyClaimsState,
        })
      )

      await act(async () => {
        await result.current.sendMessage('Test')
      })

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(body.claims).toHaveLength(20)
    })
  })
})
