declare module 'citation-js' {
  export interface CitationData {
    id: string
    [key: string]: unknown
  }

  export interface FormatOptions {
    format?: 'text' | 'html'
    template?: string
    lang?: string
    entry?: string
  }

  class Cite {
    data: CitationData[]
    
    constructor(data: unknown | unknown[])
    
    get(selector?: { id: string }): Cite
    format(type: 'citation' | 'bibliography', options?: FormatOptions): string
    
    static async(input: unknown): Promise<Cite>
  }
  
  export default Cite
  export { Cite }
}

declare module 'citation-js/build/citation.js' {
  export interface CitationData {
    id: string
    [key: string]: unknown
  }

  export interface FormatOptions {
    format?: 'text' | 'html'
    template?: string
    lang?: string
    entry?: string
  }

  class Cite {
    data: CitationData[]
    
    constructor(data: unknown | unknown[])
    
    get(selector?: { id: string }): Cite
    format(type: 'citation' | 'bibliography', options?: FormatOptions): string
    
    static async(input: unknown): Promise<Cite>
  }
  
  export default Cite
  export { Cite }
}

declare module '@citation-js/core' {
  export const plugins: {
    add: (name: string, config: unknown) => void
    config: {
      get: (name: string) => {
        templates?: {
          has: (id: string) => boolean
          get: (id: string) => string
          add: (id: string, template: string) => void
          list?: () => string[]
        }
        locales?: unknown
        engine?: unknown
      } | undefined
    }
  }
  
  export const util: {
    Register: new <T>(data?: Record<string, T>) => {
      has: (id: string) => boolean
      get: (id: string) => T
      add: (id: string, value: T) => void
      list?: () => string[]
    }
  }
}

declare module '@citation-js/plugin-csl' {
  // This module registers itself with @citation-js/core when imported
}

declare module 'parse-author' {
  export interface ParsedAuthor {
    given?: string
    family?: string
    literal?: string
  }
  
  export default function parseAuthor(name: string): ParsedAuthor
} 