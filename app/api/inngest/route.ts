import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { functions } from "@/lib/inngest/functions/generate-paper";

// Configure max duration for Vercel serverless functions
// Each Inngest step runs as a separate function invocation
// 60 seconds is the max for Vercel Hobby plan
export const maxDuration = 60;

// Create the Inngest serve handler
// This endpoint receives webhook calls from Inngest to run functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
