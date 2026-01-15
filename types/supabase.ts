export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      chunk_citation_log: {
        Row: {
          chunk_id: string
          created_at: string | null
          id: string
          paper_id: string
          project_id: string
          query_context: string | null
          section_type: string | null
          was_cited: boolean | null
        }
        Insert: {
          chunk_id: string
          created_at?: string | null
          id?: string
          paper_id: string
          project_id: string
          query_context?: string | null
          section_type?: string | null
          was_cited?: boolean | null
        }
        Update: {
          chunk_id?: string
          created_at?: string | null
          id?: string
          paper_id?: string
          project_id?: string
          query_context?: string | null
          section_type?: string | null
          was_cited?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "chunk_citation_log_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "paper_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chunk_citation_log_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chunk_citation_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "research_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      citations: {
        Row: {
          citation_number: number | null
          citation_text: string | null
          context: string | null
          created_at: string | null
          csl_json: Json | null
          first_seen_order: number | null
          id: string
          key: string
          paper_id: string | null
          project_id: string
          updated_at: string | null
        }
        Insert: {
          citation_number?: number | null
          citation_text?: string | null
          context?: string | null
          created_at?: string | null
          csl_json?: Json | null
          first_seen_order?: number | null
          id?: string
          key: string
          paper_id?: string | null
          project_id: string
          updated_at?: string | null
        }
        Update: {
          citation_number?: number | null
          citation_text?: string | null
          context?: string | null
          created_at?: string | null
          csl_json?: Json | null
          first_seen_order?: number | null
          id?: string
          key?: string
          paper_id?: string | null
          project_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "citations_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "citations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "research_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          content: string | null
          created_at: string | null
          id: string
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          id?: string
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          content?: string | null
          created_at?: string | null
          id?: string
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      library_papers: {
        Row: {
          added_at: string
          collection: string | null
          id: string
          notes: string | null
          paper_id: string
          tags: string[] | null
          user_id: string
        }
        Insert: {
          added_at?: string
          collection?: string | null
          id?: string
          notes?: string | null
          paper_id: string
          tags?: string[] | null
          user_id: string
        }
        Update: {
          added_at?: string
          collection?: string | null
          id?: string
          notes?: string | null
          paper_id?: string
          tags?: string[] | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_papers_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_chunks: {
        Row: {
          chunk_index: number
          content: string
          content_tsv: unknown
          created_at: string | null
          embedding: string
          id: string
          metadata: Json | null
          paper_id: string
        }
        Insert: {
          chunk_index: number
          content: string
          content_tsv?: unknown
          created_at?: string | null
          embedding: string
          id?: string
          metadata?: Json | null
          paper_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          content_tsv?: unknown
          created_at?: string | null
          embedding?: string
          id?: string
          metadata?: Json | null
          paper_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_chunks_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_claims: {
        Row: {
          claim_text: string
          claim_type: string | null
          confidence: number | null
          created_at: string | null
          embedding: string | null
          evidence_quote: string | null
          id: string
          metadata: Json | null
          paper_id: string
          section: string | null
        }
        Insert: {
          claim_text: string
          claim_type?: string | null
          confidence?: number | null
          created_at?: string | null
          embedding?: string | null
          evidence_quote?: string | null
          id?: string
          metadata?: Json | null
          paper_id: string
          section?: string | null
        }
        Update: {
          claim_text?: string
          claim_type?: string | null
          confidence?: number | null
          created_at?: string | null
          embedding?: string | null
          evidence_quote?: string | null
          id?: string
          metadata?: Json | null
          paper_id?: string
          section?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paper_claims_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      papers: {
        Row: {
          abstract: string | null
          authors: Json | null
          citation_count: number | null
          created_at: string
          doi: string | null
          embedding: string
          id: string
          pdf_content: string | null
          pdf_url: string | null
          publication_date: string | null
          source: string | null
          title: string
          url: string | null
          venue: string | null
        }
        Insert: {
          abstract?: string | null
          authors?: Json | null
          citation_count?: number | null
          created_at?: string
          doi?: string | null
          embedding: string
          id?: string
          pdf_content?: string | null
          pdf_url?: string | null
          publication_date?: string | null
          source?: string | null
          title: string
          url?: string | null
          venue?: string | null
        }
        Update: {
          abstract?: string | null
          authors?: Json | null
          citation_count?: number | null
          created_at?: string
          doi?: string | null
          embedding?: string
          id?: string
          pdf_content?: string | null
          pdf_url?: string | null
          publication_date?: string | null
          source?: string | null
          title?: string
          url?: string | null
          venue?: string | null
        }
        Relationships: []
      }
      processing_logs: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          metadata: Json | null
          operation_type: string
          paper_id: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          operation_type: string
          paper_id?: string | null
          status: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          operation_type?: string
          paper_id?: string | null
          status?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      project_analysis: {
        Row: {
          analysis_type: string
          completed_at: string | null
          created_at: string | null
          id: string
          markdown_output: string | null
          metadata: Json | null
          project_id: string
          status: string | null
          structured_output: Json | null
        }
        Insert: {
          analysis_type: string
          completed_at?: string | null
          created_at?: string | null
          id?: string
          markdown_output?: string | null
          metadata?: Json | null
          project_id: string
          status?: string | null
          structured_output?: Json | null
        }
        Update: {
          analysis_type?: string
          completed_at?: string | null
          created_at?: string | null
          id?: string
          markdown_output?: string | null
          metadata?: Json | null
          project_id?: string
          status?: string | null
          structured_output?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "project_analysis_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "research_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_citations: {
        Row: {
          citation_number: number | null
          cite_key: string | null
          created_at: string | null
          csl_json: Json | null
          first_seen_order: number | null
          id: string
          paper_id: string
          project_id: string
          quote: string | null
          reason: string | null
          updated_at: string | null
        }
        Insert: {
          citation_number?: number | null
          cite_key?: string | null
          created_at?: string | null
          csl_json?: Json | null
          first_seen_order?: number | null
          id?: string
          paper_id: string
          project_id: string
          quote?: string | null
          reason?: string | null
          updated_at?: string | null
        }
        Update: {
          citation_number?: number | null
          cite_key?: string | null
          created_at?: string | null
          csl_json?: Json | null
          first_seen_order?: number | null
          id?: string
          paper_id?: string
          project_id?: string
          quote?: string | null
          reason?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      project_evidence_usage: {
        Row: {
          content_hash: string
          content_preview: string | null
          created_at: string
          id: string
          paper_id: string
          project_id: string
          section_title: string
        }
        Insert: {
          content_hash: string
          content_preview?: string | null
          created_at?: string
          id?: string
          paper_id: string
          project_id: string
          section_title: string
        }
        Update: {
          content_hash?: string
          content_preview?: string | null
          created_at?: string
          id?: string
          paper_id?: string
          project_id?: string
          section_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_evidence_usage_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_evidence_usage_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "research_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      research_gaps: {
        Row: {
          confidence: number | null
          created_at: string | null
          description: string
          evidence: Json
          gap_type: string
          id: string
          project_id: string
          supporting_paper_ids: string[] | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          description: string
          evidence?: Json
          gap_type: string
          id?: string
          project_id: string
          supporting_paper_ids?: string[] | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          description?: string
          evidence?: Json
          gap_type?: string
          id?: string
          project_id?: string
          supporting_paper_ids?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "research_gaps_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "research_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      research_projects: {
        Row: {
          analysis_status: string | null
          citation_style: string | null
          completed_at: string | null
          content: string | null
          created_at: string
          generation_config: Json | null
          generation_lock_at: string | null
          generation_lock_id: string | null
          has_original_research: boolean | null
          id: string
          key_findings: string | null
          paper_type: string | null
          research_question: string | null
          status: string | null
          topic: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          analysis_status?: string | null
          citation_style?: string | null
          completed_at?: string | null
          content?: string | null
          created_at?: string
          generation_config?: Json | null
          generation_lock_at?: string | null
          generation_lock_id?: string | null
          has_original_research?: boolean | null
          id?: string
          key_findings?: string | null
          paper_type?: string | null
          research_question?: string | null
          status?: string | null
          topic: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          analysis_status?: string | null
          citation_style?: string | null
          completed_at?: string | null
          content?: string | null
          created_at?: string
          generation_config?: Json | null
          generation_lock_at?: string | null
          generation_lock_id?: string | null
          has_original_research?: boolean | null
          id?: string
          key_findings?: string | null
          paper_type?: string | null
          research_question?: string | null
          status?: string | null
          topic?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          citation_style: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          citation_style?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          citation_style?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      chunk_citation_stats: {
        Row: {
          chunk_id: string | null
          paper_id: string | null
          recency_weighted_citations: number | null
          section_diversity: number | null
          total_citations: number | null
          unique_projects: number | null
        }
        Relationships: [
          {
            foreignKeyName: "chunk_citation_log_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "paper_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chunk_citation_log_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      add_citation_unified: {
        Args: {
          p_csl_json: Json
          p_paper_id: string
          p_project_id: string
          p_quote?: string
          p_reason?: string
        }
        Returns: {
          citation_number: number
          cite_key: string
          is_new: boolean
          result_csl_json: Json
        }[]
      }
      build_csl_json_from_paper: { Args: { p_paper_id: string }; Returns: Json }
      clear_project_evidence: {
        Args: { p_project_id: string }
        Returns: number
      }
      find_similar_papers: {
        Args: {
          match_count: number
          min_year?: number
          query_embedding: string
        }
        Returns: {
          abstract: string
          doi: string
          id: string
          pdf_url: string
          publication_date: string
          semantic_score: number
          title: string
          venue: string
        }[]
      }
      get_evidence_stats: {
        Args: { p_project_id: string }
        Returns: {
          papers_used: number
          section_usage: Json
          sections_count: number
          total_used: number
        }[]
      }
      get_project_citation_style: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: string
      }
      get_project_citations_unified: {
        Args: { p_project_id: string }
        Returns: {
          citation_number: number
          cite_key: string
          created_at: string
          csl_json: Json
          id: string
          paper_id: string
          quote: string
          reason: string
        }[]
      }
      get_user_library_stats: { Args: { p_user_id: string }; Returns: Json }
      hybrid_search_chunks: {
        Args: {
          match_count?: number
          min_vector_score?: number
          paper_ids?: string[]
          query_embedding: string
          search_query: string
          vector_weight?: number
        }
        Returns: {
          chunk_index: number
          combined_score: number
          content: string
          id: string
          keyword_score: number
          paper_id: string
          vector_score: number
        }[]
      }
      hybrid_search_chunks_with_boost: {
        Args: {
          citation_boost?: number
          match_count?: number
          min_vector_score?: number
          paper_ids?: string[]
          query_embedding: string
          search_query: string
          vector_weight?: number
        }
        Returns: {
          chunk_index: number
          citation_boost_applied: number
          combined_score: number
          content: string
          id: string
          keyword_score: number
          paper_id: string
          vector_score: number
        }[]
      }
      hybrid_search_papers: {
        Args: {
          match_count: number
          min_year?: number
          query_embedding: string
          query_text: string
          semantic_weight?: number
        }
        Returns: {
          abstract: string
          combined_score: number
          doi: string
          id: string
          keyword_score: number
          pdf_url: string
          publication_date: string
          semantic_score: number
          title: string
          venue: string
        }[]
      }
      is_evidence_used: {
        Args: {
          p_content_hash: string
          p_paper_id: string
          p_project_id: string
        }
        Returns: boolean
      }
      keyword_search_chunks: {
        Args: {
          match_count?: number
          paper_ids?: string[]
          search_query: string
        }
        Returns: {
          chunk_index: number
          content: string
          id: string
          paper_id: string
          score: number
        }[]
      }
      log_chunk_citation: {
        Args: {
          p_chunk_id: string
          p_paper_id: string
          p_project_id: string
          p_query_context?: string
          p_section_type?: string
        }
        Returns: undefined
      }
      match_paper_chunks: {
        Args: {
          match_count: number
          min_score?: number
          paper_ids?: string[]
          query_embedding: string
        }
        Returns: {
          chunk_index: number
          content: string
          id: string
          paper_id: string
          score: number
        }[]
      }
      match_paper_claims: {
        Args: {
          match_count?: number
          paper_ids: string[]
          query_embedding: string
        }
        Returns: {
          claim_text: string
          claim_type: string
          confidence: number
          evidence_quote: string
          id: string
          paper_id: string
          section: string
          similarity: number
        }[]
      }
      refresh_chunk_citation_stats: { Args: never; Returns: undefined }
      semantic_search_papers: {
        Args: {
          match_count: number
          min_year?: number
          query_embedding: string
          query_text: string
        }
        Returns: {
          abstract: string
          combined_score: number
          doi: string
          id: string
          keyword_score: number
          pdf_url: string
          publication_date: string
          semantic_score: number
          title: string
          venue: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      track_evidence_usage: {
        Args: {
          p_content_hash: string
          p_content_preview?: string
          p_paper_id: string
          p_project_id: string
          p_section_title: string
        }
        Returns: string
      }
      upsert_user_preferences: {
        Args: { p_citation_style?: string; p_user_id: string }
        Returns: {
          citation_style: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "user_preferences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
