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
  generateSectionPrompt,
  generateLiteratureReviewPrompt,
  generateMethodologyPrompt,
  generateDiscussionPrompt,
  generateOutlineSystemPrompt,
  generateOutlineUserPrompt,
  generateOutline
} from './generators';

export type {
  PromptTemplate,
  PaperType,
  PromptLibrary,
  PaperTypeKey,
  SectionKey,
  PromptLoadError,
  PromptValidationError,
  GeneratedOutline,
  OutlineSection,
  OutlineConfig
} from './types';

export type { TemplateOptions } from './generators'; 