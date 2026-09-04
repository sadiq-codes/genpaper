import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import os from "os";
import {
  claimNextGenerationJob,
} from "../lib/generation/job-queue";
import { processGenerationJob } from "../lib/generation/worker-executor";

const POLL_INTERVAL_MS = Number(process.env.GENERATION_WORKER_POLL_MS || 5000);
const LEASE_SECONDS = Number(process.env.GENERATION_WORKER_LEASE_SECONDS || 180);
const HEARTBEAT_INTERVAL_MS = Number(
  process.env.GENERATION_WORKER_HEARTBEAT_MS || 20000
);

const workerId =
  process.env.GENERATION_WORKER_ID || `${os.hostname()}-${process.pid}`;

let shuttingDown = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function runLoop(): Promise<void> {
  console.log(
    `[generation-worker] Started workerId=${workerId}, poll=${POLL_INTERVAL_MS}ms, lease=${LEASE_SECONDS}s`
  );

  while (!shuttingDown) {
    try {
      const job = await claimNextGenerationJob(workerId, LEASE_SECONDS);

      if (!job) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      await processGenerationJob(job, {
        workerId,
        leaseSeconds: LEASE_SECONDS,
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      });
    } catch (error) {
      console.error("[generation-worker] Loop error:", getErrorMessage(error));
      await sleep(POLL_INTERVAL_MS);
    }
  }

  console.log("[generation-worker] Shutdown complete");
}

process.on("SIGINT", () => {
  shuttingDown = true;
});
process.on("SIGTERM", () => {
  shuttingDown = true;
});

runLoop().catch((error) => {
  console.error("[generation-worker] Fatal error:", getErrorMessage(error));
  process.exit(1);
});
