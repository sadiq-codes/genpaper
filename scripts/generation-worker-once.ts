import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import os from "os";
import { claimGenerationJobForRun } from "../lib/generation/job-queue";
import { processGenerationJob } from "../lib/generation/worker-executor";

const LEASE_SECONDS = Number(process.env.GENERATION_WORKER_LEASE_SECONDS || 180);
const HEARTBEAT_INTERVAL_MS = Number(
  process.env.GENERATION_WORKER_HEARTBEAT_MS || 20000
);

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

function resolveRunId(): string | undefined {
  return (
    getArg("--run-id") ||
    getArg("-r") ||
    process.env.GENERATION_RUN_ID ||
    undefined
  );
}

async function main(): Promise<void> {
  const runId = resolveRunId();
  if (!runId) {
    throw new Error(
      "Missing run ID. Pass --run-id <uuid> or set GENERATION_RUN_ID."
    );
  }

  const workerId = process.env.GENERATION_WORKER_ID || `${os.hostname()}-${process.pid}`;

  const job = await claimGenerationJobForRun(runId, workerId, LEASE_SECONDS);
  if (!job) {
    console.log(
      `[generation-worker-once] No claimable job found for run ${runId}; exiting`
    );
    return;
  }

  await processGenerationJob(job, {
    workerId,
    leaseSeconds: LEASE_SECONDS,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    hardStopOnCancel: true,
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[generation-worker-once] Fatal error: ${message}`);
  process.exit(1);
});
