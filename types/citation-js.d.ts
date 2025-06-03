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

  export class Cite {
    data: CitationData[]
    
    constructor(data: unknown | unknown[])
    
    get(selector?: { id: string }): Cite
    format(type: 'citation' | 'bibliography', options?: FormatOptions): string
    
    static async(input: unknown): Promise<Cite>
  }
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

  export class Cite {
    data: CitationData[]
    
    constructor(data: unknown | unknown[])
    
    get(selector?: { id: string }): Cite
    format(type: 'citation' | 'bibliography', options?: FormatOptions): string
    
    static async(input: unknown): Promise<Cite>
  }
}

declare module 'parse-author' {
  export interface ParsedAuthor {
    given?: string
    family?: string
    literal?: string
  }
  
  export default function parseAuthor(name: string): ParsedAuthor
} 