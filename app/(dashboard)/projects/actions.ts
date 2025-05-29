'use server'

import { createClient } from '@/lib/supabase/server'

export async function createProject(formData: FormData) {
  const supabase = await createClient()
  
  // Get the title from form data
  const title = formData.get('title') as string
  
  if (!title || title.trim() === '') {
    return { error: 'Project title is required' }
  }
  
  // Get current user with debugging
  console.log('Attempting to get user...')
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  console.log('User:', user?.id, 'Auth Error:', authError)
  
  if (authError) {
    console.error('Auth error details:', authError)
    return { error: `Authentication error: ${authError.message}` }
  }
  
  if (!user) {
    console.error('No user found in session')
    return { error: 'User not authenticated - no user in session' }
  }
  
  // Insert new project into database
  const { data: project, error: dbError } = await supabase
    .from('projects')
    .insert({
      title: title.trim(),
      user_id: user.id
    })
    .select('id')
    .single()
  
  if (dbError) {
    console.error('Database error:', dbError)
    return { error: 'Failed to create project' }
  }
  
  return { success: true, projectId: project.id }
} 