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
  clearPipelineState,
  getRun,
  updateRunStatus,
} from "@/lib/generation/run-manager";

export interface WorkerExecutionOptions {
  workerId: string;
  leaseSeconds: number;
  heartbeatIntervalMs: number;
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

export async function processGenerationJob(
  job: GenerationJob,
  options: WorkerExecutionOptions
): Promise<void> {
  const { workerId, leaseSeconds, heartbeatIntervalMs } = options;
  let leaseLost = false;
  let leaseLostLogged = false;

  console.log(
    `[generation-worker] Claimed job ${job.id} (run=${job.run_id}, attempt=${job.attempts}/${job.max_attempts})`
  );

  const heartbeat = setInterval(async () => {
    try {
      const ok = await heartbeatGenerationJob(job.id, workerId, leaseSeconds);
      if (!ok) {
        leaseLost = true;
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

  try {
    await runGenerationPipeline(job.payload, async (_stepName, fn) => {
      if (leaseLost) {
        throw new WorkerLeaseLostError(job.id);
      }
      return fn();
    });

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

    if (isCancelled) {
      await cancelGenerationJobForRun(job.run_id);
      console.log(`[generation-worker] Cancelled job ${job.id}`);
      return;
    }

    if (job.attempts < job.max_attempts) {
      await clearPipelineState(job.run_id);
      await updateRunStatus(job.run_id, "pending", {
        progress: 0,
        current_stage: "queued",
        error_message: errorMessage,
      });
      await markGenerationJobRetryable(job.id, workerId, errorMessage);
      console.warn(
        `[generation-worker] Requeued job ${job.id} after error (attempt ${job.attempts}/${job.max_attempts}): ${errorMessage}`
      );
      return;
    }

    await handleGenerationPipelineFailure(
      { runId: job.run_id, projectId: job.project_id },
      error
    );
    await failGenerationJob(job.id, workerId, errorMessage);
    console.error(`[generation-worker] Failed job ${job.id}: ${errorMessage}`);
  } finally {
    clearInterval(heartbeat);
  }
}
