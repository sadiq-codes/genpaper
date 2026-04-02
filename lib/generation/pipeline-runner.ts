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
  findReusableContextCache,
  findReusableProjectProfile,
  type ContextCacheMeta,
} from "@/lib/generation/run-manager";
import { createHash } from "crypto";
import { trackEvent } from "@/lib/tracking/events";
import { sendEmail } from "@/lib/email/service";
import { generationFailedEmail } from "@/lib/email/templates/generation-failed";
import {
  runProfilePhase,
  runDiscoveryPhase,
  runContentReadinessPhase,
  runExtractionCheckPhase,
  runExtractionBatchPhase,
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
import type { PaperProfile } from "@/lib/generation/paper-profile-types";
import type { AnalysisResult } from "@/lib/analysis/cross-document";
import {
  buildOutlineBlueprintFromProfileSections,
  dedupePlannedOutline,
} from "@/lib/generation/outline-planner";
import {
  classifyGenerationFailure,
  getGenerationFailureSubstep,
  wrapGenerationSubstepError,
} from "@/lib/generation/telemetry";

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

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);

  return `{${entries.join(",")}}`;
}

function hashValue(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function buildProfileReuseSignature(config: {
  topic: string;
  paperType: string;
  length: number | string;
  customInstructions?: string;
  originalResearch?: {
    has_original_research: boolean;
    research_question?: string;
    key_findings?: string;
  };
}): string {
  return stableStringify({
    topic: config.topic,
    paperType: config.paperType,
    length: Number(config.length) || 5500,
    customInstructions: config.customInstructions,
    originalResearch: config.originalResearch
      ? {
          has_original_research: !!config.originalResearch.has_original_research,
          research_question: config.originalResearch.research_question,
          key_findings: config.originalResearch.key_findings,
        }
      : null,
  });
}

function summarizeContexts(contexts: SectionContext[]) {
  return contexts.map((context) => ({
    sectionKey: context.sectionKey,
    title: context.title || context.sectionKey,
    expectedWords: context.expectedWords || 300,
  }));
}

function buildContextCacheMeta(
  profile: PaperProfile,
  paperIds: string[],
  analysisResult: AnalysisResult,
  config: PipelineConfig,
  source: ContextCacheMeta["source"],
  sourceRunId?: string | null
): ContextCacheMeta {
  const normalizedPaperIds = Array.from(new Set(paperIds.filter(Boolean))).sort();
  const profileSignature = hashValue({
    topic: profile.topic,
    paperType: profile.paperType,
    hasOriginalResearch: profile.hasOriginalResearch,
    discipline: profile.discipline,
    structure: profile.structure,
    sourceExpectations: profile.sourceExpectations,
    titleContract: profile.titleContract,
    paperSubtype: profile.paperSubtype,
    outline: profile.outline,
  });
  const configSignature = hashValue({
    topic: config.topic,
    paperType: config.paperType,
    length: Number(config.length) || 5500,
    useLibraryOnly: !!config.useLibraryOnly,
    libraryPaperIds: [...(config.libraryPaperIds || [])].sort(),
    temperature: config.temperature ?? null,
    maxTokens: config.maxTokens ?? null,
    sources: [...(config.sources || [])].sort(),
    originalResearch: config.originalResearch || null,
  });
  const sectionKeys = profile.outline?.sections?.map((section) => section.sectionKey)
    || profile.structure.appropriateSections.map((section) => section.key);
  const key = hashValue({
    version: 1,
    findingsHash: analysisResult.findingsHash,
    paperIds: normalizedPaperIds,
    profileSignature,
    configSignature,
  });

  return {
    version: 1,
    key,
    findingsHash: analysisResult.findingsHash,
    paperIds: normalizedPaperIds,
    sectionKeys,
    profileSignature,
    configSignature,
    source,
    sourceRunId: sourceRunId || null,
    createdAt: new Date().toISOString(),
  };
}

function toThemeResult(
  analysisResult: AnalysisResult,
  papersProcessed: number
): HybridThemeExtractionResult {
  return {
    analysisResult,
    extractionStats: {
      papersProcessed,
      papersExtracted: analysisResult.analyzedPapers,
      papersFromCache: analysisResult.analyzedPapers,
      totalFindings: analysisResult.totalFindings,
      extractionTimeMs: 0,
    },
  };
}

export async function handleGenerationPipelineFailure(
  input: Pick<GenerationPipelineInput, "runId" | "projectId"> & { userId?: string },
  error: unknown
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : "Generation failed";
  const run = input.runId ? await getRun(input.runId).catch(() => null) : null;
  const failure = classifyGenerationFailure(errorMessage, run?.current_stage);
  const failureSubstep = getGenerationFailureSubstep(error);

  if (input.runId) {
    await emitError(input.runId, errorMessage);
    await clearPipelineState(input.runId);
  }
  if (input.projectId) {
    await updateResearchProjectStatus(input.projectId, "failed" as PaperStatus);
  }

  if (input.userId) {
    trackEvent(input.userId, "generation_failed", {
      projectId: input.projectId,
      runId: input.runId,
      error: errorMessage,
      failureCategory: failure.category,
      failureReason: failure.reason,
      failureStage: run?.current_stage ?? null,
      failureSubstep,
    }).catch(() => {});

    sendFailureNotification(input.userId, input.projectId, errorMessage).catch(() => {});
  }
}

async function sendFailureNotification(userId: string, projectId: string, errorMessage: string) {
  try {
    const { createServiceClient } = await import("@/lib/supabase/service");
    const supabase = createServiceClient();
    const [{ data: profile }, { data: project }] = await Promise.all([
      supabase.from("profiles").select("email, full_name, marketing_email_opt_out").eq("id", userId).single(),
      supabase.from("research_projects").select("title").eq("id", projectId).single(),
    ]);
    if (!profile?.email || profile.marketing_email_opt_out) return;
    const html = generationFailedEmail({
      name: profile.full_name || profile.email.split("@")[0],
      userId,
      projectTitle: project?.title || "Untitled",
      projectId,
      errorSummary: errorMessage.length > 200 ? errorMessage.slice(0, 200) + "…" : errorMessage,
    });
    await sendEmail({
      to: profile.email,
      subject: "Your paper generation needs another try",
      html,
      userId,
      emailType: "failure_notification",
    });
  } catch (e) {
    console.error("[pipeline-runner] failure notification error:", e);
  }
}

export async function runGenerationPipeline(
  input: GenerationPipelineInput,
  runStep: GenerationStepRunner,
  signal?: AbortSignal
): Promise<{
  status: "completed";
  success: boolean;
  wordCount: number;
  citationCount: number;
}> {
  const { runId, projectId, userId, config } = input;
  const onProgress = createProgressCallback(runId);
  const runTimedStep = async <T>(stepName: string, fn: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now();
    try {
      const result = await runStep(stepName, fn);
      trackEvent(userId, "generation_stage_timing", {
        projectId,
        runId,
        stage: stepName,
        durationMs: Date.now() - startedAt,
        success: true,
      }).catch(() => {});
      return result;
    } catch (error) {
      trackEvent(userId, "generation_stage_timing", {
        projectId,
        runId,
        stage: stepName,
        durationMs: Date.now() - startedAt,
        success: false,
      }).catch(() => {});
      throw wrapGenerationSubstepError(stepName, error);
    }
  };

  // =========================================================================
  // Step 1: Initialize (+ normalize findings if present)
  // =========================================================================
  await runTimedStep("init", async () => {
    const run = await getRun(runId);
    if (!run || run.status === "cancelled" || signal?.aborted) {
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
      "Preparing to write your paper…"
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
  await runTimedStep("profile", async () => {
    const run = await getRun(runId);
    if (run?.status === "cancelled" || signal?.aborted) throw new Error("Run was cancelled");
    const existingState = await getPipelineState(runId);

    if (existingState.profile) {
      onProgress?.("profiling", 9, "Resuming from saved paper structure...");
      return {
        sectionsCount: existingState.profile.outline?.sections.length || 0,
        discipline: existingState.profile.discipline.primary,
        reused: true,
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

    const reusableProfile = await findReusableProjectProfile(projectId, runId);
    const currentProfileSignature = buildProfileReuseSignature({
      topic: pipelineConfig.topic,
      paperType: pipelineConfig.paperType,
      length: pipelineConfig.length,
      customInstructions: pipelineConfig.customInstructions,
      originalResearch: pipelineConfig.originalResearch,
    });

    const profile =
      reusableProfile &&
      buildProfileReuseSignature(reusableProfile.config) === currentProfileSignature
        ? (() => {
            onProgress?.("profiling", 9, "Reusing paper structure from the previous run...");
            console.log(
              `[profile-reuse] Reusing profile from run ${reusableProfile.runId} for project ${projectId}`
            );
            return reusableProfile.profile;
          })()
        : await runProfilePhase(pipelineConfig, onProgress, signal);

    // Store profile in state
    await updatePipelineState(runId, { profile });

    // Persist planned outline in generation_config so autocomplete can suggest headings
    if (profile.outline?.sections?.length) {
      try {
        const plannedOutline = dedupePlannedOutline(
          profile.outline.sections.map((s: { title: string }) => s.title)
        );
        const outlineBlueprint = buildOutlineBlueprintFromProfileSections(
          profile.outline.sections.map(
            (s: { title: string; keyPoints?: string[]; expectedWords?: number }) => ({
              title: s.title,
              keyPoints: s.keyPoints,
              expectedWords: s.expectedWords,
            })
          )
        );

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
              plannedOutline,
              outlineBlueprint,
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
  await runTimedStep("discover", async () => {
    const run = await getRun(runId);
    if (run?.status === "cancelled" || signal?.aborted) throw new Error("Run was cancelled");

    const state = await getPipelineState(runId);
    if (!state.profile) throw new Error("Profile not found in state");

    if (state.paperIds && state.paperIds.length > 0) {
      onProgress?.("search", 18, "Reusing saved source list...");
      return { paperCount: state.paperIds.length, paperIds: state.paperIds, reused: true };
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

    const papers = await runDiscoveryPhase(
      pipelineConfig,
      state.profile,
      projectId,
      userId,
      onProgress,
      signal
    );

    // Store paper IDs in state
    const paperIds = papers.map((p) => p.id);
    await updatePipelineState(runId, { paperIds });

    return { paperCount: papers.length, paperIds };
  });

  // =========================================================================
  // Step 4: Content Readiness Gate (early, before extraction)
  // =========================================================================
  await runTimedStep("content-readiness", async () => {
    const run = await getRun(runId);
    if (run?.status === "cancelled" || signal?.aborted) throw new Error("Run was cancelled");

    const state = await getPipelineState(runId);
    if (!state.paperIds || !state.profile) {
      throw new Error("State incomplete for content readiness");
    }

    if (
      state.themeAnalysis ||
      (state.contextSummaries && state.contextSummaries.length > 0) ||
      state.contextCacheMeta
    ) {
      onProgress?.("planning", 25, "Reusing prepared source readiness...");
      return {
        readyPaperIds: state.paperIds,
        fullTextReadyPaperIds: state.paperIds,
        targetFullTextReady: state.paperIds.length,
        upgradedToFullText: 0,
        rechunked: 0,
        reused: true,
      };
    }

    const papers = await getPapersByIds(state.paperIds);
    const readiness = await runContentReadinessPhase(
      config.topic,
      state.profile,
      papers,
      onProgress,
      signal
    );

    // Narrow downstream pipeline to chunk-ready papers only.
    await updatePipelineState(runId, { paperIds: readiness.readyPaperIds });

    return readiness;
  });

  // =========================================================================
  // Step 5: Check Extraction Cache
  // =========================================================================
  const extractionCheck = await runTimedStep("extract-check", async () => {
    const run = await getRun(runId);
    if (run?.status === "cancelled" || signal?.aborted) throw new Error("Run was cancelled");

    const state = await getPipelineState(runId);
    if (!state.paperIds) throw new Error("Paper IDs not found in state");

    if (
      state.themeAnalysis ||
      (state.contextSummaries && state.contextSummaries.length > 0) ||
      state.contextCacheMeta
    ) {
      onProgress?.("planning", 27, "Reusing extracted findings...");
      return {
        cachedPaperIds: state.paperIds,
        pendingPaperIds: [],
        totalBatches: 0,
        reused: true,
      };
    }

    const papers = await getPapersByIds(state.paperIds);
    const result = await runExtractionCheckPhase(state.paperIds, papers, onProgress, signal);

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
    await runTimedStep(`extract-batch-${batchIndex}`, async () => {
      const run = await getRun(runId);
      if (run?.status === "cancelled" || signal?.aborted) throw new Error("Run was cancelled");

      const state = await getPipelineState(runId);
      if (!state.paperIds || !state.extractionProgress) {
        throw new Error("Extraction state not found");
      }

      const extracted = await runExtractionBatchPhase(
        batchIndex,
        state.extractionProgress.pendingPaperIds,
        onProgress,
        signal
      );

      await markExtractionBatchComplete(runId, batchIndex);

      return { batchIndex, extracted };
    });
  }

  // =========================================================================
  // Step N: Analyze Findings
  // =========================================================================
  const analysisResult = await runTimedStep("analyze-findings", async () => {
    const run = await getRun(runId);
    if (run?.status === "cancelled" || signal?.aborted) throw new Error("Run was cancelled");

    const state = await getPipelineState(runId);
    if (!state.paperIds || !state.profile) {
      throw new Error("State incomplete for analysis");
    }

    if (state.themeAnalysis) {
      onProgress?.("planning", 35, "Reusing saved research patterns...");
      return {
        analysisResult: state.themeAnalysis as AnalysisResult,
        extractionStats: {
          papersProcessed: state.paperIds.length,
          papersExtracted: state.paperIds.length,
          papersFromCache: state.paperIds.length,
          totalFindings: 0,
          extractionTimeMs: 0,
        },
        reused: true,
      };
    }

    const papers = await getPapersByIds(state.paperIds);

    try {
      const result = await runAnalysisPhase(
        projectId,
        state.paperIds,
        papers,
        config.topic,
        state.profile,
        onProgress,
        signal
      );

      await updatePipelineState(runId, { themeAnalysis: result.analysisResult });
      return result;
    } catch (error) {
      throw wrapGenerationSubstepError("analyze-findings", error);
    }
  });

  // =========================================================================
  // Step N+1: Build Contexts
  // =========================================================================
  const contextsResult = await runTimedStep("build-contexts", async (): Promise<{
    contextCount: number;
    sectionKeys: string[];
    patterns: number;
    totalFindings: number;
  }> => {
    const run = await getRun(runId);
    if (run?.status === "cancelled" || signal?.aborted) throw new Error("Run was cancelled");

    const state = await getPipelineState(runId);
    if (!state.paperIds || !state.profile) {
      throw new Error("State incomplete for context building");
    }

    if (state.contextSummaries && state.contextSummaries.length > 0) {
      const cachedContexts = await loadContextCache<SectionContext>(runId);
      if (cachedContexts && cachedContexts.length >= state.contextSummaries.length) {
        onProgress?.("contexts", 41, "Reusing prepared evidence from this run...");
        return {
          contextCount: cachedContexts.length,
          sectionKeys: state.contextSummaries.map((summary) => summary.sectionKey),
          patterns: state.themeAnalysis?.patterns.length || 0,
          totalFindings: 0,
        };
      }
    }

    const papers = await getPapersByIds(state.paperIds);
    const themeResult: HybridThemeExtractionResult = {
      analysisResult: analysisResult.analysisResult,
      extractionStats: analysisResult.extractionStats,
    };

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

    try {
      const cacheMeta = buildContextCacheMeta(
        state.profile,
        state.paperIds,
        analysisResult.analysisResult,
        pipelineConfig,
        "built"
      );
      const reusableCache = await findReusableContextCache<SectionContext>(
        projectId,
        cacheMeta.key,
        runId
      );

      if (reusableCache) {
        onProgress?.("contexts", 41, "Reusing prepared evidence from an earlier run...");
        await saveContextCache(runId, reusableCache.contexts);
        await updatePipelineState(runId, {
          contextSummaries: summarizeContexts(reusableCache.contexts),
          contextCacheMeta: {
            ...cacheMeta,
            source: "reused",
            sourceRunId: reusableCache.runId,
          },
          sectionResults: [],
          completedSectionIndices: [],
        });

        return {
          contextCount: reusableCache.contexts.length,
          sectionKeys: reusableCache.contexts.map((context) => context.sectionKey),
          patterns: analysisResult.analysisResult.patterns.length,
          totalFindings: analysisResult.extractionStats.totalFindings,
        };
      }

      const contexts = await runBuildContextsPhase(
        state.profile,
        papers,
        themeResult,
        pipelineConfig,
        onProgress,
        signal
      );

      await updatePipelineState(runId, {
        contextSummaries: summarizeContexts(contexts),
        contextCacheMeta: cacheMeta,
        sectionResults: [],
        completedSectionIndices: [],
      });

      await saveContextCache(runId, contexts);

      return {
        contextCount: contexts.length,
        sectionKeys: contexts.map((c) => c.sectionKey),
        patterns: analysisResult.analysisResult.patterns.length,
        totalFindings: analysisResult.extractionStats.totalFindings,
      };
    } catch (error) {
      throw wrapGenerationSubstepError("build-contexts", error);
    }
  });

  // =========================================================================
  // Steps N+3 to M: Generate Sections
  // =========================================================================
  const sectionCount = contextsResult.contextCount;

  // Validate context cache before entering section steps.
  // If this is missing, section-0 can spend most of its budget rebuilding contexts
  // and then time out before writing starts.
  await runTimedStep("verify-context-cache", async () => {
    if (signal?.aborted) throw new Error("Run was cancelled");
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

      if (state.themeAnalysis) {
        const cacheMeta = buildContextCacheMeta(
          state.profile,
          state.paperIds,
          state.themeAnalysis as AnalysisResult,
          pipelineConfig,
          "built"
        );
        const reusableCache = await findReusableContextCache<SectionContext>(
          projectId,
          cacheMeta.key,
          runId
        );

        if (reusableCache && reusableCache.contexts.length >= sectionCount) {
          await saveContextCache(runId, reusableCache.contexts);
          await updatePipelineState(runId, {
            contextSummaries: summarizeContexts(reusableCache.contexts),
            contextCacheMeta: {
              ...cacheMeta,
              source: "reused",
              sourceRunId: reusableCache.runId,
            },
          });
          cachedContexts = reusableCache.contexts;
        }
      }

      if (cachedContexts && cachedContexts.length >= sectionCount) {
        return { cachedContextCount: cachedContexts.length };
      }

      const rebuiltContexts = await runBuildContextsPhase(
        state.profile,
        papers,
        state.themeAnalysis
          ? toThemeResult(state.themeAnalysis as AnalysisResult, papers.length)
          : null,
        pipelineConfig,
        onProgress,
        signal
      );

      if (!rebuiltContexts || rebuiltContexts.length === 0) {
        throw new Error("Failed to rebuild section contexts after cache miss");
      }

      await saveContextCache(runId, rebuiltContexts);
      await updatePipelineState(runId, {
        contextSummaries: summarizeContexts(rebuiltContexts),
        contextCacheMeta: state.themeAnalysis
          ? buildContextCacheMeta(
              state.profile,
              state.paperIds,
              state.themeAnalysis as AnalysisResult,
              pipelineConfig,
              "built"
            )
          : state.contextCacheMeta,
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
    await runTimedStep(`section-${sectionIndex}`, async () => {
      const run = await getRun(runId);
      if (run?.status === "cancelled" || signal?.aborted) throw new Error("Run was cancelled");

      const state = await getPipelineState(runId);
      if (!state.profile) {
        throw new Error("State incomplete for section generation");
      }

      // Skip already-completed sections (for resumption after retry)
      const completedIndices = state.completedSectionIndices || [];
      if (completedIndices.includes(sectionIndex)) {
        const existingResult = state.sectionResults?.find(
          (r, idx) => idx === sectionIndex || state.contextSummaries?.[sectionIndex]?.sectionKey === r.sectionKey
        );
        console.log(
          `[generate-paper] Skipping section ${sectionIndex} (already completed: ${existingResult?.sectionKey || 'unknown'})`
        );
        return {
          sectionKey: existingResult?.sectionKey || `section-${sectionIndex}`,
          wordCount: existingResult?.wordCount || 0,
          citationCount: existingResult?.citations?.length || 0,
          skipped: true,
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
        onProgress,
        signal
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
  await runTimedStep("completion-gate", async () => {
    const run = await getRun(runId);
    if (run?.status === "cancelled" || signal?.aborted) throw new Error("Run was cancelled");

    const state = await getPipelineState(runId);
    if (!state.sectionResults || !state.profile) {
      return { checked: 0, truncationIssues: 0, rewritten: 0 };
    }

    const contexts = await loadContextCache<SectionContext>(runId);
    if (!contexts || contexts.length === 0) {
      return { checked: state.sectionResults.length, truncationIssues: 0, rewritten: 0 };
    }

    const issues = await runQualityCheckPhase(state.sectionResults, contexts, onProgress, signal);
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
      if (signal?.aborted) throw new Error("Run was cancelled");
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
        onProgress,
        signal
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
  const finalResult = await runTimedStep("finalize", async () => {
    const run = await getRun(runId);
    if (run?.status === "cancelled" || signal?.aborted) throw new Error("Run was cancelled");

    const state = await getPipelineState(runId);
    if (!state.sectionResults || !state.paperIds) {
      throw new Error("State incomplete for finalization");
    }

    const papers = await getPapersByIds(state.paperIds);

    const result = await runFinalizePhase(
      projectId,
      state.sectionResults,
      papers,
      onProgress,
      signal
    );

    // Record billing
    const recorded = await recordProjectGenerated(projectId, userId);
    if (recorded) {
      console.log(`[Billing] Recorded first generation for project ${projectId}`);
    }

    trackEvent(userId, "generation_completed", {
      projectId,
      runId,
      wordCount: result.content.split(/\s+/).length,
      citationCount: result.citationCount,
    }).catch(() => {});

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
