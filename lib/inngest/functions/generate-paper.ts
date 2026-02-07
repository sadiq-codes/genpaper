/**
 * Inngest Function: Paper Generation
 * 
 * This function runs the paper generation pipeline as a background job,
 * enabling:
 * - Long-running generation (bypasses Vercel's 60s limit)
 * - Cancellation support via Inngest events
 * - Automatic retries on transient failures
 * - Progress tracking via database events
 */

import { inngest } from "../client";
import { generatePaper, type PipelineConfig } from "@/lib/generation/pipeline";
import {
  updateRunStatus,
  emitProgress,
  emitTextChunk,
  emitSectionStart,
  emitSectionComplete,
  emitComplete,
  emitError,
  emitCancelled,
  getRun,
} from "@/lib/generation/run-manager";
import { recordProjectGenerated } from "@/lib/billing/gates";
import type { PaperTypeKey } from "@/lib/prompts/types";

export const generatePaperFunction = inngest.createFunction(
  {
    id: "generate-paper",
    // Cancel this function if we receive a cancel event matching the runId
    cancelOn: [
      {
        event: "paper/generation.cancel",
        match: "data.runId",
      },
    ],
    // Retry configuration
    retries: 1, // Only retry once - generation is expensive
    // Concurrency limit per user to prevent abuse
    concurrency: {
      limit: 1,
      key: "event.data.userId",
    },
  },
  { event: "paper/generation.start" },
  async ({ event, step }) => {
    const { runId, projectId, userId, config, baseUrl } = event.data;

    // Step 1: Mark run as started
    await step.run("mark-started", async () => {
      await updateRunStatus(runId, "running", {
        progress: 0,
        current_stage: "initialization",
      });
      await emitProgress(runId, "initialization", 0, "Starting paper generation...");
    });

    // Step 2: Run the generation pipeline
    // This is the main work - all progress is emitted to the database
    const result = await step.run("generate", async () => {
      // Check if run was cancelled before starting
      const run = await getRun(runId);
      if (!run || run.status === "cancelled") {
        await emitCancelled(runId);
        return { cancelled: true };
      }

      try {
        // Build pipeline config from event data
        const pipelineConfig: PipelineConfig = {
          topic: config.topic,
          paperType: config.paperType as PaperTypeKey,
          length: config.length as "short" | "medium" | "long",
          useLibraryOnly: config.useLibraryOnly,
          libraryPaperIds: config.libraryPaperIds || [],
        };

        // Create progress callback that emits to database
        const onProgress = async (
          stage: string,
          progress: number,
          message: string,
          data?: Record<string, unknown>
        ) => {
          // Handle streaming chunks - only send incremental text, not full content
          if (data?.streaming && data?.streamingChunk) {
            await emitTextChunk(
              runId,
              data.sectionTitle as string,
              data.streamingChunk as string
            );
            return;
          }

          // Handle section start
          if (data?.sectionIndex !== undefined && !data?.sectionComplete) {
            await emitSectionStart(
              runId,
              data.sectionTitle as string || message,
              (data.sectionIndex as number) || 0,
              (data.totalSections as number) || 1
            );
          }

          // Handle section completion
          if (data?.sectionComplete) {
            await emitSectionComplete(
              runId,
              data.sectionTitle as string,
              data.sectionContent as string,
              data.sectionIndex as number,
              data.totalSections as number
            );
          }

          // Always emit progress update (unless streaming with progress=-1)
          if (progress >= 0) {
            await emitProgress(runId, stage, progress, message);
          }
        };

        // Run the pipeline
        const pipelineResult = await generatePaper(
          pipelineConfig,
          projectId,
          userId,
          onProgress,
          baseUrl
        );

        return {
          cancelled: false,
          content: pipelineResult.content,
          metrics: pipelineResult.metrics,
        };
      } catch (error) {
        // Check if this is a cancellation
        const run = await getRun(runId);
        if (run?.status === "cancelled") {
          await emitCancelled(runId);
          return { cancelled: true };
        }

        // Emit error event
        const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
        await emitError(runId, errorMessage);
        throw error; // Re-throw to trigger Inngest retry
      }
    });

    // Step 3: Finalize
    await step.run("finalize", async () => {
      if (result.cancelled) {
        // Already handled in generate step
        return { status: "cancelled" };
      }

      // Record paper generation for billing
      // Uses has_generated flag on project to ensure we only count first generation
      const recorded = await recordProjectGenerated(projectId, userId);
      if (recorded) {
        console.log(`[Billing] Recorded first generation for project ${projectId}`);
      } else {
        console.log(`[Billing] Project ${projectId} was already generated (regeneration)`);
      }

      // Emit completion event
      const content = "content" in result ? result.content : "";
      await emitComplete(runId, content || "");

      return {
        status: "completed",
        content,
        metrics: "metrics" in result ? result.metrics : undefined,
      };
    });

    return result;
  }
);

import { cleanupExpiredGenerationData } from "./cleanup-events";

// Export all functions for the Inngest serve handler
export const functions = [generatePaperFunction, cleanupExpiredGenerationData];
