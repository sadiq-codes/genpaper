import { NextRequest } from "next/server";
import { authenticateUser } from "@/lib/services/project-service";
import {
  getRun,
  getEventsAfter,
  isRunTerminal,
  type GenerationEvent,
} from "@/lib/generation/run-manager";
import { warn, error as logError } from "@/lib/utils/logger";

export const runtime = "nodejs";

// Increase function timeout for long-polling
export const maxDuration = 300; // 5 minutes

const isDev = process.env.NODE_ENV !== "production";
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(",") || [];

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
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    ...getCorsHeaders(request),
  };
}

function formatSSEEvent(event: GenerationEvent): string {
  // Format as SSE with id for Last-Event-ID support
  const data = JSON.stringify({
    type: event.event_type,
    ...event.payload,
    timestamp: event.created_at,
  });
  return `id: ${event.id}\ndata: ${data}\n\n`;
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
 * GET /api/generate/[runId]/events
 *
 * SSE endpoint for streaming generation events.
 * Supports Last-Event-ID header for resuming from a specific point.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;

  try {
    // Authenticate user
    const user = await authenticateUser();
    if (!user) {
      warn("Authentication failed for events request");
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
        }
      );
    }

    // Get the run
    const run = await getRun(runId);
    if (!run) {
      return new Response(
        JSON.stringify({ error: "Generation run not found" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
        }
      );
    }

    // Verify ownership
    if (run.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Access denied" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
        }
      );
    }

    // Parse Last-Event-ID header for resume support
    const lastEventIdHeader = request.headers.get("Last-Event-ID");
    let lastEventId = 0;
    if (lastEventIdHeader) {
      const parsed = parseInt(lastEventIdHeader, 10);
      if (!isNaN(parsed)) {
        lastEventId = parsed;
      }
    }

    if (isDev) {
      console.log("Events stream started:", {
        runId,
        lastEventId,
        runStatus: run.status,
      });
    }

    // Create the SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let isControllerClosed = false;
        let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
        let pollInterval: ReturnType<typeof setInterval> | null = null;
        let currentLastEventId = lastEventId;

        // Helper to clean up and close
        const cleanup = () => {
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          if (pollInterval) clearInterval(pollInterval);
          if (!isControllerClosed) {
            isControllerClosed = true;
            try {
              controller.close();
            } catch {
              // Already closed
            }
          }
        };

        // Helper to send events
        const sendEvents = async (events: GenerationEvent[]) => {
          for (const event of events) {
            if (isControllerClosed) return;
            try {
              controller.enqueue(encoder.encode(formatSSEEvent(event)));
              currentLastEventId = event.id;
            } catch {
              isControllerClosed = true;
              cleanup();
              return;
            }
          }
        };

        // Heartbeat to keep connection alive
        heartbeatInterval = setInterval(() => {
          if (isControllerClosed) {
            cleanup();
            return;
          }
          try {
            controller.enqueue(encoder.encode(`: keep-alive\n\n`));
          } catch {
            isControllerClosed = true;
            cleanup();
          }
        }, 15000);

        // Send any existing events immediately (replay)
        try {
          const existingEvents = await getEventsAfter(runId, currentLastEventId);
          if (existingEvents.length > 0) {
            await sendEvents(existingEvents);
          }
        } catch (err) {
          logError({ error: err }, "Failed to fetch existing events");
        }

        // Check if run is already terminal
        const currentRun = await getRun(runId);
        if (currentRun && isRunTerminal(currentRun)) {
          // Run is complete - close stream after sending any remaining events
          cleanup();
          return;
        }

        // Poll for new events
        pollInterval = setInterval(async () => {
          if (isControllerClosed) {
            cleanup();
            return;
          }

          try {
            // Check run status
            const latestRun = await getRun(runId);
            if (!latestRun) {
              cleanup();
              return;
            }

            // Fetch new events
            const newEvents = await getEventsAfter(runId, currentLastEventId);
            if (newEvents.length > 0) {
              await sendEvents(newEvents);
            }

            // If run is terminal, close after sending events
            if (isRunTerminal(latestRun)) {
              // Small delay to ensure all events are sent
              setTimeout(cleanup, 500);
            }
          } catch (err) {
            logError({ error: err }, "Error polling for events");
            // Don't close on transient errors - keep trying
          }
        }, 2000); // Poll every 2s to reduce DB load (events are still sent immediately when available)

        // Handle client disconnect
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
    logError({ error: err }, "Events stream error");
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
      }
    );
  }
}
