import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { createResearchProject } from '@/lib/db/research'
import type { GenerationConfig } from '@/types/simplified'

/**
 * Project service - wraps database operations for API routes
 * Isolates direct database access from API layer
 */

export interface AuthenticatedUser {
  id: string
}

export interface ProjectCreationResult {
  id: string
  userId: string
  topic: string
  generation_config: GenerationConfig
}

/**
 * Authenticate user from request context
 */
export async function authenticateUser(): Promise<AuthenticatedUser | null> {
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    
    if (error || !user) {
      return null
    }
    
    return { id: user.id }
  } catch (error) {
    console.error('Authentication failed:', error)
    return null
  }
}

/**
 * Create a new research project
 */
export async function createProject(
  userId: string, 
  topic: string, 
  config: GenerationConfig
): Promise<ProjectCreationResult> {
  try {
    const project = await createResearchProject(userId, topic, config)
    return {
      id: project.id,
      userId: project.user_id,
      topic: project.topic,
      generation_config: project.generation_config as GenerationConfig
    }
  } catch (error) {
    console.error('Project creation failed:', error)
    throw new Error(`Failed to create project: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

// Note: updateProjectContent was unused and removed to reduce dead code.
