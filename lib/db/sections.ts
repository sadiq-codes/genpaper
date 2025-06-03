import { createClient } from '@/lib/supabase/client'
import type { Section, SectionStatus, SectionsResponse } from '@/app/(dashboard)/projects/[projectId]/types'

export class SectionsRepository {
  private supabase = createClient()

  async getSections(projectId: string): Promise<SectionsResponse> {
    try {
      const { data, error } = await this.supabase
        .from('paper_sections')
        .select('*')
        .eq('project_id', projectId)
        .order('order', { ascending: true })

      if (error) {
        console.error('Error fetching sections:', error)
        return { success: false, error: error.message }
      }

      return { success: true, sections: data || [] }
    } catch (error) {
      console.error('Error in getSections:', error)
      return { success: false, error: 'Failed to fetch sections' }
    }
  }

  async updateSectionContent(
    projectId: string,
    sectionKey: string,
    content: string,
    wordCount: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.supabase
        .from('paper_sections')
        .update({
          content,
          word_count: wordCount,
          updated_at: new Date().toISOString(),
        })
        .eq('project_id', projectId)
        .eq('section_key', sectionKey)

      if (error) {
        console.error('Error updating section:', error)
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      console.error('Error in updateSectionContent:', error)
      return { success: false, error: 'Failed to update section content' }
    }
  }

  async updateSectionStatus(
    projectId: string,
    sectionKey: string,
    status: SectionStatus
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.supabase
        .from('paper_sections')
        .update({
          status,
          updated_at: new Date().toISOString(),
        })
        .eq('project_id', projectId)
        .eq('section_key', sectionKey)

      if (error) {
        console.error('Error updating section status:', error)
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      console.error('Error in updateSectionStatus:', error)
      return { success: false, error: 'Failed to update section status' }
    }
  }

  async createDefaultSections(projectId: string): Promise<SectionsResponse> {
    try {
      const defaultSections = [
        { section_key: "abstract", title: "Abstract", order: 1 },
        { section_key: "introduction", title: "Introduction", order: 2 },
        { section_key: "literature", title: "Literature Review", order: 3 },
        { section_key: "methodology", title: "Methodology", order: 4 },
        { section_key: "results", title: "Results", order: 5 },
        { section_key: "discussion", title: "Discussion", order: 6 },
        { section_key: "conclusion", title: "Conclusion", order: 7 },
        { section_key: "references", title: "References", order: 8 },
      ]

      // Get current user
      const { data: { user } } = await this.supabase.auth.getUser()
      if (!user) {
        return { success: false, error: 'User not authenticated' }
      }

      const { data, error } = await this.supabase
        .from('paper_sections')
        .insert(
          defaultSections.map(section => ({
            project_id: projectId,
            user_id: user.id,
            section_key: section.section_key,
            title: section.title,
            order: section.order,
            status: 'pending' as SectionStatus,
            word_count: 0,
          }))
        )
        .select()

      if (error) {
        console.error('Error creating default sections:', error)
        return { success: false, error: error.message }
      }

      return { success: true, sections: data || [] }
    } catch (error) {
      console.error('Error in createDefaultSections:', error)
      return { success: false, error: 'Failed to create default sections' }
    }
  }

  // Check if any section has the given status
  async hasStatus(projectId: string, status: SectionStatus): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from('paper_sections')
        .select('id')
        .eq('project_id', projectId)
        .eq('status', status)
        .limit(1)

      if (error) {
        console.error('Error checking section status:', error)
        return false
      }

      return (data || []).length > 0
    } catch (error) {
      console.error('Error in hasStatus:', error)
      return false
    }
  }

  // 🔹 OPTIMIZED: Get lightweight section list (for sidebar)
  async getSectionList(projectId: string): Promise<SectionsResponse> {
    try {
      const { data, error } = await this.supabase
        .from('paper_sections')
        .select('id, section_key, title, order, status, word_count, updated_at')
        .eq('project_id', projectId)
        .order('order', { ascending: true })

      if (error) {
        console.error('Error fetching section list:', error)
        return { success: false, error: error.message }
      }

      return { success: true, sections: data || [] }
    } catch (error) {
      console.error('Error in getSectionList:', error)
      return { success: false, error: 'Failed to fetch section list' }
    }
  }

  // 🔹 OPTIMIZED: Get individual section content
  async getSectionContent(projectId: string, sectionKey: string): Promise<{ success: boolean; section?: Section; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('paper_sections')
        .select('*')
        .eq('project_id', projectId)
        .eq('section_key', sectionKey)
        .single()

      if (error) {
        console.error('Error fetching section content:', error)
        return { success: false, error: error.message }
      }

      return { success: true, section: data }
    } catch (error) {
      console.error('Error in getSectionContent:', error)
      return { success: false, error: 'Failed to fetch section content' }
    }
  }
}

// Export singleton instance
export const sectionsRepository = new SectionsRepository() 