/**
 * Inngest Function: Cleanup Expired Generation Data
 * 
 * Runs daily to remove expired generation runs and events.
 * This keeps the database clean and prevents unbounded growth.
 */

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/service";

export const cleanupExpiredGenerationData = inngest.createFunction(
  {
    id: "cleanup-generation-events",
  },
  // Run daily at 3 AM UTC
  { cron: "0 3 * * *" },
  async ({ step }) => {
    const result = await step.run("delete-expired", async () => {
      const supabase = createServiceClient();
      
      // Use the database function for cleanup
      const { data, error } = await supabase.rpc("cleanup_expired_generation_data");
      
      if (error) {
        console.error("Failed to cleanup expired generation data:", error);
        throw error;
      }
      
      return {
        deletedRuns: data || 0,
      };
    });

    return result;
  }
);
