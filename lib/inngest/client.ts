import { Inngest } from "inngest";

// Create a single Inngest client for the application
// The client is used to define functions and send events
export const inngest = new Inngest({
  id: "genpaper",
  // In development, Inngest Dev Server runs locally
  // In production, uses INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY from env
});

// Event types for type safety
export interface GenerationStartEvent {
  name: "paper/generation.start";
  data: {
    runId: string;
    projectId: string;
    userId: string;
    /** @deprecated No longer used - billing now uses has_generated flag on project */
    isNewProject?: boolean;
    config: {
      topic: string;
      paperType: string;
      length: string;
      citationStyle: string;
      temperature?: number;
      maxTokens?: number;
      sources?: string[];
      hasOriginalResearch: boolean;
      customInstructions?: string;
      useLibraryOnly?: boolean;
      libraryPaperIds?: string[];
    };
    baseUrl: string;
  };
}

export interface GenerationCancelEvent {
  name: "paper/generation.cancel";
  data: {
    runId: string;
    projectId: string;
  };
}

// Union of all events for type checking
export type InngestEvents = {
  "paper/generation.start": GenerationStartEvent;
  "paper/generation.cancel": GenerationCancelEvent;
};
