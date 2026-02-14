import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { functions } from "@/lib/inngest/functions/generate-paper";

// Configure max duration for serverless functions
// - Vercel Hobby: 60s max
// - Vercel Pro: 300s max  
// - Azure Container Apps: No hard limit (uses request timeout ~240s)
// With streaming enabled, Vercel can go up to 15 minutes
export const maxDuration = 300;

// Create the Inngest serve handler
// This endpoint receives webhook calls from Inngest to run functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
  // Enable streaming to increase max timeout on supported platforms
  // This allows steps to run longer without timing out
  streaming: "allow",
});
