import { launchOneShotWorker } from "@/lib/generation/worker-launcher";
import {
  getRun,
  updateRunStatus,
  emitEvent,
  isRunTerminal,
  type GenerationRun,
} from "@/lib/generation/run-manager";
import {
  getGenerationJobForRun,
  failGenerationJobForRecovery,
  type GenerationJob,
} from "@/lib/generation/job-queue";

const RELAUNCH_COOLDOWN_MS = Number(
  process.env.GENERATION_RECOVERY_RELAUNCH_COOLDOWN_MS || 30000
);
const STALE_LEASE_GRACE_MS = Number(
  process.env.GENERATION_RECOVERY_STALE_LEASE_GRACE_MS || 15000
);

const nextLaunchAllowedAtByRun = new Map<string, number>();

function parseTimeMs(timestamp: string | null): number | null {
  if (!timestamp) return null;
  const ms = Date.parse(timestamp);
  return Number.isNaN(ms) ? null : ms;
}

function isLeaseStale(job: GenerationJob, nowMs: number): boolean {
  const leaseUntilMs = parseTimeMs(job.lease_until);
  if (leaseUntilMs === null) return false;
  return leaseUntilMs + STALE_LEASE_GRACE_MS < nowMs;
}

function shouldAttemptLaunch(runId: string, nowMs: number): boolean {
  const nextAllowedAt = nextLaunchAllowedAtByRun.get(runId) || 0;
  if (nowMs < nextAllowedAt) {
    return false;
  }
  nextLaunchAllowedAtByRun.set(runId, nowMs + RELAUNCH_COOLDOWN_MS);
  return true;
}

async function markRunFailed(
  runId: string,
  message: string,
  jobId?: string
): Promise<void> {
  if (jobId) {
    await failGenerationJobForRecovery(jobId, message).catch((err) => {
      console.error("[run-recovery] Failed to mark job failed:", err);
    });
  }

  await updateRunStatus(runId, "failed", {
    error_message: message,
    current_stage: "failed",
  });
  await emitEvent(runId, "error", { message });
  nextLaunchAllowedAtByRun.delete(runId);
}

async function maybeLaunchRecoveryWorker(
  runId: string,
  nowMs: number,
  reason: string
): Promise<boolean> {
  const launchMode = (process.env.GENERATION_ONE_SHOT_LAUNCH_MODE || "cmd")
    .trim()
    .toLowerCase();
  if (launchMode === "none") {
    return false;
  }

  if (!shouldAttemptLaunch(runId, nowMs)) {
    return false;
  }

  try {
    await launchOneShotWorker(runId);
    console.log(`[run-recovery] Relaunched worker for run ${runId} (${reason})`);
    return true;
  } catch (err) {
    console.error(`[run-recovery] Failed to relaunch worker for run ${runId}:`, err);
    return false;
  }
}

/**
 * Reconciles run status with queue/lease state so reopening the editor can
 * continue work after worker crashes or host restarts.
 */
export async function reconcileRunHealth(runId: string): Promise<GenerationRun | null> {
  let run = await getRun(runId);
  if (!run) return null;

  if (isRunTerminal(run)) {
    nextLaunchAllowedAtByRun.delete(runId);
    return run;
  }

  const job = await getGenerationJobForRun(runId);
  if (!job) {
    await markRunFailed(runId, "Generation stopped unexpectedly. Please retry.");
    return getRun(runId);
  }

  if (job.status === "failed") {
    if (run.status !== "failed") {
      await markRunFailed(
        runId,
        job.error_message || "Generation failed in worker."
      );
      return getRun(runId);
    }
    return run;
  }

  if (job.status === "cancelled") {
    if (run.status !== "cancelled") {
      await updateRunStatus(runId, "cancelled");
      await emitEvent(runId, "cancelled", {});
    }
    nextLaunchAllowedAtByRun.delete(runId);
    return getRun(runId);
  }

  if (job.status === "completed") {
    // If job says completed but run never finalized, treat it as failed so the
    // user can retry immediately rather than staying stuck in "running".
    if (run.status !== "completed") {
      await markRunFailed(
        runId,
        "Generation worker ended before finalizing the run. Please retry.",
        job.id
      );
      return getRun(runId);
    }
    nextLaunchAllowedAtByRun.delete(runId);
    return run;
  }

  // Active worker states from here: pending/running.
  const nowMs = Date.now();

  if (job.attempts >= job.max_attempts) {
    await markRunFailed(
      runId,
      job.error_message || "Generation reached maximum retry attempts.",
      job.id
    );
    return getRun(runId);
  }

  if (job.status === "pending") {
    const relaunched = await maybeLaunchRecoveryWorker(runId, nowMs, "job pending");
    if (relaunched) {
      await emitEvent(runId, "progress", {
        stage: "initialization",
        progress: run.progress,
        message: "Resuming generation...",
      });
    }
    return getRun(runId);
  }

  if (job.status === "running" && isLeaseStale(job, nowMs)) {
    const relaunched = await maybeLaunchRecoveryWorker(runId, nowMs, "lease stale");
    if (relaunched) {
      await updateRunStatus(runId, "pending", {
        current_stage: "queued",
      });
      await emitEvent(runId, "progress", {
        stage: "initialization",
        progress: run.progress,
        message: "Recovering generation worker...",
      });
    }
    run = (await getRun(runId)) || run;
    return run;
  }

  return run;
}
