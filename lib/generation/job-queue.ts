import { createServiceClient } from "@/lib/supabase/service";
import type { GenerationPipelineInput } from "@/lib/generation/pipeline-runner";

export type GenerationJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface GenerationJob {
  id: string;
  run_id: string;
  project_id: string;
  user_id: string;
  status: GenerationJobStatus;
  payload: GenerationPipelineInput;
  attempts: number;
  max_attempts: number;
  worker_id: string | null;
  lease_until: string | null;
  last_heartbeat_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function normalizeJobRow(data: unknown): GenerationJob | null {
  if (!data) return null;
  if (Array.isArray(data)) return (data[0] as GenerationJob) || null;
  return data as GenerationJob;
}

export async function enqueueGenerationJob(
  payload: GenerationPipelineInput
): Promise<GenerationJob> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("generation_jobs")
    .insert({
      run_id: payload.runId,
      project_id: payload.projectId,
      user_id: payload.userId,
      payload,
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to enqueue generation job: ${error.message}`);
  }

  return data as GenerationJob;
}

export async function claimNextGenerationJob(
  workerId: string,
  leaseSeconds: number
): Promise<GenerationJob | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc("claim_generation_job", {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });

  if (error) {
    throw new Error(`Failed to claim generation job: ${error.message}`);
  }

  return normalizeJobRow(data);
}

export async function claimGenerationJobForRun(
  runId: string,
  workerId: string,
  leaseSeconds: number
): Promise<GenerationJob | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc("claim_generation_job_for_run", {
    p_run_id: runId,
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });

  if (error) {
    throw new Error(`Failed to claim generation job for run: ${error.message}`);
  }

  return normalizeJobRow(data);
}

export async function heartbeatGenerationJob(
  jobId: string,
  workerId: string,
  leaseSeconds: number
): Promise<boolean> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc("heartbeat_generation_job", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });

  if (error) {
    throw new Error(`Failed to heartbeat generation job: ${error.message}`);
  }

  return Boolean(data);
}

export async function completeGenerationJob(
  jobId: string,
  workerId: string
): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("generation_jobs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      worker_id: null,
      lease_until: null,
      last_heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("worker_id", workerId)
    .eq("status", "running");

  if (error) {
    throw new Error(`Failed to complete generation job: ${error.message}`);
  }
}

export async function markGenerationJobRetryable(
  jobId: string,
  workerId: string,
  errorMessage: string
): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("generation_jobs")
    .update({
      status: "pending",
      worker_id: null,
      lease_until: null,
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("worker_id", workerId)
    .eq("status", "running");

  if (error) {
    throw new Error(`Failed to requeue generation job: ${error.message}`);
  }
}

export async function failGenerationJob(
  jobId: string,
  workerId: string,
  errorMessage: string
): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("generation_jobs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      worker_id: null,
      lease_until: null,
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("worker_id", workerId)
    .eq("status", "running");

  if (error) {
    throw new Error(`Failed to fail generation job: ${error.message}`);
  }
}

export async function cancelGenerationJobsForRunIds(
  runIds: string[]
): Promise<number> {
  if (runIds.length === 0) return 0;

  const supabase = createServiceClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("generation_jobs")
    .update({
      status: "cancelled",
      completed_at: now,
      worker_id: null,
      lease_until: null,
      updated_at: now,
    })
    .in("run_id", runIds)
    .in("status", ["pending", "running"])
    .select("id");

  if (error) {
    throw new Error(`Failed to cancel generation jobs: ${error.message}`);
  }

  return data?.length || 0;
}

export async function cancelGenerationJobForRun(runId: string): Promise<void> {
  await cancelGenerationJobsForRunIds([runId]);
}
