/**
 * Generation Run Manager
 * 
 * Handles the lifecycle of generation runs and event logging.
 * This enables resumable, event-sourced generation that survives
 * network disconnects and browser minimization.
 */

import { createServiceClient } from "@/lib/supabase/service";

export type GenerationRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type GenerationEventType = 
  | 'progress' 
  | 'text_chunk' 
  | 'section_start' 
  | 'section_complete' 
  | 'complete' 
  | 'error' 
  | 'cancelled';

export interface GenerationRun {
  id: string;
  project_id: string;
  user_id: string;
  status: GenerationRunStatus;
  progress: number;
  current_stage: string | null;
  current_section: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  expires_at: string;
}

export interface GenerationEvent {
  id: number;
  run_id: string;
  event_type: GenerationEventType;
  payload: Record<string, unknown>;
  created_at: string;
}

// Event payload types
export interface ProgressPayload {
  stage: string;
  progress: number;
  message: string;
}

export interface TextChunkPayload {
  section: string;
  text: string;
  // Note: fullContentSoFar removed to prevent DB bloat
  // Client accumulates chunks locally for live preview
}

export interface SectionStartPayload {
  section: string;
  index: number;
  total: number;
}

export interface SectionCompletePayload {
  section: string;
  content: string;
  index: number;
  total: number;
}

export interface CompletePayload {
  content: string;
}

export interface ErrorPayload {
  message: string;
}

/**
 * Create a new generation run
 */
export async function createRun(
  projectId: string,
  userId: string
): Promise<GenerationRun> {
  const supabase = createServiceClient();
  
  const { data, error } = await supabase
    .from("generation_runs")
    .insert({
      project_id: projectId,
      user_id: userId,
      status: 'pending',
      progress: 0,
    })
    .select()
    .single();
  
  if (error) {
    throw new Error(`Failed to create generation run: ${error.message}`);
  }
  
  return data as GenerationRun;
}

/**
 * Get a generation run by ID
 */
export async function getRun(runId: string): Promise<GenerationRun | null> {
  const supabase = createServiceClient();
  
  const { data, error } = await supabase
    .from("generation_runs")
    .select()
    .eq("id", runId)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw new Error(`Failed to get generation run: ${error.message}`);
  }
  
  return data as GenerationRun;
}

/**
 * Get the currently running generation for a project (if any)
 */
export async function getRunningRun(projectId: string): Promise<GenerationRun | null> {
  const supabase = createServiceClient();
  
  const { data, error } = await supabase
    .from("generation_runs")
    .select()
    .eq("project_id", projectId)
    .in("status", ['pending', 'running'])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (error) {
    throw new Error(`Failed to get running generation: ${error.message}`);
  }
  
  return data as GenerationRun | null;
}

/**
 * Get the most recent run for a project
 */
export async function getLatestRun(projectId: string): Promise<GenerationRun | null> {
  const supabase = createServiceClient();
  
  const { data, error } = await supabase
    .from("generation_runs")
    .select()
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (error) {
    throw new Error(`Failed to get latest generation run: ${error.message}`);
  }
  
  return data as GenerationRun | null;
}

/**
 * Update a generation run's status
 */
export async function updateRunStatus(
  runId: string,
  status: GenerationRunStatus,
  updates?: {
    progress?: number;
    current_stage?: string;
    current_section?: string;
    error_message?: string;
  }
): Promise<void> {
  const supabase = createServiceClient();
  
  const updateData: Record<string, unknown> = { status, ...updates };
  
  // Set timestamps based on status
  if (status === 'running' && !updates?.current_stage) {
    updateData.started_at = new Date().toISOString();
  }
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    updateData.completed_at = new Date().toISOString();
  }
  
  const { error } = await supabase
    .from("generation_runs")
    .update(updateData)
    .eq("id", runId);
  
  if (error) {
    throw new Error(`Failed to update generation run: ${error.message}`);
  }
}

/**
 * Update run progress (convenience method)
 * Progress is optional - if not provided, only stage/section are updated
 */
export async function updateRunProgress(
  runId: string,
  progress?: number,
  stage?: string,
  section?: string
): Promise<void> {
  const supabase = createServiceClient();
  
  const updateData: Record<string, unknown> = { 
    status: 'running',
  };
  
  // Only include progress if it's a valid number
  if (progress !== undefined && progress !== null) {
    updateData.progress = progress;
  }
  if (stage) updateData.current_stage = stage;
  if (section) updateData.current_section = section;
  
  const { error } = await supabase
    .from("generation_runs")
    .update(updateData)
    .eq("id", runId);
  
  if (error) {
    console.error(`Failed to update run progress: ${error.message}`);
    // Don't throw - progress updates are not critical
  }
}

/**
 * Cancel all running generations for a project
 */
export async function cancelRunningGenerations(
  projectId: string,
  excludeRunId?: string
): Promise<GenerationRun[]> {
  const supabase = createServiceClient();
  
  const { data, error } = await supabase
    .rpc("cancel_running_generations", {
      p_project_id: projectId,
      p_exclude_run_id: excludeRunId || null,
    });
  
  if (error) {
    console.error(`Failed to cancel running generations: ${error.message}`);
    return [];
  }
  
  return (data || []) as GenerationRun[];
}

/**
 * Emit an event to the generation event log
 */
export async function emitEvent(
  runId: string,
  eventType: GenerationEventType,
  payload: Record<string, unknown>
): Promise<GenerationEvent> {
  const supabase = createServiceClient();
  
  const { data, error } = await supabase
    .from("generation_events")
    .insert({
      run_id: runId,
      event_type: eventType,
      payload,
    })
    .select()
    .single();
  
  if (error) {
    const message = error.message.toLowerCase();
    const isStaleRunForeignKey =
      message.includes("violates foreign key constraint") ||
      message.includes("generation_events_run_id_fkey");

    // Log but don't throw for non-critical events.
    // FK violations happen for stale/deleted runs and are expected noise.
    if (!isStaleRunForeignKey) {
      console.error(`Failed to emit event ${eventType}: ${error.message}`);
    }

    // Return a mock event to allow pipeline to continue
    return {
      id: -1,
      run_id: runId,
      event_type: eventType,
      payload,
      created_at: new Date().toISOString(),
    };
  }
  
  return data as GenerationEvent;
}

/**
 * Emit a progress event
 */
export async function emitProgress(
  runId: string,
  stage: string,
  progress: number,
  message: string
): Promise<void> {
  // Update run progress in parallel with emitting event
  await Promise.all([
    updateRunProgress(runId, progress, stage),
    emitEvent(runId, 'progress', { stage, progress, message }),
  ]);
}

/**
 * Emit a text chunk event (for sentence streaming)
 * Only stores the incremental text chunk - client accumulates for full content
 */
export async function emitTextChunk(
  runId: string,
  section: string,
  text: string
): Promise<void> {
  await emitEvent(runId, 'text_chunk', { section, text });
}

/**
 * Emit a section start event
 */
export async function emitSectionStart(
  runId: string,
  section: string,
  index: number,
  total: number
): Promise<void> {
  await Promise.all([
    // Only update current_section, don't change progress
    updateRunProgress(runId, undefined, undefined, section),
    emitEvent(runId, 'section_start', { section, index, total }),
  ]);
}

/**
 * Emit a section complete event
 */
export async function emitSectionComplete(
  runId: string,
  section: string,
  content: string,
  index: number,
  total: number
): Promise<void> {
  await emitEvent(runId, 'section_complete', { section, content, index, total });
}

/**
 * Emit a complete event
 */
export async function emitComplete(runId: string, content: string): Promise<void> {
  await Promise.all([
    updateRunStatus(runId, 'completed', { progress: 100 }),
    emitEvent(runId, 'complete', { content }),
  ]);
}

/**
 * Emit an error event
 */
export async function emitError(runId: string, message: string): Promise<void> {
  await Promise.all([
    updateRunStatus(runId, 'failed', { error_message: message }),
    emitEvent(runId, 'error', { message }),
  ]);
}

/**
 * Emit a cancelled event
 */
export async function emitCancelled(runId: string): Promise<void> {
  await Promise.all([
    updateRunStatus(runId, 'cancelled'),
    emitEvent(runId, 'cancelled', {}),
  ]);
}

/**
 * Get events for a run, optionally after a given event ID
 * Used for Last-Event-ID based resumption
 */
export async function getEventsAfter(
  runId: string,
  afterId: number = 0
): Promise<GenerationEvent[]> {
  const supabase = createServiceClient();
  
  const { data, error } = await supabase
    .rpc("get_generation_events_after", {
      p_run_id: runId,
      p_after_id: afterId,
    });
  
  if (error) {
    throw new Error(`Failed to get generation events: ${error.message}`);
  }
  
  return (data || []) as GenerationEvent[];
}

/**
 * Check if a run is still active (pending or running)
 */
export function isRunActive(run: GenerationRun): boolean {
  return run.status === 'pending' || run.status === 'running';
}

/**
 * Check if a run is terminal (completed, failed, or cancelled)
 */
export function isRunTerminal(run: GenerationRun): boolean {
  return run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled';
}

// =============================================================================
// Pipeline State Management
// =============================================================================
// These functions manage intermediate state for the multi-step generation pipeline.
// State is stored in the pipeline_state JSONB column of generation_runs.

import type { PaperProfile } from "@/lib/generation/paper-profile-types";
import type { AnalysisResult } from "@/lib/analysis/cross-document";
import type { SectionContext } from "@/lib/prompts/types";
import type { StructuredCitation } from "@/lib/generation/unified-generator";

/**
 * Pipeline state stored between generation steps
 */
export interface PipelineState {
  // Phase 1: Profile
  profile?: PaperProfile;
  
  // Phase 2: Discovery  
  paperIds?: string[];
  
  // Phase 3: Theme Extraction
  extractionProgress?: {
    cachedPaperIds: string[];
    pendingPaperIds: string[];
    extractedBatches: number;
    totalBatches: number;
  };
  themeAnalysis?: AnalysisResult;
  
  // Phase 4: Contexts
  // Note: We store minimal context info, not full chunks (too large)
  contextSummaries?: Array<{
    sectionKey: string;
    title: string;
    expectedWords: number;
  }>;
  
  // Phase 5: Section Generation
  sectionResults?: Array<{
    sectionKey: string;
    title: string;
    content: string;
    citations: StructuredCitation[];
    wordCount: number;
  }>;
  completedSectionIndices?: number[];
  
  // Phase 6: Quality
  qualityIssues?: Array<{
    sectionIndex: number;
    issue: 'overlap' | 'length' | 'citation';
    details?: string;
  }>;
  rewrittenSections?: number[];
  
  // Config passed from event
  config?: {
    topic: string;
    paperType: string;
    length: number;
    customInstructions?: string;
    useLibraryOnly?: boolean;
    libraryPaperIds?: string[];
    originalResearch?: {
      has_original_research: boolean;
      research_question?: string;
      key_findings?: string;
    };
  };
}

/**
 * Get pipeline state for a run
 */
export async function getPipelineState(runId: string): Promise<PipelineState> {
  const supabase = createServiceClient();
  
  const { data, error } = await supabase
    .from("generation_runs")
    .select("pipeline_state")
    .eq("id", runId)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') return {}; // Not found, return empty state
    throw new Error(`Failed to get pipeline state: ${error.message}`);
  }
  
  return (data?.pipeline_state as PipelineState) || {};
}

/**
 * Update pipeline state (merges with existing state)
 */
export async function updatePipelineState(
  runId: string,
  updates: Partial<PipelineState>
): Promise<void> {
  const supabase = createServiceClient();
  
  // Get current state and merge
  const currentState = await getPipelineState(runId);
  const newState = { ...currentState, ...updates };
  
  const { error } = await supabase
    .from("generation_runs")
    .update({ pipeline_state: newState })
    .eq("id", runId);
  
  if (error) {
    throw new Error(`Failed to update pipeline state: ${error.message}`);
  }
}

/**
 * Set a specific key in pipeline state
 */
export async function setPipelineStateKey<K extends keyof PipelineState>(
  runId: string,
  key: K,
  value: PipelineState[K]
): Promise<void> {
  await updatePipelineState(runId, { [key]: value } as Partial<PipelineState>);
}

/**
 * Append a section result to the pipeline state
 */
export async function appendSectionResult(
  runId: string,
  sectionIndex: number,
  result: {
    sectionKey: string;
    title: string;
    content: string;
    citations: StructuredCitation[];
    wordCount: number;
  }
): Promise<void> {
  const state = await getPipelineState(runId);
  const sectionResults = state.sectionResults || [];
  const completedIndices = state.completedSectionIndices || [];
  
  // Add or update the section result
  const existingIndex = sectionResults.findIndex(r => r.sectionKey === result.sectionKey);
  if (existingIndex >= 0) {
    sectionResults[existingIndex] = result;
  } else {
    sectionResults.push(result);
  }
  
  // Track completed indices
  if (!completedIndices.includes(sectionIndex)) {
    completedIndices.push(sectionIndex);
  }
  
  await updatePipelineState(runId, { 
    sectionResults, 
    completedSectionIndices: completedIndices 
  });
}

/**
 * Mark extraction batch as complete
 */
export async function markExtractionBatchComplete(
  runId: string,
  batchNumber: number
): Promise<void> {
  const state = await getPipelineState(runId);
  const progress = state.extractionProgress || {
    cachedPaperIds: [],
    pendingPaperIds: [],
    extractedBatches: 0,
    totalBatches: 0,
  };
  
  progress.extractedBatches = batchNumber + 1;
  
  await updatePipelineState(runId, { extractionProgress: progress });
}

/**
 * Clear pipeline state (called on completion or failure)
 */
export async function clearPipelineState(runId: string): Promise<void> {
  const supabase = createServiceClient();
  
  const { error } = await supabase
    .from("generation_runs")
    .update({ pipeline_state: {}, context_cache: null })
    .eq("id", runId);
  
  if (error) {
    console.error(`Failed to clear pipeline state: ${error.message}`);
    // Don't throw - this is cleanup
  }
}

// =============================================================================
// Context Cache (avoids rebuilding contexts in every generation step)
// =============================================================================

import { gzipSync, gunzipSync } from "zlib";

/**
 * Save section contexts to a compressed cache column.
 * Contexts include RAG chunks and enrichment data that are expensive to rebuild.
 */
export async function saveContextCache(
  runId: string,
  contexts: unknown[]
): Promise<void> {
  const supabase = createServiceClient();

  try {
    const json = JSON.stringify(contexts);
    const compressed = gzipSync(Buffer.from(json, "utf-8"));
    const encoded = compressed.toString("base64");

    const { error } = await supabase
      .from("generation_runs")
      .update({ context_cache: encoded })
      .eq("id", runId);

    if (error) {
      console.error(`[context-cache] Failed to save: ${error.message}`);
    } else {
      const rawKB = (json.length / 1024).toFixed(1);
      const compKB = (encoded.length / 1024).toFixed(1);
      console.log(`[context-cache] Saved ${contexts.length} contexts (${rawKB}KB → ${compKB}KB compressed)`);
    }
  } catch (err) {
    console.error("[context-cache] Compression/save failed:", err);
  }
}

/**
 * Load section contexts from cache. Returns null if no cache exists.
 */
export async function loadContextCache<T = unknown>(
  runId: string
): Promise<T[] | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("generation_runs")
    .select("context_cache")
    .eq("id", runId)
    .single();

  if (error || !data?.context_cache) {
    return null;
  }

  try {
    const compressed = Buffer.from(data.context_cache as string, "base64");
    const json = gunzipSync(compressed).toString("utf-8");
    return JSON.parse(json) as T[];
  } catch (err) {
    console.error("[context-cache] Decompression/parse failed:", err);
    return null;
  }
}
