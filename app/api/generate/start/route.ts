import { NextRequest, NextResponse } from "next/server";
import { authenticateUser, createProject } from "@/lib/services/project-service";
import { getResearchProject, getProjectWithContent } from "@/lib/db/research";
import { inngest } from "@/lib/inngest/client";
import {
  createRun,
  cancelRunningGenerations,
  getRunningRun,
} from "@/lib/generation/run-manager";
import { createServiceClient } from "@/lib/supabase/service";
import { warn, error as logError } from "@/lib/utils/logger";
import { checkCanStartGeneration } from "@/lib/billing/gates";
import type { PaperTypeKey } from "@/lib/prompts/types";

export const runtime = "nodejs";

const isDev = process.env.NODE_ENV !== "production";

// Get allowed origins from environment or default to same-origin only
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(",") || [];

function getCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin");

  // In development, allow localhost origins
  if (isDev && origin?.includes("localhost")) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
    };
  }

  // In production, only allow configured origins
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
    };
  }

  // Same-origin requests (no Origin header) are always allowed
  return {};
}

export async function OPTIONS(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
      "Access-Control-Max-Age": "86400",
      ...corsHeaders,
    },
  });
}

/**
 * POST /api/generate/start
 * 
 * Starts a new paper generation run.
 * - Cancels any existing running generation for the project
 * - Creates a new generation_runs record
 * - Triggers the Inngest function
 * - Returns the runId for the client to connect to events
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const user = await authenticateUser();
    if (!user) {
      warn("Authentication failed for generation start request");
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401, headers: getCorsHeaders(request) }
      );
    }

    // Parse request body
    const body = await request.json();
    const {
      topic,
      paperType = "literatureReview",
      length = 5500,
      useLibraryOnly = false,
      libraryPaperIds = [],
      projectId: existingProjectId,
      temperature = 0.2,
      maxTokens = 16000,
      sources = ["europe_pmc", "pubmed_central", "openalex", "core", "arxiv", "crossref", "semantic_scholar"],
      citationStyle = "apa",
      hasOriginalResearch = false,
      customInstructions,
    } = body;

    if (!topic) {
      return NextResponse.json(
        { error: "Topic is required" },
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    // Check billing limits for new projects (skip for regenerations)
    if (!existingProjectId) {
      const gateCheck = await checkCanStartGeneration(
        user.id,
        paperType as PaperTypeKey,
      );

      if (!gateCheck.allowed) {
        return NextResponse.json(
          { 
            error: gateCheck.reason || "You have reached your generation limit. Please upgrade your plan.",
            code: "LIMIT_EXCEEDED",
            requiredTier: gateCheck.requiredTier,
          },
          { status: 403, headers: getCorsHeaders(request) }
        );
      }
    }

    // Determine project ID (use existing or create new)
    let projectId: string;
    let finalPaperType = paperType;
    let finalUseLibraryOnly = useLibraryOnly;
    let finalLibraryPaperIds = libraryPaperIds;
    let finalCustomInstructions = customInstructions;
    let finalOriginalResearch: { has_original_research: boolean; research_question?: string; key_findings?: string } | undefined;

    if (existingProjectId) {
      // Verify ownership of existing project
      const existing = await getResearchProject(existingProjectId, user.id);
      if (!existing) {
        return NextResponse.json(
          { error: "Project not found or access denied" },
          { status: 404, headers: getCorsHeaders(request) }
        );
      }

      // Return early if project is already complete with content
      if (existing.status === "complete") {
        const existingWithContent = await getProjectWithContent(existing.id);
        if (existingWithContent?.content) {
          return NextResponse.json(
            {
              projectId: existing.id,
              runId: null,
              status: "already_complete",
              content: existingWithContent.content,
            },
            { headers: getCorsHeaders(request) }
          );
        }
      }

      projectId = existing.id;

      // Load config from database (source of truth)
      const supabase = createServiceClient();
      const { data: projectConfig } = await supabase
        .from("research_projects")
        .select("generation_config, paper_type")
        .eq("id", existingProjectId)
        .eq("user_id", user.id)
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
              research_question: typeof or.research_question === "string" ? or.research_question : undefined,
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
        length: typeof length === 'number' ? length : 5500,
        paperType: paperType as "researchArticle" | "literatureReview" | "capstoneProject" | "mastersThesis" | "phdDissertation",
        useLibraryOnly,
        localRegion: undefined,
      };
      const project = await createProject(user.id, topic, config);
      projectId = project.id;
    }

    // Check if there's already a running generation
    const existingRun = await getRunningRun(projectId);
    if (existingRun) {
      // Cancel the existing run
      const cancelled = await cancelRunningGenerations(projectId);
      if (cancelled.length > 0) {
        console.log(`Cancelled ${cancelled.length} existing generation(s) for project ${projectId}`);
        
        // Also send cancel event to Inngest to stop the background job
        for (const run of cancelled) {
          await inngest.send({
            name: "paper/generation.cancel",
            data: {
              runId: run.id,
              projectId,
            },
          });
        }
      }
    }

    // Create new generation run
    const run = await createRun(projectId, user.id);

    // Get base URL for the pipeline
    const url = new URL(request.url);
    const baseUrl = url.origin;

    // Trigger Inngest function
    // Note: isNewProject is deprecated - billing now uses has_generated flag on project
    await inngest.send({
      name: "paper/generation.start",
      data: {
        runId: run.id,
        projectId,
        userId: user.id,
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
      },
    });

    if (isDev) {
      console.log("Started generation run:", {
        runId: run.id,
        projectId,
        paperType: finalPaperType,
        useLibraryOnly: finalUseLibraryOnly,
        libraryPaperIds: finalLibraryPaperIds.length,
      });
    }

    return NextResponse.json(
      {
        runId: run.id,
        projectId,
        status: "started",
      },
      { headers: getCorsHeaders(request) }
    );
  } catch (err) {
    logError({ error: err }, "Failed to start generation");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start generation" },
      { status: 500, headers: getCorsHeaders(request) }
    );
  }
}
