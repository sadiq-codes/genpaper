| table_name                | column_name       | data_type                | is_nullable | column_default             |
| ------------------------- | ----------------- | ------------------------ | ----------- | -------------------------- |
| authors                   | id                | uuid                     | NO          | gen_random_uuid()          |
| authors                   | name              | text                     | NO          | null                       |
| block_citations           | id                | uuid                     | NO          | gen_random_uuid()          |
| block_citations           | block_id          | character                | YES         | null                       |
| block_citations           | citation_id       | uuid                     | YES         | null                       |
| block_citations           | doi               | text                     | YES         | null                       |
| block_citations           | title             | text                     | YES         | null                       |
| block_citations           | authors           | jsonb                    | YES         | null                       |
| block_citations           | year              | integer                  | YES         | null                       |
| block_citations           | journal           | text                     | YES         | null                       |
| block_citations           | citation_key      | text                     | NO          | null                       |
| block_citations           | position_start    | integer                  | YES         | null                       |
| block_citations           | position_end      | integer                  | YES         | null                       |
| block_citations           | created_at        | timestamp with time zone | YES         | now()                      |
| block_types               | type              | text                     | NO          | null                       |
| block_types               | description       | text                     | YES         | null                       |
| block_types               | created_at        | timestamp with time zone | YES         | now()                      |
| blocks                    | id                | character                | NO          | generate_ulid()            |
| blocks                    | document_id       | uuid                     | YES         | null                       |
| blocks                    | parent_id         | character                | YES         | null                       |
| blocks                    | type              | text                     | NO          | null                       |
| blocks                    | content           | jsonb                    | NO          | '{}'::jsonb                |
| blocks                    | position          | numeric                  | NO          | 0                          |
| blocks                    | metadata          | jsonb                    | YES         | '{}'::jsonb                |
| blocks                    | embedding         | USER-DEFINED             | YES         | null                       |
| blocks                    | created_at        | timestamp with time zone | YES         | now()                      |
| blocks                    | updated_at        | timestamp with time zone | YES         | now()                      |
| citation_links            | id                | uuid                     | NO          | gen_random_uuid()          |
| citation_links            | project_id        | uuid                     | YES         | null                       |
| citation_links            | citation_id       | uuid                     | YES         | null                       |
| citation_links            | section           | text                     | NO          | null                       |
| citation_links            | start_pos         | integer                  | YES         | null                       |
| citation_links            | end_pos           | integer                  | YES         | null                       |
| citation_links            | reason            | text                     | NO          | null                       |
| citation_links            | context           | text                     | YES         | null                       |
| citation_links            | created_at        | timestamp with time zone | NO          | now()                      |
| citation_links            | source_paper_id   | uuid                     | YES         | null                       |
| citations                 | id                | uuid                     | NO          | gen_random_uuid()          |
| citations                 | project_id        | uuid                     | YES         | null                       |
| citations                 | key               | text                     | NO          | null                       |
| citations                 | csl_json          | jsonb                    | NO          | null                       |
| citations                 | created_at        | timestamp with time zone | NO          | now()                      |
| citations                 | updated_at        | timestamp with time zone | NO          | now()                      |
| collection_papers         | collection_id     | uuid                     | NO          | null                       |
| collection_papers         | paper_id          | uuid                     | NO          | null                       |
| documents                 | id                | uuid                     | NO          | gen_random_uuid()          |
| documents                 | project_id        | uuid                     | YES         | null                       |
| documents                 | title             | text                     | NO          | null                       |
| documents                 | user_id           | uuid                     | YES         | null                       |
| documents                 | created_at        | timestamp with time zone | YES         | now()                      |
| documents                 | updated_at        | timestamp with time zone | YES         | now()                      |
| failed_chunks             | id                | uuid                     | NO          | gen_random_uuid()          |
| failed_chunks             | paper_id          | uuid                     | YES         | null                       |
| failed_chunks             | chunk_index       | integer                  | NO          | null                       |
| failed_chunks             | content           | text                     | NO          | null                       |
| failed_chunks             | error_message     | text                     | YES         | null                       |
| failed_chunks             | error_count       | integer                  | YES         | 1                          |
| failed_chunks             | last_attempt_at   | timestamp with time zone | YES         | now()                      |
| failed_chunks             | created_at        | timestamp with time zone | YES         | now()                      |
| library_collections       | id                | uuid                     | NO          | gen_random_uuid()          |
| library_collections       | user_id           | uuid                     | YES         | null                       |
| library_collections       | name              | text                     | NO          | null                       |
| library_collections       | description       | text                     | YES         | null                       |
| library_collections       | created_at        | timestamp with time zone | NO          | now()                      |
| library_paper_tags        | paper_id          | uuid                     | NO          | null                       |
| library_paper_tags        | tag_id            | uuid                     | NO          | null                       |
| library_papers            | id                | uuid                     | NO          | gen_random_uuid()          |
| library_papers            | user_id           | uuid                     | YES         | null                       |
| library_papers            | paper_id          | uuid                     | YES         | null                       |
| library_papers            | notes             | text                     | YES         | null                       |
| library_papers            | added_at          | timestamp with time zone | NO          | now()                      |
| paper_authors             | paper_id          | uuid                     | NO          | null                       |
| paper_authors             | author_id         | uuid                     | NO          | null                       |
| paper_authors             | ordinal           | smallint                 | YES         | null                       |
| paper_chunks              | id                | uuid                     | NO          | gen_random_uuid()          |
| paper_chunks              | paper_id          | uuid                     | YES         | null                       |
| paper_chunks              | chunk_index       | integer                  | NO          | null                       |
| paper_chunks              | content           | text                     | NO          | null                       |
| paper_chunks              | embedding         | USER-DEFINED             | YES         | null                       |
| paper_chunks              | created_at        | timestamp with time zone | YES         | now()                      |
| paper_chunks              | processing_status | text                     | YES         | 'completed'::text          |
| paper_chunks              | error_count       | integer                  | YES         | 0                          |
| paper_chunks              | last_error        | text                     | YES         | null                       |
| paper_chunks              | chunk_hash        | text                     | NO          | null                       |
| paper_references          | id                | uuid                     | NO          | gen_random_uuid()          |
| paper_references          | paper_id          | uuid                     | YES         | null                       |
| paper_references          | reference_csl     | jsonb                    | NO          | null                       |
| paper_references          | created_at        | timestamp with time zone | NO          | now()                      |
| paper_references          | updated_at        | timestamp with time zone | NO          | now()                      |
| papers                    | id                | uuid                     | NO          | gen_random_uuid()          |
| papers                    | title             | text                     | NO          | null                       |
| papers                    | abstract          | text                     | YES         | null                       |
| papers                    | publication_date  | date                     | YES         | null                       |
| papers                    | venue             | text                     | YES         | null                       |
| papers                    | doi               | text                     | YES         | null                       |
| papers                    | url               | text                     | YES         | null                       |
| papers                    | pdf_url           | text                     | YES         | null                       |
| papers                    | metadata          | jsonb                    | YES         | null                       |
| papers                    | source            | text                     | YES         | null                       |
| papers                    | citation_count    | integer                  | YES         | 0                          |
| papers                    | impact_score      | double precision         | YES         | null                       |
| papers                    | embedding         | USER-DEFINED             | YES         | null                       |
| papers                    | search_vector     | tsvector                 | YES         | null                       |
| papers                    | created_at        | timestamp with time zone | NO          | now()                      |
| papers                    | csl_json          | jsonb                    | YES         | null                       |
| papers                    | pdf_content       | text                     | YES         | null                       |
| papers                    | volume            | text                     | YES         | null                       |
| papers                    | issue             | text                     | YES         | null                       |
| papers                    | page_range        | text                     | YES         | null                       |
| papers                    | publisher         | text                     | YES         | null                       |
| papers                    | isbn              | text                     | YES         | null                       |
| papers                    | issn              | text                     | YES         | null                       |
| papers                    | content_source    | text                     | YES         | null                       |
| papers                    | content_quality   | double precision         | YES         | null                       |
| papers_api_cache          | id                | text                     | NO          | null                       |
| papers_api_cache          | response          | jsonb                    | NO          | null                       |
| papers_api_cache          | fetched_at        | timestamp with time zone | NO          | now()                      |
| papers_api_cache          | expires_at        | timestamp with time zone | NO          | null                       |
| papers_api_cache          | request_hash      | text                     | NO          | null                       |
| pdf_processing_logs       | id                | uuid                     | NO          | gen_random_uuid()          |
| pdf_processing_logs       | job_id            | text                     | NO          | null                       |
| pdf_processing_logs       | paper_id          | uuid                     | YES         | null                       |
| pdf_processing_logs       | pdf_url           | text                     | NO          | null                       |
| pdf_processing_logs       | user_id           | uuid                     | YES         | null                       |
| pdf_processing_logs       | status            | text                     | NO          | null                       |
| pdf_processing_logs       | attempts          | integer                  | YES         | 0                          |
| pdf_processing_logs       | error_message     | text                     | YES         | null                       |
| pdf_processing_logs       | extraction_result | jsonb                    | YES         | null                       |
| pdf_processing_logs       | metadata          | jsonb                    | YES         | null                       |
| pdf_processing_logs       | created_at        | timestamp with time zone | YES         | now()                      |
| pdf_processing_logs       | started_at        | timestamp with time zone | YES         | null                       |
| pdf_processing_logs       | completed_at      | timestamp with time zone | YES         | null                       |
| profiles                  | id                | uuid                     | NO          | null                       |
| profiles                  | email             | text                     | NO          | null                       |
| profiles                  | full_name         | text                     | YES         | null                       |
| profiles                  | created_at        | timestamp with time zone | NO          | now()                      |
| project_citations         | id                | uuid                     | NO          | gen_random_uuid()          |
| project_citations         | project_id        | uuid                     | YES         | null                       |
| project_citations         | version           | integer                  | NO          | null                       |
| project_citations         | paper_id          | uuid                     | YES         | null                       |
| project_citations         | block_id          | uuid                     | YES         | null                       |
| project_citations         | position_start    | integer                  | YES         | null                       |
| project_citations         | position_end      | integer                  | YES         | null                       |
| project_citations         | citation_text     | text                     | NO          | null                       |
| project_citations         | page_range        | int4range                | YES         | null                       |
| project_citations         | created_at        | timestamp with time zone | NO          | now()                      |
| research_project_versions | id                | uuid                     | NO          | gen_random_uuid()          |
| research_project_versions | project_id        | uuid                     | YES         | null                       |
| research_project_versions | version           | integer                  | NO          | null                       |
| research_project_versions | content           | text                     | YES         | null                       |
| research_project_versions | word_count        | integer                  | YES         | null                       |
| research_project_versions | created_at        | timestamp with time zone | NO          | now()                      |
| research_projects         | id                | uuid                     | NO          | gen_random_uuid()          |
| research_projects         | user_id           | uuid                     | YES         | null                       |
| research_projects         | topic             | text                     | NO          | null                       |
| research_projects         | status            | USER-DEFINED             | NO          | 'generating'::paper_status |
| research_projects         | generation_config | jsonb                    | YES         | null                       |
| research_projects         | created_at        | timestamp with time zone | NO          | now()                      |
| research_projects         | completed_at      | timestamp with time zone | YES         | null                       |
| tags                      | id                | uuid                     | NO          | gen_random_uuid()          |
| tags                      | user_id           | uuid                     | YES         | null                       |
| tags                      | name              | USER-DEFINED             | NO          | null                       |
| user_quotas               | id                | uuid                     | NO          | gen_random_uuid()          |
| user_quotas               | user_id           | uuid                     | YES         | null                       |
| user_quotas               | daily_pdf_limit   | integer                  | YES         | 50                         |
| user_quotas               | daily_pdf_used    | integer                  | YES         | 0                          |
| user_quotas               | monthly_ocr_limit | integer                  | YES         | 10                         |
| user_quotas               | monthly_ocr_used  | integer                  | YES         | 0                          |
| user_quotas               | last_reset        | timestamp with time zone | YES         | now()                      |
| user_quotas               | created_at        | timestamp with time zone | YES         | now()                      |
| user_quotas               | updated_at        | timestamp with time zone | YES         | now()                      |