import "server-only";

import { createProject } from "@/lib/services/project-service";
import { getResearchProject, getProjectWithContent } from "@/lib/db/research";
import {
  createRun,
  cancelRunningGenerations,
  getRunningRun,
  emitError,
  emitEvent,
} from "@/lib/generation/run-manager";
import {
  cancelGenerationJobsForRunIds,
  enqueueGenerationJob,
} from "@/lib/generation/job-queue";
import { launchOneShotWorker } from "@/lib/generation/worker-launcher";
import { createServiceClient } from "@/lib/supabase/service";
import { checkCanStartGeneration } from "@/lib/billing/gates";
import type { PaperTypeKey } from "@/lib/prompts/types";

const DEFAULT_SOURCES = [
  "europe_pmc",
  "pubmed_central",
  "openalex",
  "core",
  "arxiv",
  "crossref",
  "semantic_scholar",
];

export interface StartGenerationParams {
  userId: string;
  topic: string;
  paperType?: string;
  length?: number;
  useLibraryOnly?: boolean;
  libraryPaperIds?: string[];
  existingProjectId?: string;
  temperature?: number;
  maxTokens?: number;
  sources?: string[];
  citationStyle?: string;
  hasOriginalResearch?: boolean;
  customInstructions?: string;
  baseUrl?: string;
}

type StartGenerationSuccess =
  | {
      success: true;
      status: "already_complete";
      projectId: string;
      runId: null;
      content: string;
    }
  | {
      success: true;
      status: "started";
      projectId: string;
      runId: string;
    };

type StartGenerationFailure = {
  success: false;
  statusCode: number;
  error: string;
  code?: string;
  requiredTier?: string | null;
};

export type StartGenerationResult = StartGenerationSuccess | StartGenerationFailure;

export async function startGenerationRun(
  params: StartGenerationParams
): Promise<StartGenerationResult> {
  const {
    userId,
    topic,
    paperType = "literatureReview",
    length = 5500,
    useLibraryOnly = false,
    libraryPaperIds = [],
    existingProjectId,
    temperature = 0.2,
    maxTokens = 16000,
    sources = DEFAULT_SOURCES,
    citationStyle = "apa",
    hasOriginalResearch = false,
    customInstructions,
    baseUrl = "",
  } = params;

  if (!topic) {
    return { success: false, statusCode: 400, error: "Topic is required" };
  }

  // Determine project ID (use existing or create new)
  let projectId: string;
  let finalPaperType = paperType;
  let finalUseLibraryOnly = useLibraryOnly;
  let finalLibraryPaperIds = libraryPaperIds;
  let finalCustomInstructions = customInstructions;
  let finalOriginalResearch:
    | {
        has_original_research: boolean;
        research_question?: string;
        key_findings?: string;
      }
    | undefined;
  let existingProject: Awaited<ReturnType<typeof getResearchProject>> | null = null;

  if (existingProjectId) {
    // Verify ownership of existing project
    existingProject = await getResearchProject(existingProjectId, userId);
    if (!existingProject) {
      return {
        success: false,
        statusCode: 404,
        error: "Project not found or access denied",
      };
    }

    // Return early if project is already complete with content
    if (existingProject.status === "complete") {
      const existingWithContent = await getProjectWithContent(existingProject.id);
      if (existingWithContent?.content) {
        return {
          success: true,
          status: "already_complete",
          projectId: existingProject.id,
          runId: null,
          content: existingWithContent.content,
        };
      }
    }

    projectId = existingProject.id;

    // Load config from database (source of truth)
    const supabase = createServiceClient();
    const { data: projectConfig } = await supabase
      .from("research_projects")
      .select("generation_config, paper_type")
      .eq("id", existingProjectId)
      .eq("user_id", userId)
      .single();

    if (projectConfig?.generation_config) {
      const config = projectConfig.generation_config as Record<string, unknown>;

      if (typeof config.useLibraryOnly === "boolean") {
        finalUseLibraryOnly = config.useLibraryOnly;
      }

      const uploadedPaperIds = (config.uploaded_paper_ids as string[]) || [];
      const libraryPapersUsed = (config.library_papers_used as string[]) || [];
      finalLibraryPaperIds = [...new Set([...uploadedPaperIds, ...libraryPapersUsed])];

      if (projectConfig.paper_type) {
        finalPaperType = projectConfig.paper_type;
      }

      // Load custom instructions from generation config (set by topic parser)
      if (typeof config.custom_instructions === "string" && config.custom_instructions) {
        finalCustomInstructions = config.custom_instructions;
      }

      // Load original research config from DB (critical for findings-driven generation)
      if (config.original_research && typeof config.original_research === "object") {
        const or = config.original_research as Record<string, unknown>;
        if (or.has_original_research) {
          finalOriginalResearch = {
            has_original_research: true,
            research_question:
              typeof or.research_question === "string" ? or.research_question : undefined,
            key_findings: typeof or.key_findings === "string" ? or.key_findings : undefined,
          };
        }
      }
    }
  } else {
    // Create new project
    const config = {
      temperature,
      max_tokens: maxTokens,
      sources,
      limit: 25,
      library_papers_used: libraryPaperIds,
      length: typeof length === "number" ? length : 5500,
      paperType: paperType as
        | "researchArticle"
        | "literatureReview"
        | "capstoneProject"
        | "mastersThesis"
        | "phdDissertation",
      useLibraryOnly,
      localRegion: undefined,
    };
    const project = await createProject(userId, topic, config);
    projectId = project.id;
  }

  // Billing gate:
  // - Enforce on first-time generations (new project OR existing not yet generated)
  // - Skip only true regenerations of already-generated projects
  const wasAlreadyGenerated = Boolean(
    existingProject &&
      (existingProject.status === "complete" || existingProject.has_generated === true)
  );
  if (!wasAlreadyGenerated) {
    const gateCheck = await checkCanStartGeneration(userId, finalPaperType as PaperTypeKey);
    if (!gateCheck.allowed) {
      return {
        success: false,
        statusCode: 403,
        error:
          gateCheck.reason || "You have reached your generation limit. Please upgrade your plan.",
        code: "LIMIT_EXCEEDED",
        requiredTier: gateCheck.requiredTier,
      };
    }
  }

  // Check if there's already a running generation
  const existingRun = await getRunningRun(projectId);
  if (existingRun) {
    // Cancel the existing run
    const cancelled = await cancelRunningGenerations(projectId);
    if (cancelled.length > 0) {
      await cancelGenerationJobsForRunIds(cancelled.map((run) => run.id));
    }
  }

  // Create new generation run
  const run = await createRun(projectId, userId);

  // Emit an immediate queued progress event so UI has visible activity as soon
  // as it connects to the run event stream.
  await emitEvent(run.id, "progress", {
    stage: "start",
    progress: 0,
    message: "Preparing to write your paper…",
  });

  const payload = {
    runId: run.id,
    projectId,
    userId,
    config: {
      topic,
      paperType: finalPaperType,
      length,
      citationStyle,
      temperature,
      maxTokens,
      sources,
      hasOriginalResearch: finalOriginalResearch?.has_original_research || hasOriginalResearch,
      originalResearch: finalOriginalResearch,
      customInstructions: finalCustomInstructions,
      useLibraryOnly: finalUseLibraryOnly,
      libraryPaperIds: finalLibraryPaperIds,
    },
    baseUrl,
  };

  await enqueueGenerationJob(payload);
  try {
    await launchOneShotWorker(run.id);
  } catch (launchError) {
    await cancelGenerationJobsForRunIds([run.id]);
    await emitError(
      run.id,
      launchError instanceof Error
        ? `Failed to launch generation worker: ${launchError.message}`
        : "Failed to launch generation worker"
    );

    return {
      success: false,
      statusCode: 500,
      error:
        launchError instanceof Error
          ? launchError.message
          : "Failed to launch generation worker",
    };
  }

  return {
    success: true,
    status: "started",
    projectId,
    runId: run.id,
  };
}
