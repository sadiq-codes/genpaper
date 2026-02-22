import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/services/project-service";
import { getRun, emitCancelled } from "@/lib/generation/run-manager";
import { cancelGenerationJobForRun } from "@/lib/generation/job-queue";
import { deleteResearchProject } from "@/lib/db/research";
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
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
      "Access-Control-Max-Age": "86400",
      ...corsHeaders,
    },
  });
}

/**
 * POST /api/generate/[runId]/cancel
 *
 * Cancels a running generation.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;

  try {
    // Authenticate user
    const user = await authenticateUser();
    if (!user) {
      warn("Authentication failed for cancel request");
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401, headers: getCorsHeaders(request) }
      );
    }

    // Get the run
    const run = await getRun(runId);
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

    // Completed runs are not cancelable (use explicit delete action instead).
    if (run.status === "completed") {
      return NextResponse.json(
        { 
          runId,
          status: run.status,
          message: `Run is already ${run.status}` 
        },
        { headers: getCorsHeaders(request) }
      );
    }

    // Cancel the run if it is still active.
    if (run.status !== "cancelled" && run.status !== "failed") {
      await emitCancelled(runId);
    }
    await cancelGenerationJobForRun(runId);
    await deleteResearchProject(run.project_id);

    if (isDev) {
      console.log("Cancelled generation run:", runId);
    }

    return NextResponse.json(
      {
        runId,
        status: "cancelled",
        projectDeleted: true,
        message: "Generation cancelled and project deleted",
      },
      { headers: getCorsHeaders(request) }
    );
  } catch (err) {
    logError({ error: err }, "Failed to cancel generation");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to cancel generation" },
      { status: 500, headers: getCorsHeaders(request) }
    );
  }
}
