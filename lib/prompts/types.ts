/**
 * Types for prompt templates matching the JSON schema
 */

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