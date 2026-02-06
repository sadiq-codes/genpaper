import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/services/project-service";
import { getRunningRun, getLatestRun } from "@/lib/generation/run-manager";
import { getServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/generate/status/[projectId]
 * 
 * Check if a project has an active generation run.
 * Used by the frontend to resume watching an existing generation
 * instead of starting a new one on page refresh.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  try {
    // Authenticate user
    const user = await authenticateUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // Check for active (pending/running) generation
    const activeRun = await getRunningRun(projectId);
    
    if (activeRun) {
      // Verify ownership
      if (activeRun.user_id !== user.id) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }

      return NextResponse.json({
        hasActiveRun: true,
        runId: activeRun.id,
        status: activeRun.status,
        progress: activeRun.progress,
        currentStage: activeRun.current_stage,
        currentSection: activeRun.current_section,
      });
    }

    // No active run - check if project is already complete
    const supabase = getServiceClient();
    const { data: project } = await supabase
      .from("research_projects")
      .select("id, status, content, user_id")
      .eq("id", projectId)
      .single();

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Verify ownership
    if (project.user_id !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Check if project is complete with content
    if (project.status === "complete" && project.content) {
      return NextResponse.json({
        hasActiveRun: false,
        status: "completed",
        content: project.content,
      });
    }

    // Check latest run for failed/cancelled status
    const latestRun = await getLatestRun(projectId);
    if (latestRun) {
      if (latestRun.status === "failed") {
        return NextResponse.json({
          hasActiveRun: false,
          status: "failed",
          errorMessage: latestRun.error_message || "Generation failed",
          runId: latestRun.id,
        });
      }
      if (latestRun.status === "cancelled") {
        return NextResponse.json({
          hasActiveRun: false,
          status: "cancelled",
          runId: latestRun.id,
        });
      }
    }

    // No active run, project not complete
    return NextResponse.json({
      hasActiveRun: false,
      status: project.status || "idle",
    });

  } catch (error) {
    console.error("Error checking generation status:", error);
    return NextResponse.json(
      { error: "Failed to check generation status" },
      { status: 500 }
    );
  }
}
