/**
 * Inngest Function: Paper Generation (Multi-Step Architecture)
 * 
 * This function runs the paper generation pipeline as a series of steps,
 * where each step is a separate Vercel function invocation. This allows
 * the pipeline to work within Vercel's 60-second timeout on Hobby plan.
 * 
 * Key features:
 * - Each step completes within 60 seconds
 * - State is persisted to database between steps
 * - Steps are idempotent and can be retried
 * - Cancellation support via Inngest events
 * - Progress tracking via database events
 */

import { inngest } from "../client";
import {
  updateRunStatus,
  emitProgress,
  emitSectionStart,
  emitSectionComplete,
  emitComplete,
  emitError,
  getRun,
  getPipelineState,
  updatePipelineState,
  appendSectionResult,
  markExtractionBatchComplete,
  clearPipelineState,
  saveContextCache,
  loadContextCache,
  type PipelineState,
} from "@/lib/generation/run-manager";
import {
  runProfilePhase,
  runDiscoveryPhase,
  runExtractionCheckPhase,
  runExtractionBatchPhase,
  runAnalysisPhase,
  runBuildContextsPhase,
  runSectionGenerationPhase,
  runFinalizePhase,
  getPapersByIds,
  type SectionResult,
} from "@/lib/generation/pipeline-steps";
import { updateResearchProjectStatus, savePartialContent } from "@/lib/db/research";
import { recordProjectGenerated } from "@/lib/billing/gates";
import type { PipelineConfig } from "@/lib/generation/pipeline";
import type { PaperTypeKey } from "@/lib/prompts/types";
import type { PaperStatus } from "@/types/simplified";
import type { SectionContext } from "@/lib/prompts/types";
import type { HybridThemeExtractionResult } from "@/lib/synthesis-engine/pipeline-integration";

// =============================================================================
// Helper: Create progress callback for steps
// =============================================================================

function createProgressCallback(runId: string) {
  return async (stage: string, progress: number, message: string, data?: Record<string, unknown>) => {
    // Only emit if progress is valid (not streaming sentinel -1)
    if (progress >= 0) {
      await emitProgress(runId, stage, progress, message);
    }
    
    // Handle section events
    if (data?.sectionComplete) {
      await emitSectionComplete(
        runId,
        data.sectionTitle as string,
        data.sectionContent as string,
        data.sectionIndex as number,
        data.totalSections as number
      );
    } else if (data?.sectionIndex !== undefined && !data?.sectionComplete) {
      await emitSectionStart(
        runId,
        data.sectionTitle as string || message,
        data.sectionIndex as number,
        data.totalSections as number
      );
    }
  };
}

// =============================================================================
// Main Function
// =============================================================================

export const generatePaperFunction = inngest.createFunction(
  {
    id: "generate-paper",
    cancelOn: [
      {
        event: "paper/generation.cancel",
        match: "data.runId",
      },
    ],
    retries: 1,
    concurrency: {
      limit: 1,
      key: "event.data.userId",
    },
    // Allow up to 30 minutes for the entire paper generation process
    // Individual steps can take several minutes (LLM generation for long sections)
    timeouts: {
      finish: "30m",
    },
    // Handle function failures - emit error to UI
    onFailure: async ({ event, error }) => {
      // Inngest's onFailure event shape can vary by SDK/runtime.
      // We defensively read from the most common locations.
      const data =
        (event as any)?.data?.event?.data ??
        (event as any)?.data ??
        (event as any)?.event?.data ??
        (event as any)?.event ??
        {};

      const runId: string | undefined = data.runId;
      const projectId: string | undefined = data.projectId;
      const errorMessage = error instanceof Error ? error.message : "Generation failed";
      
      try {
        // Import dynamically to avoid circular deps
        const { emitError, clearPipelineState } = await import("@/lib/generation/run-manager");
        const { updateResearchProjectStatus } = await import("@/lib/db/research");
        
        if (runId) {
          await emitError(runId, errorMessage);
          await clearPipelineState(runId);
        }
        if (projectId) {
          await updateResearchProjectStatus(projectId, "failed" as any);
        }
        console.error(`[generate-paper] Failed for run ${runId || "unknown"}:`, errorMessage);
      } catch (e) {
        console.error(`[generate-paper] Failed to emit error on failure:`, e);
      }
    },
  },
  { event: "paper/generation.start" },
  async ({ event, step }) => {
    const { runId, projectId, userId, config, baseUrl } = event.data;
    const onProgress = createProgressCallback(runId);

    // =========================================================================
    // Step 1: Initialize (+ normalize findings if present)
    // =========================================================================
    await step.run("init", async () => {
      const run = await getRun(runId);
      if (!run || run.status === "cancelled") {
        throw new Error("Run was cancelled");
      }

      await updateRunStatus(runId, "running", {
        progress: 0,
        current_stage: "initialization",
      });
      await emitProgress(runId, "initialization", 0, "Starting paper generation...");

      // Normalize original research findings if present
      let normalizedOriginalResearch = config.originalResearch;
      if (normalizedOriginalResearch?.has_original_research && normalizedOriginalResearch.key_findings) {
        try {
          const { normalizeFindings } = await import("@/lib/generation/findings-normalizer");
          const normalized = await normalizeFindings(normalizedOriginalResearch);
          normalizedOriginalResearch = {
            has_original_research: true,
            research_question: normalized.research_question,
            key_findings: normalized.normalized_findings,
          };
          console.log(`[init] Findings normalized (${normalized.key_findings.length} → ${normalized.normalized_findings.length} chars)`);
        } catch (e) {
          console.warn("[init] Findings normalization failed, using raw:", e);
        }
      }

      // Store config in pipeline state (including original research)
      await updatePipelineState(runId, {
        config: {
          topic: config.topic,
          paperType: config.paperType,
          length: config.length,
          customInstructions: config.customInstructions,
          useLibraryOnly: config.useLibraryOnly,
          libraryPaperIds: config.libraryPaperIds || [],
          originalResearch: normalizedOriginalResearch,
        },
      });
      
      // Set project status to generating
      await updateResearchProjectStatus(projectId, "generating" as PaperStatus);
    });

    // =========================================================================
    // Step 2: Generate Profile
    // =========================================================================
    const profileResult = await step.run("profile", async () => {
      const run = await getRun(runId);
      if (run?.status === "cancelled") throw new Error("Run was cancelled");

      const pipelineConfig: PipelineConfig = {
        topic: config.topic,
        paperType: config.paperType as PaperTypeKey,
        length: Number(config.length) || 5500,
        customInstructions: config.customInstructions,
        useLibraryOnly: config.useLibraryOnly,
        libraryPaperIds: config.libraryPaperIds || [],
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        sources: config.sources,
        originalResearch: config.originalResearch,
      };

      const profile = await runProfilePhase(pipelineConfig, onProgress);
      
      // Store profile in state
      await updatePipelineState(runId, { profile });
      
      // Persist planned outline in generation_config so autocomplete can suggest headings
      if (profile.outline?.sections?.length) {
        try {
          const { createServiceClient } = await import("@/lib/supabase/service");
          const svc = createServiceClient();
          const { data: proj } = await svc
            .from("research_projects")
            .select("generation_config")
            .eq("id", projectId)
            .single();
          const existing = (proj?.generation_config as Record<string, unknown>) || {};
          await svc
            .from("research_projects")
            .update({
              generation_config: {
                ...existing,
                plannedOutline: profile.outline.sections.map((s: { title: string }) => s.title),
              },
            })
            .eq("id", projectId);
        } catch (e) {
          console.warn("[generate-paper] Failed to persist planned outline:", e);
        }
      }
      
      return {
        sectionsCount: profile.outline?.sections.length || 0,
        discipline: profile.discipline.primary,
      };
    });

    // =========================================================================
    // Step 3: Discover Papers
    // =========================================================================
    const discoveryResult = await step.run("discover", async () => {
      const run = await getRun(runId);
      if (run?.status === "cancelled") throw new Error("Run was cancelled");

      const state = await getPipelineState(runId);
      if (!state.profile) throw new Error("Profile not found in state");

      const pipelineConfig: PipelineConfig = {
        topic: config.topic,
        paperType: config.paperType as PaperTypeKey,
        length: Number(config.length) || 5500,
        customInstructions: config.customInstructions,
        useLibraryOnly: config.useLibraryOnly,
        libraryPaperIds: config.libraryPaperIds || [],
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        sources: config.sources,
        originalResearch: config.originalResearch,
      };

      const papers = await runDiscoveryPhase(
        pipelineConfig,
        state.profile,
        projectId,
        userId,
        onProgress
      );

      // Store paper IDs in state
      const paperIds = papers.map((p) => p.id);
      await updatePipelineState(runId, { paperIds });

      return { paperCount: papers.length, paperIds };
    });

    // =========================================================================
    // Step 4: Check Extraction Cache
    // =========================================================================
    const extractionCheck = await step.run("extract-check", async () => {
      const run = await getRun(runId);
      if (run?.status === "cancelled") throw new Error("Run was cancelled");

      const state = await getPipelineState(runId);
      if (!state.paperIds) throw new Error("Paper IDs not found in state");

      const papers = await getPapersByIds(state.paperIds);
      const result = await runExtractionCheckPhase(state.paperIds, papers, onProgress);

      // Store extraction progress
      await updatePipelineState(runId, {
        extractionProgress: {
          cachedPaperIds: result.cachedPaperIds,
          pendingPaperIds: result.pendingPaperIds,
          extractedBatches: 0,
          totalBatches: result.totalBatches,
        },
      });

      return result;
    });

    // =========================================================================
    // Steps 5-N: Extract Papers in Batches
    // =========================================================================
    const totalBatches = extractionCheck.totalBatches;
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      await step.run(`extract-batch-${batchIndex}`, async () => {
        const run = await getRun(runId);
        if (run?.status === "cancelled") throw new Error("Run was cancelled");

        const state = await getPipelineState(runId);
        if (!state.paperIds || !state.extractionProgress) {
          throw new Error("Extraction state not found");
        }

        const papers = await getPapersByIds(state.paperIds);
        const extracted = await runExtractionBatchPhase(
          batchIndex,
          state.extractionProgress.pendingPaperIds,
          papers,
          onProgress
        );

        await markExtractionBatchComplete(runId, batchIndex);
        
        return { batchIndex, extracted };
      });
    }

    // =========================================================================
    // Step N+1: Analyze Findings & Build Contexts (merged for efficiency)
    // =========================================================================
    const contextsResult = await step.run("analyze-and-build-contexts", async (): Promise<{
      contextCount: number;
      sectionKeys: string[];
      patterns: number;
      totalFindings: number;
    }> => {
      const run = await getRun(runId);
      if (run?.status === "cancelled") throw new Error("Run was cancelled");

      const state = await getPipelineState(runId);
      if (!state.paperIds || !state.profile) {
        throw new Error("State incomplete for analysis");
      }

      const papers = await getPapersByIds(state.paperIds);
      
      // Run analysis phase
      const analysisResult = await runAnalysisPhase(
        projectId,
        state.paperIds,
        papers,
        config.topic,
        state.profile,
        onProgress
      );

      // Store analysis result
      await updatePipelineState(runId, { themeAnalysis: analysisResult.analysisResult });

      // Build theme result for context building
      const themeResult: HybridThemeExtractionResult = {
        analysisResult: analysisResult.analysisResult,
        extractionStats: analysisResult.extractionStats,
      };

      const pipelineConfig: PipelineConfig = {
        topic: config.topic,
        paperType: config.paperType as PaperTypeKey,
        length: Number(config.length) || 5500,
        useLibraryOnly: config.useLibraryOnly,
        libraryPaperIds: config.libraryPaperIds || [],
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        sources: config.sources,
        originalResearch: config.originalResearch,
      };

      // Build contexts
      const contexts = await runBuildContextsPhase(
        state.profile,
        papers,
        themeResult,
        pipelineConfig,
        onProgress
      );

      // Store context summaries in pipeline state
      await updatePipelineState(runId, {
        contextSummaries: contexts.map((c) => ({
          sectionKey: c.sectionKey,
          title: c.title || c.sectionKey,
          expectedWords: c.expectedWords || 300,
        })),
        sectionResults: [],
        completedSectionIndices: [],
      });

      // Cache full contexts so subsequent steps don't rebuild them
      await saveContextCache(runId, contexts);

      return {
        contextCount: contexts.length,
        sectionKeys: contexts.map((c) => c.sectionKey),
        patterns: analysisResult.analysisResult.patterns.length,
        totalFindings: analysisResult.extractionStats.totalFindings,
      };
    });

    // =========================================================================
    // Steps N+3 to M: Generate Sections
    // =========================================================================
    const sectionCount = contextsResult.contextCount;
    
    for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
      await step.run(`section-${sectionIndex}`, async () => {
        const run = await getRun(runId);
        if (run?.status === "cancelled") throw new Error("Run was cancelled");

        const state = await getPipelineState(runId);
        if (!state.paperIds || !state.profile) {
          throw new Error("State incomplete for section generation");
        }

        const papers = await getPapersByIds(state.paperIds);
        
        // Rebuild theme result
        let themeResult: HybridThemeExtractionResult | null = null;
        if (state.themeAnalysis) {
          themeResult = {
            analysisResult: state.themeAnalysis,
            extractionStats: {
              papersProcessed: papers.length,
              papersExtracted: 0,
              papersFromCache: 0,
              totalFindings: contextsResult.totalFindings,
              extractionTimeMs: 0,
            },
          };
        }

        const pipelineConfig: PipelineConfig = {
          topic: config.topic,
          paperType: config.paperType as PaperTypeKey,
          length: Number(config.length) || 5500,
          customInstructions: config.customInstructions,
          useLibraryOnly: config.useLibraryOnly,
          libraryPaperIds: config.libraryPaperIds || [],
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          sources: config.sources,
          originalResearch: config.originalResearch,
        };

        // Load cached contexts (fall back to rebuild if cache miss)
        let contexts = await loadContextCache<SectionContext>(runId);
        if (!contexts) {
          console.log(`[section-${sectionIndex}] Context cache miss, rebuilding...`);
          contexts = await runBuildContextsPhase(
            state.profile,
            papers,
            themeResult,
            pipelineConfig
          );
          await saveContextCache(runId, contexts);
        }

        const context = contexts[sectionIndex];
        if (!context) {
          throw new Error(`Context not found for section ${sectionIndex}`);
        }

        // Get previous section results for coherence
        const previousSections: SectionResult[] = state.sectionResults || [];

        const result = await runSectionGenerationPhase(
          sectionIndex,
          context,
          previousSections,
          state.profile,
          pipelineConfig,
          sectionCount,
          onProgress
        );

        // Store result and save partial content
        await appendSectionResult(runId, sectionIndex, result);
        
        // Save partial content for recovery
        const updatedState = await getPipelineState(runId);
        const allContent = (updatedState.sectionResults || [])
          .map((s) => s.content)
          .join("\n\n");
        await savePartialContent(projectId, allContent, sectionIndex + 1);

        return {
          sectionKey: result.sectionKey,
          wordCount: result.wordCount,
          citationCount: result.citations.length,
        };
      });
    }

    // =========================================================================
    // Final Step: Finalize
    // 
    // NOTE: Quality check, rewrite, and enforce-min-total-words steps have been
    // removed to simplify the pipeline and avoid timeout issues. Users can edit
    // the generated content in the editor if adjustments are needed.
    // =========================================================================
    const finalResult = await step.run("finalize", async () => {
      const run = await getRun(runId);
      if (run?.status === "cancelled") throw new Error("Run was cancelled");

      const state = await getPipelineState(runId);
      if (!state.sectionResults || !state.paperIds) {
        throw new Error("State incomplete for finalization");
      }

      const papers = await getPapersByIds(state.paperIds);

      const result = await runFinalizePhase(
        projectId,
        state.sectionResults,
        papers,
        onProgress
      );

      // Record billing
      const recorded = await recordProjectGenerated(projectId, userId);
      if (recorded) {
        console.log(`[Billing] Recorded first generation for project ${projectId}`);
      }

      // Emit completion
      await emitComplete(runId, result.content);

      // Clear pipeline state
      await clearPipelineState(runId);

      return {
        success: true,
        wordCount: result.content.split(/\s+/).length,
        citationCount: result.citationCount,
      };
    });

    return {
      status: "completed",
      ...finalResult,
    };
  }
);

// =============================================================================
// Cleanup Function (unchanged)
// =============================================================================

import { cleanupExpiredGenerationData } from "./cleanup-events";

// Export all functions for the Inngest serve handler
export const functions = [generatePaperFunction, cleanupExpiredGenerationData];
