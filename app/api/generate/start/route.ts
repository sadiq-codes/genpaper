import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/services/project-service";
import { warn, error as logError } from "@/lib/utils/logger";
import { startGenerationRun } from "@/lib/generation/start-generation";

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
 * - Enqueues a worker queue job and launches a one-shot worker
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

    const url = new URL(request.url);
    const result = await startGenerationRun({
      userId: user.id,
      topic: body.topic,
      paperType: body.paperType,
      length: body.length,
      useLibraryOnly: body.useLibraryOnly,
      libraryPaperIds: body.libraryPaperIds,
      existingProjectId: body.projectId,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
      sources: body.sources,
      citationStyle: body.citationStyle,
      hasOriginalResearch: body.hasOriginalResearch,
      customInstructions: body.customInstructions,
      baseUrl: url.origin,
    });

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error,
          ...(result.code ? { code: result.code } : {}),
          ...(result.requiredTier ? { requiredTier: result.requiredTier } : {}),
        },
        { status: result.statusCode, headers: getCorsHeaders(request) }
      );
    }

    if (result.status === "already_complete") {
      return NextResponse.json(
        {
          projectId: result.projectId,
          runId: null,
          status: "already_complete",
          content: result.content,
        },
        { headers: getCorsHeaders(request) }
      );
    }

    if (isDev) {
      console.log("Started generation run:", {
        runId: result.runId,
        projectId: result.projectId,
      });
    }

    return NextResponse.json(
      {
        runId: result.runId,
        projectId: result.projectId,
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
