// Database types for citation management

export interface Citation {
  id: string;
  project_id: string;
  doi?: string | null;
  title: string;
  authors: Array<{ name: string }>;
  year?: number | null;
  journal?: string | null;
  abstract?: string | null;
  source_type: string;
  source_url?: string | null;
  retrieved_at: string;
  created_at: string;
  updated_at: string;
}

export interface ReferenceLink {
  id: string;
  project_id: string;
  citation_id: string;
  text_segment?: string | null;
  placeholder_text?: string | null;
  section_name?: string | null;
  position_start?: number | null;
  position_end?: number | null;
  created_at: string;
  updated_at: string;
}

export interface FormattedReference {
  id: string;
  project_id: string;
  citation_id: string;
  citation_style: string;
  formatted_text: string;
  created_at: string;
  updated_at: string;
}

// Database insert types (without auto-generated fields)
export interface CitationInsert {
  project_id: string;
  doi?: string | null;
  title: string;
  authors: Array<{ name: string }>;
  year?: number | null;
  journal?: string | null;
  abstract?: string | null;
  source_type?: string;
  source_url?: string | null;
}

export interface ReferenceLinkInsert {
  project_id: string;
  citation_id: string;
  text_segment?: string | null;
  placeholder_text?: string | null;
  section_name?: string | null;
  position_start?: number | null;
  position_end?: number | null;
}

export interface FormattedReferenceInsert {
  project_id: string;
  citation_id: string;
  citation_style?: string;
  formatted_text: string;
}

// Structured citation data from AI processing
export interface StructuredCitationData {
  title: string;
  authors: Array<{ name: string }>;
  year?: number | null;
  doi?: string | null;
  source_url?: string | null;
  citation_placeholder: string; // e.g., "[CITE: DOI]" or "[CITE: Title]"
  relevance_explanation?: string;
  text_segment?: string; // The text that needs this citation
  section_name?: string; // Which section this citation appears in
} 