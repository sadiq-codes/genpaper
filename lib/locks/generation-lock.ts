/**
 * Database-based distributed lock for paper generation
 * Works across serverless instances by using PostgreSQL
 * 
 * NOTE: Requires the migration 20260105000000_add_generation_lock.sql to be applied.
 * If the columns don't exist, the lock will be skipped (graceful degradation).
 */

import { getSB } from '@/lib/supabase/server'
import { warn, error as logError } from '@/lib/utils/logger'

const LOCK_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes max lock duration

export interface LockResult {
  acquired: boolean
  lockId?: string
  error?: string
}

/**
 * Attempt to acquire a distributed lock for paper generation
 * Uses the research_projects table to track lock state
 */
export async function acquireGenerationLock(projectId: string): Promise<LockResult> {
  const supabase = await getSB()
  const lockId = `gen-${projectId}-${Date.now()}`
  const now = new Date()
  const expiredThreshold = new Date(now.getTime() - LOCK_TIMEOUT_MS)
  
  try {
    // First, check if there's an active (non-expired) lock
    const { data: existing, error: selectError } = await supabase
      .from('research_projects')
      .select('generation_lock_id, generation_lock_at')
      .eq('id', projectId)
      .single()

    // If the columns don't exist, gracefully skip locking
    if (selectError?.message?.includes('generation_lock_id') || 
        selectError?.message?.includes('column') ||
        selectError?.code === '42703') {
      warn('Lock columns not found - run migration 20260105000000_add_generation_lock.sql')
      // Return acquired=true to allow generation to proceed without locking
      return { acquired: true, lockId: 'no-lock-columns' }
    }

    if (existing?.generation_lock_id && existing?.generation_lock_at) {
      const lockTime = new Date(existing.generation_lock_at)
      if (lockTime > expiredThreshold) {
        // Lock is still valid
        return { acquired: false, error: 'GENERATION_IN_PROGRESS' }
      }
      // Lock has expired, we can try to take it
    }

    // Try to acquire the lock
    const { data, error } = await supabase
      .from('research_projects')
      .update({
        generation_lock_id: lockId,
        generation_lock_at: now.toISOString()
      })
      .eq('id', projectId)
      .select('id, generation_lock_id')
      .single()

    if (error) {
      // If update fails due to missing columns, allow generation to proceed
      if (error.message?.includes('generation_lock_id') || 
          error.message?.includes('column') ||
          error.code === '42703') {
        warn('Lock columns not found during update - skipping lock')
        return { acquired: true, lockId: 'no-lock-columns' }
      }
      logError('Lock acquisition query failed', { error, projectId })
      throw error
    }

    // Verify we got our lock (handles race conditions)
    if (data?.generation_lock_id === lockId) {
      return { acquired: true, lockId }
    }

    // Someone else got the lock
    return { acquired: false, error: 'GENERATION_IN_PROGRESS' }
  } catch (err) {
    // On any error, allow generation to proceed (fail open for availability)
    logError('Failed to acquire generation lock - allowing generation', { error: err, projectId })
    return { acquired: true, lockId: 'error-fallback' }
  }
}

/**
 * Release a generation lock
 */
export async function releaseGenerationLock(projectId: string, lockId: string): Promise<void> {
  // Skip if we didn't actually acquire a real lock
  if (lockId === 'no-lock-columns' || lockId === 'error-fallback') {
    return
  }

  const supabase = await getSB()
  
  try {
    // Only release if we still hold the lock
    const { error } = await supabase
      .from('research_projects')
      .update({
        generation_lock_id: null,
        generation_lock_at: null
      })
      .eq('id', projectId)
      .eq('generation_lock_id', lockId)

    if (error) {
      // Ignore errors about missing columns
      if (!error.message?.includes('generation_lock_id') && 
          !error.message?.includes('column') &&
          error.code !== '42703') {
        warn('Failed to release generation lock', { error, projectId, lockId })
      }
    }
  } catch (err) {
    warn('Exception releasing generation lock', { error: err, projectId, lockId })
    // Don't throw - lock will expire naturally
  }
}

/**
 * Check if a project has an active generation lock
 */
export async function isGenerationLocked(projectId: string): Promise<boolean> {
  const supabase = await getSB()
  
  try {
    const { data, error } = await supabase
      .from('research_projects')
      .select('generation_lock_id, generation_lock_at')
      .eq('id', projectId)
      .single()

    // If columns don't exist, assume not locked
    if (error?.message?.includes('generation_lock_id') || 
        error?.message?.includes('column') ||
        error?.code === '42703') {
      return false
    }

    if (!data?.generation_lock_id || !data?.generation_lock_at) {
      return false
    }

    // Check if lock has expired
    const lockTime = new Date(data.generation_lock_at).getTime()
    return Date.now() - lockTime < LOCK_TIMEOUT_MS
  } catch {
    return false
  }
}
