import {
  completeGenerationJob,
  markGenerationJobRetryable,
  failGenerationJob,
  cancelGenerationJobForRun,
  heartbeatGenerationJob,
  type GenerationJob,
} from "@/lib/generation/job-queue";
import {
  runGenerationPipeline,
  handleGenerationPipelineFailure,
} from "@/lib/generation/pipeline-runner";
import {
  classifyGenerationFailure,
  getGenerationFailureSubstep,
} from "@/lib/generation/telemetry";
import {
  resetPipelineForRetry,
  getRun,
  updateRunStatus,
} from "@/lib/generation/run-manager";
import { trackEvent } from "@/lib/tracking/events";
import { fog } from "@/lib/ai/foglamp";

export interface WorkerExecutionOptions {
  workerId: string;
  leaseSeconds: number;
  heartbeatIntervalMs: number;
  hardStopOnCancel?: boolean;
}

class WorkerLeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Worker lease lost for job ${jobId}`);
    this.name = "WorkerLeaseLostError";
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function parseTimeMs(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export async function processGenerationJob(
  job: GenerationJob,
  options: WorkerExecutionOptions
): Promise<void> {
  const { workerId, leaseSeconds, heartbeatIntervalMs, hardStopOnCancel = false } = options;
  let leaseLost = false;
  let leaseLostLogged = false;
  let hardStopScheduled = false;
  const cancellationController = new AbortController();

  console.log(
    `[generation-worker] Claimed job ${job.id} (run=${job.run_id}, attempt=${job.attempts}/${job.max_attempts})`
  );

  const claimTimeMs = parseTimeMs(job.started_at) ?? Date.now();
  const createdTimeMs = parseTimeMs(job.created_at);
  const queueLatencyMs =
    createdTimeMs !== null ? Math.max(0, claimTimeMs - createdTimeMs) : null;

  trackEvent(job.user_id, "generation_job_claimed", {
    projectId: job.project_id,
    runId: job.run_id,
    jobId: job.id,
    attempt: job.attempts,
    maxAttempts: job.max_attempts,
    retryCount: Math.max(0, job.attempts - 1),
    queueLatencyMs,
  }).catch(() => {});

  const heartbeat = setInterval(async () => {
    try {
      const ok = await heartbeatGenerationJob(job.id, workerId, leaseSeconds);
      if (!ok) {
        leaseLost = true;
        cancellationController.abort();
        if (!leaseLostLogged) {
          leaseLostLogged = true;
          console.warn(
            `[generation-worker] Heartbeat rejected for job ${job.id}; stopping worker because ownership changed`
          );
        }
      }
    } catch (error) {
      console.error(
        `[generation-worker] Heartbeat failed for job ${job.id}:`,
        getErrorMessage(error)
      );
    }
  }, heartbeatIntervalMs);

  const cancellationWatch = setInterval(async () => {
    try {
      const run = await getRun(job.run_id);
      if (!run || run.status === "cancelled") {
        cancellationController.abort();
        if (hardStopOnCancel && !hardStopScheduled) {
          hardStopScheduled = true;
          console.log(
            `[generation-worker] Hard-stopping worker process for cancelled run ${job.run_id}`
          );
          setTimeout(() => process.exit(0), 0);
        }
      }
    } catch {
      // Ignore cancellation watch lookup failures and retry next tick.
    }
  }, 2000);

  try {
    await fog.run(
      {
        workflowName: "Paper generation",
        workflowRunId: job.run_id,
        customer: { id: job.user_id },
        metadata: { projectId: job.project_id, jobId: job.id },
      },
      () => runGenerationPipeline(job.payload, async (_stepName, fn) => {
        if (leaseLost) {
          throw new WorkerLeaseLostError(job.id);
        }
        return fn();
      }, cancellationController.signal)
    );

    if (leaseLost) {
      throw new WorkerLeaseLostError(job.id);
    }

    await completeGenerationJob(job.id, workerId);
    console.log(`[generation-worker] Completed job ${job.id}`);
  } catch (error) {
    if (error instanceof WorkerLeaseLostError) {
      console.warn(`[generation-worker] Exiting after lease loss for job ${job.id}`);
      return;
    }

    const errorMessage = getErrorMessage(error);
    const run = await getRun(job.run_id).catch(() => null);
    const isCancelled =
      run?.status === "cancelled" ||
      errorMessage.toLowerCase().includes("run was cancelled");
    const failure = classifyGenerationFailure(errorMessage, run?.current_stage);
    const failureSubstep = getGenerationFailureSubstep(error);

    if (isCancelled) {
      await cancelGenerationJobForRun(job.run_id);
      console.log(`[generation-worker] Cancelled job ${job.id}`);
      return;
    }

    if (job.attempts < job.max_attempts) {
      // Preserve completed sections instead of clearing everything
      const { completedSections, totalSections } = await resetPipelineForRetry(job.run_id);
      
      // Calculate progress based on completed sections
      const resumeProgress = totalSections > 0 
        ? Math.round((completedSections / totalSections) * 50) + 50 // 50-100% range for writing phase
        : 0;
      
      await updateRunStatus(job.run_id, "pending", {
        progress: completedSections > 0 ? resumeProgress : 0,
        current_stage: completedSections > 0 ? "resuming" : "queued",
        error_message: errorMessage,
      });
      await markGenerationJobRetryable(job.id, workerId, errorMessage);
      trackEvent(job.user_id, "generation_retry_scheduled", {
        projectId: job.project_id,
        runId: job.run_id,
        jobId: job.id,
        attempt: job.attempts,
        maxAttempts: job.max_attempts,
        retryCount: job.attempts,
        completedSections,
        totalSections,
        failureCategory: failure.category,
        failureReason: failure.reason,
        failureStage: run?.current_stage ?? null,
        failureSubstep,
      }).catch(() => {});
      console.warn(
        `[generation-worker] Requeued job ${job.id} after error (attempt ${job.attempts}/${job.max_attempts}, ${completedSections}/${totalSections} sections preserved): ${errorMessage}`
      );
      return;
    }

    await handleGenerationPipelineFailure(
      { runId: job.run_id, projectId: job.project_id, userId: job.user_id },
      error
    );
    await failGenerationJob(job.id, workerId, errorMessage);
    console.error(`[generation-worker] Failed job ${job.id}: ${errorMessage}`);
  } finally {
    clearInterval(heartbeat);
    clearInterval(cancellationWatch);
  }
}
