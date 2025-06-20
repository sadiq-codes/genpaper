/**
 * Types for prompt templates matching the JSON schema
 */

export type CitationStyle = 'apa' | 'mla' | 'chicago';

export interface PromptTemplate {
  systemPrompt: string;
  userPromptTemplate: string;
  requiredDepthCues: string[];
  expectedLength?: {
    words?: number;
    paragraphs?: number;
  };
}

export interface PaperType {
  name: string;
  description: string;
  sections: {
    outline: PromptTemplate;
    introduction?: PromptTemplate;
    literatureReview?: PromptTemplate;
    thematicSection?: PromptTemplate;
    methodology?: PromptTemplate;
    results?: PromptTemplate;
    discussion?: PromptTemplate;
    conclusion?: PromptTemplate;
    abstract?: PromptTemplate;
  };
  depthCues: string[];
}

export interface PromptLibrary {
  paperTypes: {
    researchArticle: PaperType;
    literatureReview: PaperType;
    capstoneProject?: PaperType;
    mastersThesis?: PaperType;
    phdDissertation?: PaperType;
  };
}

export type PaperTypeKey = keyof PromptLibrary['paperTypes'];
export type SectionKey = keyof PaperType['sections'];

export interface PromptLoadError extends Error {
  name: 'PromptLoadError';
  details?: unknown;
}

export interface PromptValidationError extends Error {
  name: 'PromptValidationError';  
  validationErrors: string[];
}

// TASK 3: Outline Generation Types
export interface OutlineSection {
  sectionKey: SectionKey;
  title: string;
  candidatePaperIds: string[];
  keyPoints?: string[];
  expectedWords?: number;
}

export interface GeneratedOutline {
  paperType: PaperTypeKey;
  topic: string;
  sections: OutlineSection[];
  totalEstimatedWords?: number;
  citationStyle?: string;
  localRegion?: string;
}

export interface OutlineConfig {
  topic?: string;
  citationStyle?: 'apa' | 'mla' | 'chicago';
  pageLength?: number;
  localRegion?: string;
  temperature?: number;
  maxTokens?: number;
}

// TASK 4: Section Drafting Types
export interface SectionContext {
  sectionKey: SectionKey;
  title: string;
  candidatePaperIds: string[];
  contextChunks: Array<{
    paper_id: string;
    content: string;
    score?: number;
  }>;
  expectedWords?: number;
  keyPoints?: string[];
}

export interface SectionConfig {
  temperature?: number;
  maxTokens?: number;
  citationStyle?: CitationStyle;
  localRegion?: string;
  studyDesign?: 'qualitative' | 'quantitative' | 'mixed';
  fewShot?: boolean;
  onProgress?: (progress: {
    type?: string;
    stage: string;
    progress: number;
    message: string;
    reviewData?: unknown;
  }) => void;
}

export interface GeneratedSection {
  sectionKey: SectionKey;
  title: string;
  content: string;
  citations: Array<{
    paperId: string;
    citationText: string;
    positionStart?: number;
    positionEnd?: number;
  }>;
  wordCount: number;
  keyPointsCovered?: string[];
  qualityMetrics?: {
    citationDensity: number;
    depthCuesCovered: string[];
    missingDepthCues: string[];
  };
}

export interface SectionDraftingOptions {
  paperType: PaperTypeKey;
  topic: string;
  sectionContext: SectionContext;
  config?: SectionConfig;
}

// TASK 8: Final Polish Types (Improved)
export type ImprovementType = 
  | 'transitions' 
  | 'citations' 
  | 'depth' 
  | 'coherence' 
  | 'consistency' 
  | 'integration' 
  | 'enhancement' 
  | 'quality';

export interface SectionContent {
  sectionKey: SectionKey;
  title: string;
  content: string;
  wordCount: number;
}

export interface PolishConfig {
  paperType: PaperTypeKey;
  topic: string;
  citationStyle: CitationStyle;
  localRegion?: string;
  targetWordCount?: number;
  temperature?: number;
  maxTokens?: number;
  chunkSections?: boolean; // For handling large documents
  enableRetry?: boolean;   // For automatic quality retry
  onProgress?: (progress: {
    stage: 'analyzing' | 'polishing' | 'validating' | 'retrying';
    progress: number;
    message: string;
    currentChunk?: number;
    totalChunks?: number;
  }) => void;
}

export interface PolishedDocument {
  content: string;
  wordCount: number;
  sectionsProcessed: number;
  improvementsApplied: ImprovementType[];
  qualityScore: number;
  chunks?: number; // For chunked processing
}

export interface PolishValidation {
  isValid: boolean;
  issues: string[];
  score: number;
  requiredImprovements?: ImprovementType[];
}

export interface PolishInstructions {
  systemPrompt: string;
  requirements: string[];
  focusAreas: string[];
  qualityThresholds: {
    minWordCount?: number;
    minCitationDensity?: number;
    requiredSections?: string[];
  };
}