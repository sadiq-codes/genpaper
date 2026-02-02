import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { functions } from "@/lib/inngest/functions/generate-paper";

// Create the Inngest serve handler
// This endpoint receives webhook calls from Inngest to run functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
