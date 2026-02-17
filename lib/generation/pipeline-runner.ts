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
} from "@/lib/generation/run-manager";
import {
  runProfilePhase,
  runDiscoveryPhase,
  runExtractionCheckPhase,
  runExtractionBatchPhase,
  runPreflightContentPhase,
  runAnalysisPhase,
  runBuildContextsPhase,
  runSectionGenerationPhase,
  runQualityCheckPhase,
  runSectionRewritePhase,
  runFinalizePhase,
  getPapersByIds,
  type QualityIssue,
  type SectionResult,
} from "@/lib/generation/pipeline-steps";
import { updateResearchProjectStatus, savePartialContent } from "@/lib/db/research";
import { recordProjectGenerated } from "@/lib/billing/gates";
import type { PipelineConfig } from "@/lib/generation/pipeline";
import type { PaperTypeKey } from "@/lib/prompts/types";
import type { PaperStatus } from "@/types/simplified";
import type { SectionContext } from "@/lib/prompts/types";
import type { HybridThemeExtractionResult } from "@/lib/synthesis-engine/pipeline-integration";

export interface GenerationPipelineInput {
  runId: string;
  projectId: string;
  userId: string;
  config: {
    topic: string;
    paperType: string;
    length: number | string;
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
  baseUrl?: string;
}

export type GenerationStepRunner = <T>(
  stepName: string,
  fn: () => Promise<T>
) => Promise<T>;

export function createProgressCallback(runId: string) {
  return async (
    stage: string,
    progress: number,
    message: string,
    data?: Record<string, unknown>
  ) => {
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
        (data.sectionTitle as string) || message,
        data.sectionIndex as number,
        data.totalSections as number
      );
    }
  };
}

export async function handleGenerationPipelineFailure(
  input: Pick<GenerationPipelineInput, "runId" | "projectId">,
  error: unknown
): Promise<void> {
  const errorMessage =
    error instanceof Error ? error.message : "Generation failed";

  if (input.runId) {
    await emitError(input.runId, errorMessage);
    await clearPipelineState(input.runId);
  }
  if (input.projectId) {
    await updateResearchProjectStatus(input.projectId, "failed" as PaperStatus);
  }
}

export async function runGenerationPipeline(
  input: GenerationPipelineInput,
  runStep: GenerationStepRunner
): Promise<{
  status: "completed";
  success: boolean;
  wordCount: number;
  citationCount: number;
}> {
  const { runId, projectId, userId, config } = input;
  const onProgress = createProgressCallback(runId);

  // =========================================================================
  // Step 1: Initialize (+ normalize findings if present)
  // =========================================================================
  await runStep("init", async () => {
    const run = await getRun(runId);
    if (!run || run.status === "cancelled") {
      throw new Error("Run was cancelled");
    }

    await updateRunStatus(runId, "running", {
      progress: 0,
      current_stage: "initialization",
    });
    await emitProgress(
      runId,
      "initialization",
      0,
      "Starting paper generation..."
    );

    // Normalize original research findings if present
    let normalizedOriginalResearch = config.originalResearch;
    if (
      normalizedOriginalResearch?.has_original_research &&
      normalizedOriginalResearch.key_findings
    ) {
      try {
        const { normalizeFindings } = await import(
          "@/lib/generation/findings-normalizer"
        );
        const normalized = await normalizeFindings(normalizedOriginalResearch);
        normalizedOriginalResearch = {
          has_original_research: true,
          research_question: normalized.research_question,
          key_findings: normalized.normalized_findings,
        };
        console.log(
          `[init] Findings normalized (${normalized.key_findings.length} -> ${normalized.normalized_findings.length} chars)`
        );
      } catch (e) {
        console.warn("[init] Findings normalization failed, using raw:", e);
      }
    }

    // Store config in pipeline state (including original research)
    await updatePipelineState(runId, {
      config: {
        topic: config.topic,
        paperType: config.paperType,
        length: Number(config.length) || 5500,
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
  await runStep("profile", async () => {
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
  await runStep("discover", async () => {
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
  const extractionCheck = await runStep("extract-check", async () => {
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
    await runStep(`extract-batch-${batchIndex}`, async () => {
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
  // Step N: Preflight Content Gate
  // =========================================================================
  await runStep("preflight-content", async () => {
    const run = await getRun(runId);
    if (run?.status === "cancelled") throw new Error("Run was cancelled");

    const state = await getPipelineState(runId);
    if (!state.paperIds) {
      throw new Error("Paper IDs not found for content preflight");
    }

    const papers = await getPapersByIds(state.paperIds);
    const preflight = await runPreflightContentPhase(state.paperIds, papers, onProgress);

    // Narrow downstream analysis/retrieval to papers that are actually chunk-ready.
    if (
      preflight.readyPaperIds.length > 0 &&
      preflight.readyPaperIds.length !== state.paperIds.length
    ) {
      await updatePipelineState(runId, { paperIds: preflight.readyPaperIds });
    }

    return preflight;
  });

  // =========================================================================
  // Step N+1: Analyze Findings & Build Contexts (merged for efficiency)
  // =========================================================================
  const contextsResult = await runStep(
    "analyze-and-build-contexts",
    async (): Promise<{
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
    }
  );

  // =========================================================================
  // Steps N+3 to M: Generate Sections
  // =========================================================================
  const sectionCount = contextsResult.contextCount;

  // Validate context cache before entering section steps.
  // If this is missing, section-0 can spend most of its budget rebuilding contexts
  // and then time out before writing starts.
  await runStep("verify-context-cache", async () => {
    let cachedContexts = await loadContextCache<SectionContext>(runId);

    // Bounded recovery path: rebuild contexts once in this dedicated step.
    // We avoid rebuilding inside per-section steps to keep section runtime predictable.
    if (!cachedContexts || cachedContexts.length < sectionCount) {
      console.warn(
        `[generate-paper] Context cache missing/incomplete (${cachedContexts?.length || 0}/${sectionCount}); attempting one-time rebuild`
      );

      const state = await getPipelineState(runId);
      if (!state.profile || !state.paperIds || state.paperIds.length === 0) {
        throw new Error("Context cache missing and state is incomplete for rebuild");
      }

      const papers = await getPapersByIds(state.paperIds);
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

      const rebuiltContexts = await runBuildContextsPhase(
        state.profile,
        papers,
        null,
        pipelineConfig,
        onProgress
      );

      if (!rebuiltContexts || rebuiltContexts.length === 0) {
        throw new Error("Failed to rebuild section contexts after cache miss");
      }

      await saveContextCache(runId, rebuiltContexts);
      await updatePipelineState(runId, {
        contextSummaries: rebuiltContexts.map((c) => ({
          sectionKey: c.sectionKey,
          title: c.title || c.sectionKey,
          expectedWords: c.expectedWords || 300,
        })),
      });

      cachedContexts = rebuiltContexts;
    }

    if (!cachedContexts || cachedContexts.length === 0) {
      throw new Error("Context cache missing before section generation");
    }
    if (cachedContexts.length < sectionCount) {
      throw new Error(
        `Context cache incomplete before section generation (${cachedContexts.length}/${sectionCount})`
      );
    }
    return { cachedContextCount: cachedContexts.length };
  });

  for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
    await runStep(`section-${sectionIndex}`, async () => {
      const run = await getRun(runId);
      if (run?.status === "cancelled") throw new Error("Run was cancelled");

      const state = await getPipelineState(runId);
      if (!state.profile) {
        throw new Error("State incomplete for section generation");
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

      // Load cached contexts only. Do not rebuild inside section steps; that
      // fallback makes section-0 too expensive and causes cloud timeouts.
      const contexts = await loadContextCache<SectionContext>(runId);
      if (!contexts || contexts.length === 0) {
        throw new Error(`Context cache missing during section-${sectionIndex}`);
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
  // Completion Gate: lightweight truncation repair only
  // =========================================================================
  await runStep("completion-gate", async () => {
    const run = await getRun(runId);
    if (run?.status === "cancelled") throw new Error("Run was cancelled");

    const state = await getPipelineState(runId);
    if (!state.sectionResults || !state.profile) {
      return { checked: 0, truncationIssues: 0, rewritten: 0 };
    }

    const contexts = await loadContextCache<SectionContext>(runId);
    if (!contexts || contexts.length === 0) {
      return { checked: state.sectionResults.length, truncationIssues: 0, rewritten: 0 };
    }

    const issues = await runQualityCheckPhase(state.sectionResults, contexts, onProgress);
    const truncationIssues = issues
      .filter((i: QualityIssue) => i.issue === "truncation")
      // Avoid duplicate rewrites for the same section
      .filter((issue, idx, arr) => arr.findIndex((i) => i.sectionIndex === issue.sectionIndex) === idx);

    if (truncationIssues.length === 0) {
      return { checked: state.sectionResults.length, truncationIssues: 0, rewritten: 0 };
    }

    // Keep this bounded for runtime safety; truncation should be rare.
    const maxRepairs = 2;
    const toRepair = truncationIssues.slice(0, maxRepairs);

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

    let rewritten = 0;
    for (const issue of toRepair) {
      const latestState = await getPipelineState(runId);
      if (!latestState.profile || !latestState.sectionResults) break;

      const context = contexts[issue.sectionIndex];
      if (!context) continue;

      const previousContent = latestState.sectionResults
        .slice(0, issue.sectionIndex)
        .map((s) => s.content)
        .join("\n\n");

      const repaired = await runSectionRewritePhase(
        issue.sectionIndex,
        issue,
        context,
        previousContent,
        latestState.profile,
        pipelineConfig,
        contexts.length,
        onProgress
      );

      await appendSectionResult(runId, issue.sectionIndex, repaired);

      // Persist partial content after each repair for recovery resilience.
      const repairedState = await getPipelineState(runId);
      const allContent = (repairedState.sectionResults || [])
        .map((s) => s.content)
        .join("\n\n");
      await savePartialContent(projectId, allContent, issue.sectionIndex + 1);

      rewritten++;
    }

    return {
      checked: state.sectionResults.length,
      truncationIssues: truncationIssues.length,
      rewritten,
    };
  });

  // =========================================================================
  // Final Step: Finalize
  // =========================================================================
  const finalResult = await runStep("finalize", async () => {
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
