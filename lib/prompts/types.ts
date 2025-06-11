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
    dissertation?: PaperType;
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