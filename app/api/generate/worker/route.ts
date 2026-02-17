import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { launchOneShotWorkerProcess } from "@/lib/generation/worker-launcher";

export const runtime = "nodejs";

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

    await launchOneShotWorkerProcess(runId);

    return NextResponse.json({ started: true, runId }, { status: 202 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to launch worker";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
