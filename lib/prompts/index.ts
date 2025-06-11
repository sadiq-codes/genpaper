// Public API for the prompts module
export {
  loadPrompts,
  getPromptTemplate,
  getAvailablePaperTypes,
  getAvailableSections,
  validateDepthCues,
  clearPromptCache
} from './loader';

export type {
  PromptTemplate,
  PaperType,
  PromptLibrary,
  PaperTypeKey,
  SectionKey,
  PromptLoadError,
  PromptValidationError
} from './types'; 