// Public API for the prompts module
export {
  loadPrompts,
  getPromptTemplate,
  getAvailablePaperTypes,
  getAvailableSections,
  validateDepthCues,
  clearPromptCache
} from './loader';

export {
  generateOutlineSystemPrompt,
  generateOutlineUserPrompt,
  generateOutline,
  generateSectionPrompt,
  generateSection,
  generateMultipleSections
} from './generators';

export type {
  PaperTypeKey,
  SectionKey,
  OutlineSection,
  GeneratedOutline,
  OutlineConfig,
  SectionContext,
  SectionConfig,
  GeneratedSection,
  SectionDraftingOptions,
  PromptTemplate,
  CitationStyle,
  PaperType,
  PromptLibrary,
  PromptLoadError,
  PromptValidationError
} from './types';

export type { TemplateOptions } from './generators'; 