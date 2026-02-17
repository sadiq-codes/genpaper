import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import os from "os";

export const runtime = "nodejs";
export const maxDuration = 900; // 15 minutes max for generation

function unauthorized(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

function getBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token;
}

function getSignatureHeaders(request: NextRequest): {
  timestamp: string | null;
  signature: string | null;
} {
  return {
    timestamp: request.headers.get("x-genpaper-timestamp"),
    signature: request.headers.get("x-genpaper-signature"),
  };
}

function signaturesMatch(expected: string, provided: string): boolean {
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export async function POST(request: NextRequest) {
  try {
    const expectedToken = process.env.GENERATION_ONE_SHOT_LAUNCH_TOKEN;
    if (!expectedToken) {
      return NextResponse.json(
        { error: "Missing launch token configuration" },
        { status: 500 }
      );
    }

    const providedToken = getBearerToken(request);
    if (!providedToken || providedToken !== expectedToken) {
      return unauthorized("Unauthorized");
    }

    const bodyText = await request.text();
    if (!bodyText) {
      return badRequest("Missing body");
    }

    const { timestamp, signature } = getSignatureHeaders(request);
    if (!timestamp || !signature) {
      return unauthorized("Missing signature headers");
    }

    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) {
      return unauthorized("Invalid timestamp");
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const maxAgeSec = Number(
      process.env.GENERATION_ONE_SHOT_SIGNATURE_MAX_AGE_SEC || 300
    );
    if (ts > nowSec + 60 || nowSec - ts > maxAgeSec) {
      return unauthorized("Expired signature");
    }

    const signatureSecret =
      process.env.GENERATION_ONE_SHOT_HMAC_SECRET || expectedToken;
    const expectedSignature = createHmac("sha256", signatureSecret)
      .update(`${timestamp}.${bodyText}`)
      .digest("hex");

    if (!signaturesMatch(expectedSignature, signature)) {
      return unauthorized("Invalid signature");
    }

    let body: { runId?: unknown } | null = null;
    try {
      body = JSON.parse(bodyText) as { runId?: unknown };
    } catch {
      return badRequest("Invalid JSON body");
    }
    const runId = typeof body?.runId === "string" ? body.runId.trim() : "";
    if (!runId) {
      return badRequest("Missing runId");
    }

    // Run the worker inline (not spawning a process)
    // This works because Azure Container App supports long-running requests
    const workerId = `worker-${os.hostname()}-${process.pid}-${Date.now()}`;
    
    // Import dynamically to avoid loading heavy deps at module level
    const { claimGenerationJobForRun } = await import("@/lib/generation/job-queue");
    const { processGenerationJob } = await import("@/lib/generation/worker-executor");

    const leaseSeconds = Number(process.env.GENERATION_WORKER_LEASE_SECONDS || 180);
    const heartbeatIntervalMs = Number(process.env.GENERATION_WORKER_HEARTBEAT_MS || 20000);

    const job = await claimGenerationJobForRun(runId, workerId, leaseSeconds);
    if (!job) {
      return NextResponse.json(
        { error: "No claimable job found for run", runId },
        { status: 404 }
      );
    }

    // Process the job inline (this can take 10-15 minutes)
    await processGenerationJob(job, {
      workerId,
      leaseSeconds,
      heartbeatIntervalMs,
    });

    return NextResponse.json({ completed: true, runId }, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to process generation";
    console.error(`[worker-route] Error processing run: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
