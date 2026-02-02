import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/services/project-service";
import { getRun, getLatestRun } from "@/lib/generation/run-manager";
import { getProjectWithContent } from "@/lib/db/research";
import { warn, error as logError } from "@/lib/utils/logger";

export const runtime = "nodejs";

const isDev = process.env.NODE_ENV !== "production";
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(",") || [];

function getCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin");

  if (isDev && origin?.includes("localhost")) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
    };
  }

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
    };
  }

  return {};
}

export async function OPTIONS(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
      "Access-Control-Max-Age": "86400",
      ...corsHeaders,
    },
  });
}

/**
 * GET /api/generate/[runId]/status
 *
 * Returns the current status of a generation run.
 * If the run is complete, includes the final content.
 * 
 * Special case: If runId is "latest-for-project", reads projectId from query
 * and returns the latest run for that project.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;

  try {
    // Authenticate user
    const user = await authenticateUser();
    if (!user) {
      warn("Authentication failed for status request");
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401, headers: getCorsHeaders(request) }
      );
    }

    let run;

    // Special case: get latest run for a project
    if (runId === "latest-for-project") {
      const url = new URL(request.url);
      const projectId = url.searchParams.get("projectId");
      
      if (!projectId) {
        return NextResponse.json(
          { error: "projectId query parameter required" },
          { status: 400, headers: getCorsHeaders(request) }
        );
      }

      run = await getLatestRun(projectId);
      
      if (!run) {
        return NextResponse.json(
          { 
            runId: null,
            status: "no_runs",
            message: "No generation runs found for this project" 
          },
          { headers: getCorsHeaders(request) }
        );
      }
    } else {
      // Get specific run by ID
      run = await getRun(runId);
    }

    if (!run) {
      return NextResponse.json(
        { error: "Generation run not found" },
        { status: 404, headers: getCorsHeaders(request) }
      );
    }

    // Verify ownership
    if (run.user_id !== user.id) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403, headers: getCorsHeaders(request) }
      );
    }

    // Build response
    const response: Record<string, unknown> = {
      runId: run.id,
      projectId: run.project_id,
      status: run.status,
      progress: run.progress,
      currentStage: run.current_stage,
      currentSection: run.current_section,
      errorMessage: run.error_message,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      createdAt: run.created_at,
    };

    // If completed, include the final content
    if (run.status === "completed") {
      try {
        const projectWithContent = await getProjectWithContent(run.project_id);
        if (projectWithContent?.content) {
          response.content = projectWithContent.content;
        }
      } catch (err) {
        warn({ error: err }, "Failed to fetch completed content");
      }
    }

    return NextResponse.json(response, { headers: getCorsHeaders(request) });
  } catch (err) {
    logError({ error: err }, "Failed to get generation status");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to get status" },
      { status: 500, headers: getCorsHeaders(request) }
    );
  }
}
