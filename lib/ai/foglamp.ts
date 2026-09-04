import * as ai from "ai";
import { wrap } from "foglamp/wrap";

// Shared Foglamp handle for Vercel AI SDK tracing (AI SDK v6 wrap path).
// Safe in every environment: no-op until FOGLAMP_API_KEY is set.
// The HUD overlay is dev-only and does nothing in production.
export const fog = wrap(ai, { hud: true });
