import { Inngest } from "inngest";

// Create a single Inngest client for the application
// The client is used to define functions and send events
export const inngest = new Inngest({
  id: "genpaper",
  // In development, Inngest Dev Server runs locally
  // In production, uses INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY from env
  
  // Enable checkpointing for better performance with long-running steps
  // This executes steps eagerly on the server and checkpoints progress to Inngest
  // Dramatically reduces latency and avoids "stream timeout" errors from HTTP timeouts
  // See: https://www.inngest.com/docs/setup/checkpointing
  checkpointing: {
    // Azure Container Apps has no hard timeout limit, but we set a reasonable max
    // to ensure the function eventually returns and checkpoints are sent
    maxRuntime: "10m",
  },
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
      originalResearch?: {
        has_original_research: boolean;
        research_question?: string;
        key_findings?: string;
      };
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
