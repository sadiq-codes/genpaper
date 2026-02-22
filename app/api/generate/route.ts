import { NextRequest } from "next/server";
import { authenticateUser } from "@/lib/services/project-service";
import {
  getRun,
  getEventsAfter,
  isRunTerminal,
  type GenerationEvent,
} from "@/lib/generation/run-manager";
import { reconcileRunHealth } from "@/lib/generation/run-recovery";
import { startGenerationRun } from "@/lib/generation/start-generation";
import { warn, error as logError } from "@/lib/utils/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

const isDev = process.env.NODE_ENV !== "production";
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(",") || [];
const MAX_CONSECUTIVE_POLL_ERRORS = Number(
  process.env.GENERATION_EVENTS_MAX_POLL_ERRORS || 20
);
const DEFAULT_SOURCES = [
  "europe_pmc",
  "pubmed_central",
  "openalex",
  "core",
  "arxiv",
  "crossref",
  "semantic_scholar",
];

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

function getStreamHeaders(request: NextRequest): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...getCorsHeaders(request),
  };
}

function createErrorStream(error: string, request: NextRequest): Response {
  const encoder = new TextEncoder();
  const errorStream = new ReadableStream({
    start(controller) {
      const errorData = JSON.stringify({
        type: "error",
        message: error,
        error,
        timestamp: new Date().toISOString(),
      });
      controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
      controller.close();
    },
  });

  return new Response(errorStream, {
    status: 200,
    headers: getStreamHeaders(request),
  });
}

function formatLegacySSEEvent(event: GenerationEvent, projectId: string): string {
  const payload: Record<string, unknown> = {
    type: event.event_type,
    ...event.payload,
    timestamp: event.created_at,
  };

  if (event.event_type === "complete") {
    payload.projectId = projectId;
  }

  if (
    event.event_type === "error" &&
    typeof payload.message === "string" &&
    !("error" in payload)
  ) {
    payload.error = payload.message;
  }

  return `id: ${event.id}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function OPTIONS(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept, Last-Event-ID, Cache-Control",
      "Access-Control-Max-Age": "86400",
      ...corsHeaders,
    },
  });
}

/**
 * Legacy SSE compatibility route.
 *
 * This now uses the same orchestration path as /api/generate/start:
 * run creation -> queued job -> worker -> generation events.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await authenticateUser();
    if (!user) {
      warn("Authentication failed for legacy generate stream request");
      return createErrorStream(
        "Authentication required. Please refresh the page and try again.",
        request
      );
    }

    const url = new URL(request.url);
    const topic = url.searchParams.get("topic") || "";
    const paperType = url.searchParams.get("paperType") || "literatureReview";
    const existingProjectId = url.searchParams.get("projectId") || undefined;
    const useLibraryOnly = url.searchParams.get("useLibraryOnly") === "true";
    const length = parseInt(url.searchParams.get("length") || "5500", 10) || 5500;
    const temperature = parseFloat(url.searchParams.get("temperature") || "0.2");
    const maxTokens = parseInt(url.searchParams.get("maxTokens") || "16000", 10);
    const citationStyle = url.searchParams.get("citationStyle") || "apa";
    const hasOriginalResearch = url.searchParams.get("hasOriginalResearch") === "true";
    const customInstructions = url.searchParams.get("customInstructions") || undefined;
    const libraryPaperIds =
      url.searchParams.get("libraryPaperIds")?.split(",").filter(Boolean) || [];
    const sources =
      url.searchParams.get("sources")?.split(",").filter(Boolean) || DEFAULT_SOURCES;

    const startResult = await startGenerationRun({
      userId: user.id,
      topic,
      paperType,
      length,
      useLibraryOnly,
      libraryPaperIds,
      existingProjectId,
      temperature,
      maxTokens,
      sources,
      citationStyle,
      hasOriginalResearch,
      customInstructions,
      baseUrl: url.origin,
    });

    if (!startResult.success) {
      return createErrorStream(startResult.error, request);
    }

    if (startResult.status === "already_complete") {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const completionData = JSON.stringify({
            type: "complete",
            projectId: startResult.projectId,
            content: startResult.content,
            timestamp: new Date().toISOString(),
          });
          controller.enqueue(encoder.encode(`data: ${completionData}\n\n`));
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: getStreamHeaders(request),
      });
    }

    const runId = startResult.runId;
    const projectId = startResult.projectId;
    const lastEventIdHeader = request.headers.get("Last-Event-ID");
    const parsedLastEventId = lastEventIdHeader ? parseInt(lastEventIdHeader, 10) : 0;
    const lastEventId = Number.isFinite(parsedLastEventId) ? parsedLastEventId : 0;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let isControllerClosed = false;
        let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
        let pollTimer: ReturnType<typeof setTimeout> | null = null;
        let currentLastEventId = lastEventId;
        let consecutivePollErrors = 0;

        const cleanup = () => {
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          if (pollTimer) clearTimeout(pollTimer);
          if (!isControllerClosed) {
            isControllerClosed = true;
            try {
              controller.close();
            } catch {
              // Stream is already closed.
            }
          }
        };

        const sendEvents = async (events: GenerationEvent[]) => {
          for (const event of events) {
            if (isControllerClosed) return;
            try {
              controller.enqueue(
                encoder.encode(formatLegacySSEEvent(event, projectId))
              );
              currentLastEventId = event.id;
            } catch {
              cleanup();
              return;
            }
          }
        };

        heartbeatInterval = setInterval(() => {
          if (isControllerClosed) {
            cleanup();
            return;
          }
          try {
            controller.enqueue(encoder.encode(`: keep-alive\n\n`));
          } catch {
            cleanup();
          }
        }, 15000);

        try {
          const existingEvents = await getEventsAfter(runId, currentLastEventId);
          if (existingEvents.length > 0) {
            await sendEvents(existingEvents);
          }
        } catch (error) {
          logError({ error, runId }, "Failed to load initial generation events");
        }

        const currentRun = await getRun(runId);
        if (currentRun && isRunTerminal(currentRun)) {
          cleanup();
          return;
        }

        const poll = async () => {
          if (isControllerClosed) {
            cleanup();
            return;
          }

          try {
            const latestRun = (await reconcileRunHealth(runId)) || (await getRun(runId));
            if (!latestRun) {
              cleanup();
              return;
            }

            const newEvents = await getEventsAfter(runId, currentLastEventId);
            if (newEvents.length > 0) {
              await sendEvents(newEvents);
            }
            consecutivePollErrors = 0;

            if (isRunTerminal(latestRun)) {
              setTimeout(cleanup, 500);
              return;
            }
          } catch (error) {
            consecutivePollErrors += 1;
            logError(
              { error, runId, consecutivePollErrors },
              "Legacy generate stream polling failed"
            );

            if (consecutivePollErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
              try {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "error",
                      message:
                        "Generation connection was interrupted for too long. Please refresh to resume.",
                      error:
                        "Generation connection was interrupted for too long. Please refresh to resume.",
                      timestamp: new Date().toISOString(),
                    })}\n\n`
                  )
                );
              } catch {
                // Ignore send failure while closing.
              }
              cleanup();
              return;
            }
          } finally {
            if (!isControllerClosed) {
              const backoffMs = Math.min(
                8000,
                2000 * Math.max(1, consecutivePollErrors)
              );
              pollTimer = setTimeout(poll, backoffMs);
            }
          }
        };

        pollTimer = setTimeout(poll, 2000);

        request.signal.addEventListener("abort", () => {
          cleanup();
        });
      },
    });

    return new Response(stream, {
      status: 200,
      headers: getStreamHeaders(request),
    });
  } catch (err) {
    logError({ error: err }, "Legacy generate route error");
    return createErrorStream(
      err instanceof Error ? err.message : "Internal server error",
      request
    );
  }
}
