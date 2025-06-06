export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          operationName?: string
          query?: string
          variables?: Json
          extensions?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      authors: {
        Row: {
          id: string
          name: string
        }
        Insert: {
          id?: string
          name: string
        }
        Update: {
          id?: string
          name?: string
        }
        Relationships: []
      }
      citation_links: {
        Row: {
          citation_id: string | null
          context: string | null
          created_at: string
          end_pos: number
          id: string
          project_id: string | null
          reason: string
          section: string
          start_pos: number
        }
        Insert: {
          citation_id?: string | null
          context?: string | null
          created_at?: string
          end_pos: number
          id?: string
          project_id?: string | null
          reason: string
          section: string
          start_pos: number
        }
        Update: {
          citation_id?: string | null
          context?: string | null
          created_at?: string
          end_pos?: number
          id?: string
          project_id?: string | null
          reason?: string
          section?: string
          start_pos?: number
        }
        Relationships: [
          {
            foreignKeyName: "citation_links_citation_id_fkey"
            columns: ["citation_id"]
            isOneToOne: false
            referencedRelation: "citations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "citation_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "research_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      citations: {
        Row: {
          created_at: string
          csl_json: Json
          id: string
          key: string
          project_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          csl_json: Json
          id?: string
          key: string
          project_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          csl_json?: Json
          id?: string
          key?: string
          project_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "citations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "research_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_papers: {
        Row: {
          collection_id: string
          paper_id: string
        }
        Insert: {
          collection_id: string
          paper_id: string
        }
        Update: {
          collection_id?: string
          paper_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_collection_papers_collection"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "library_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_collection_papers_paper"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      failed_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string | null
          error_count: number | null
          error_message: string | null
          id: string
          last_attempt_at: string | null
          paper_id: string | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string | null
          error_count?: number | null
          error_message?: string | null
          id?: string
          last_attempt_at?: string | null
          paper_id?: string | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string | null
          error_count?: number | null
          error_message?: string | null
          id?: string
          last_attempt_at?: string | null
          paper_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "failed_chunks_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      library_collections: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      library_paper_tags: {
        Row: {
          paper_id: string
          tag_id: string
        }
        Insert: {
          paper_id: string
          tag_id: string
        }
        Update: {
          paper_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_library_paper_tags_paper"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "library_papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_library_paper_tags_tag"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      library_papers: {
        Row: {
          added_at: string
          id: string
          notes: string | null
          paper_id: string | null
          user_id: string | null
        }
        Insert: {
          added_at?: string
          id?: string
          notes?: string | null
          paper_id?: string | null
          user_id?: string | null
        }
        Update: {
          added_at?: string
          id?: string
          notes?: string | null
          paper_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_library_papers_paper"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_authors: {
        Row: {
          author_id: string
          ordinal: number | null
          paper_id: string
        }
        Insert: {
          author_id: string
          ordinal?: number | null
          paper_id: string
        }
        Update: {
          author_id?: string
          ordinal?: number | null
          paper_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_authors_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "authors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paper_authors_paper_id_fkey"
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
          created_at: string | null
          embedding: string | null
          error_count: number | null
          id: string
          last_error: string | null
          paper_id: string | null
          processing_status: string | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string | null
          embedding?: string | null
          error_count?: number | null
          id?: string
          last_error?: string | null
          paper_id?: string | null
          processing_status?: string | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string | null
          embedding?: string | null
          error_count?: number | null
          id?: string
          last_error?: string | null
          paper_id?: string | null
          processing_status?: string | null
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
      papers: {
        Row: {
          abstract: string | null
          citation_count: number | null
          created_at: string
          csl_json: Json | null
          doi: string | null
          embedding: string | null
          id: string
          impact_score: number | null
          metadata: Json | null
          pdf_url: string | null
          publication_date: string | null
          search_vector: unknown | null
          source: string | null
          title: string
          url: string | null
          venue: string | null
        }
        Insert: {
          abstract?: string | null
          citation_count?: number | null
          created_at?: string
          csl_json?: Json | null
          doi?: string | null
          embedding?: string | null
          id?: string
          impact_score?: number | null
          metadata?: Json | null
          pdf_url?: string | null
          publication_date?: string | null
          search_vector?: unknown | null
          source?: string | null
          title: string
          url?: string | null
          venue?: string | null
        }
        Update: {
          abstract?: string | null
          citation_count?: number | null
          created_at?: string
          csl_json?: Json | null
          doi?: string | null
          embedding?: string | null
          id?: string
          impact_score?: number | null
          metadata?: Json | null
          pdf_url?: string | null
          publication_date?: string | null
          search_vector?: unknown | null
          source?: string | null
          title?: string
          url?: string | null
          venue?: string | null
        }
        Relationships: []
      }
      papers_api_cache: {
        Row: {
          expires_at: string
          fetched_at: string
          id: string
          request_hash: string
          response: Json
        }
        Insert: {
          expires_at: string
          fetched_at?: string
          id: string
          request_hash: string
          response: Json
        }
        Update: {
          expires_at?: string
          fetched_at?: string
          id?: string
          request_hash?: string
          response?: Json
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
      project_citations: {
        Row: {
          block_id: string | null
          citation_text: string
          created_at: string
          id: string
          page_range: unknown | null
          paper_id: string | null
          position_end: number | null
          position_start: number | null
          project_id: string | null
          version: number
        }
        Insert: {
          block_id?: string | null
          citation_text: string
          created_at?: string
          id?: string
          page_range?: unknown | null
          paper_id?: string | null
          position_end?: number | null
          position_start?: number | null
          project_id?: string | null
          version: number
        }
        Update: {
          block_id?: string | null
          citation_text?: string
          created_at?: string
          id?: string
          page_range?: unknown | null
          paper_id?: string | null
          position_end?: number | null
          position_start?: number | null
          project_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_citations_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_citations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "research_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      research_project_versions: {
        Row: {
          content: string | null
          created_at: string
          id: string
          project_id: string | null
          version: number
          word_count: number | null
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          project_id?: string | null
          version: number
          word_count?: number | null
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          project_id?: string | null
          version?: number
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "research_project_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "research_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      research_projects: {
        Row: {
          completed_at: string | null
          created_at: string
          generation_config: Json | null
          id: string
          status: Database["public"]["Enums"]["paper_status"]
          topic: string
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          generation_config?: Json | null
          id?: string
          status?: Database["public"]["Enums"]["paper_status"]
          topic: string
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          generation_config?: Json | null
          id?: string
          status?: Database["public"]["Enums"]["paper_status"]
          topic?: string
          user_id?: string | null
        }
        Relationships: []
      }
      tags: {
        Row: {
          id: string
          name: string
          user_id: string | null
        }
        Insert: {
          id?: string
          name: string
          user_id?: string | null
        }
        Update: {
          id?: string
          name?: string
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      analyze_papers_table: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      citext: {
        Args: { "": boolean } | { "": string } | { "": unknown }
        Returns: string
      }
      citext_hash: {
        Args: { "": string }
        Returns: number
      }
      citextin: {
        Args: { "": unknown }
        Returns: string
      }
      citextout: {
        Args: { "": string }
        Returns: unknown
      }
      citextrecv: {
        Args: { "": unknown }
        Returns: string
      }
      citextsend: {
        Args: { "": string }
        Returns: string
      }
      cleanup_expired_cache: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      cleanup_old_pdfs: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      cleanup_successful_chunks: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      find_similar_papers: {
        Args: { source_paper_id: string; match_count?: number }
        Returns: {
          paper_id: string
          score: number
        }[]
      }
      generate_csl_json: {
        Args: { paper_row: Database["public"]["Tables"]["papers"]["Row"] }
        Returns: Json
      }
      get_cache_stats: {
        Args: Record<PropertyKey, never>
        Returns: {
          total_entries: number
          expired_entries: number
          valid_entries: number
          oldest_entry: string
          newest_entry: string
        }[]
      }
      get_paper_chunks: {
        Args: { paper_ids: string[]; match_count?: number }
        Returns: {
          paper_id: string
          chunk_index: number
          content: string
        }[]
      }
      get_project_citations: {
        Args: { p_project_id: string }
        Returns: {
          citation_id: string
          citation_key: string
          csl_json: Json
          links: Json
        }[]
      }
      hybrid_search_papers: {
        Args: {
          query_embedding: string
          query_text: string
          match_count?: number
          min_year?: number
          semantic_weight?: number
        }
        Returns: {
          paper_id: string
          semantic_score: number
          keyword_score: number
          combined_score: number
        }[]
      }
      match_paper_chunks: {
        Args: {
          query_embedding: string
          match_count?: number
          min_score?: number
        }
        Returns: {
          paper_id: string
          chunk_index: number
          content: string
          score: number
        }[]
      }
      match_papers: {
        Args: {
          query_embedding: string
          match_count?: number
          min_year?: number
        }
        Returns: {
          paper_id: string
          score: number
        }[]
      }
      retry_failed_chunks: {
        Args: Record<PropertyKey, never>
        Returns: {
          paper_id: string
          chunk_index: number
          content: string
          retry_count: number
        }[]
      }
      test_citation_constraints: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      upsert_citation: {
        Args: { p_project_id: string; p_key: string; p_data: Json }
        Returns: Json
      }
    }
    Enums: {
      paper_status: "generating" | "complete" | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      paper_status: ["generating", "complete", "failed"],
    },
  },
} as const
