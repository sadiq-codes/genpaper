// Public API for the prompts module
export {
  generateOutlineSystemPrompt,
  generateOutlineUserPrompt,
  generateOutline,
  generateQualityCriteria,
  generateSectionPlanPrompt
} from './generators';

export type {
  PaperTypeKey,
  SectionKey,
  OutlineSection,
  GeneratedOutline,
  OutlineConfig,
  SectionContext,
  SectionConfig,
  PromptTemplate,
  PaperType,
  PromptLibrary,
  PromptLoadError,
  PromptValidationError
} from './types'; 