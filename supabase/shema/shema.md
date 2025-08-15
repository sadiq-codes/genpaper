| table_name                | column_name         | data_type                | is_nullable | column_default             |
| ------------------------- | ------------------- | ------------------------ | ----------- | -------------------------- |
| authors                   | id                  | uuid                     | NO          | gen_random_uuid()          |
| authors                   | name                | text                     | NO          | null                       |
| collection_papers         | collection_id       | uuid                     | NO          | null                       |
| collection_papers         | paper_id            | uuid                     | NO          | null                       |
| failed_chunks             | id                  | uuid                     | NO          | gen_random_uuid()          |
| failed_chunks             | paper_id            | uuid                     | YES         | null                       |
| failed_chunks             | chunk_index         | integer                  | NO          | null                       |
| failed_chunks             | content             | text                     | NO          | null                       |
| failed_chunks             | error_message       | text                     | YES         | null                       |
| failed_chunks             | error_count         | integer                  | YES         | 1                          |
| failed_chunks             | last_attempt_at     | timestamp with time zone | YES         | now()                      |
| failed_chunks             | created_at          | timestamp with time zone | YES         | now()                      |
| library_collections       | id                  | uuid                     | NO          | gen_random_uuid()          |
| library_collections       | user_id             | uuid                     | YES         | null                       |
| library_collections       | name                | text                     | NO          | null                       |
| library_collections       | description         | text                     | YES         | null                       |
| library_collections       | created_at          | timestamp with time zone | NO          | now()                      |
| library_paper_tags        | paper_id            | uuid                     | NO          | null                       |
| library_paper_tags        | tag_id              | uuid                     | NO          | null                       |
| library_papers            | id                  | uuid                     | NO          | gen_random_uuid()          |
| library_papers            | user_id             | uuid                     | YES         | null                       |
| library_papers            | paper_id            | uuid                     | YES         | null                       |
| library_papers            | notes               | text                     | YES         | null                       |
| library_papers            | added_at            | timestamp with time zone | NO          | now()                      |
| paper_authors             | paper_id            | uuid                     | NO          | null                       |
| paper_authors             | author_id           | uuid                     | NO          | null                       |
| paper_authors             | ordinal             | smallint                 | YES         | null                       |
| paper_chunks              | id                  | uuid                     | NO          | gen_random_uuid()          |
| paper_chunks              | paper_id            | uuid                     | YES         | null                       |
| paper_chunks              | chunk_index         | integer                  | NO          | null                       |
| paper_chunks              | content             | text                     | NO          | null                       |
| paper_chunks              | embedding           | USER-DEFINED             | NO          | null                       |
| paper_chunks              | created_at          | timestamp with time zone | YES         | now()                      |
| paper_chunks              | processing_status   | text                     | YES         | 'completed'::text          |
| paper_chunks              | error_count         | integer                  | YES         | 0                          |
| paper_chunks              | last_error          | text                     | YES         | null                       |
| paper_chunks              | chunk_hash          | text                     | NO          | null                       |
| paper_references          | id                  | uuid                     | NO          | gen_random_uuid()          |
| paper_references          | paper_id            | uuid                     | YES         | null                       |
| paper_references          | reference_csl       | jsonb                    | NO          | null                       |
| paper_references          | created_at          | timestamp with time zone | NO          | now()                      |
| paper_references          | updated_at          | timestamp with time zone | NO          | now()                      |
| papers                    | id                  | uuid                     | NO          | gen_random_uuid()          |
| papers                    | title               | text                     | NO          | null                       |
| papers                    | abstract            | text                     | YES         | null                       |
| papers                    | publication_date    | date                     | YES         | null                       |
| papers                    | venue               | text                     | YES         | null                       |
| papers                    | doi                 | text                     | YES         | null                       |
| papers                    | url                 | text                     | YES         | null                       |
| papers                    | pdf_url             | text                     | YES         | null                       |
| papers                    | metadata            | jsonb                    | YES         | null                       |
| papers                    | source              | text                     | YES         | null                       |
| papers                    | citation_count      | integer                  | YES         | 0                          |
| papers                    | impact_score        | double precision         | YES         | null                       |
| papers                    | embedding           | USER-DEFINED             | NO          | null                       |
| papers                    | search_vector       | tsvector                 | YES         | null                       |
| papers                    | created_at          | timestamp with time zone | NO          | now()                      |
| papers                    | csl_json            | jsonb                    | YES         | null                       |
| papers                    | pdf_content         | text                     | YES         | null                       |
| papers                    | volume              | text                     | YES         | null                       |
| papers                    | issue               | text                     | YES         | null                       |
| papers                    | page_range          | text                     | YES         | null                       |
| papers                    | publisher           | text                     | YES         | null                       |
| papers                    | isbn                | text                     | YES         | null                       |
| papers                    | issn                | text                     | YES         | null                       |
| papers                    | content_source      | text                     | YES         | null                       |
| papers                    | content_quality     | double precision         | YES         | null                       |
| papers_api_cache          | id                  | text                     | NO          | null                       |
| papers_api_cache          | response            | jsonb                    | NO          | null                       |
| papers_api_cache          | fetched_at          | timestamp with time zone | NO          | now()                      |
| papers_api_cache          | expires_at          | timestamp with time zone | NO          | null                       |
| papers_api_cache          | request_hash        | text                     | NO          | null                       |
| pdf_processing_logs       | id                  | uuid                     | NO          | gen_random_uuid()          |
| pdf_processing_logs       | job_id              | text                     | NO          | null                       |
| pdf_processing_logs       | paper_id            | uuid                     | YES         | null                       |
| pdf_processing_logs       | pdf_url             | text                     | NO          | null                       |
| pdf_processing_logs       | user_id             | uuid                     | YES         | null                       |
| pdf_processing_logs       | status              | text                     | NO          | null                       |
| pdf_processing_logs       | attempts            | integer                  | YES         | 0                          |
| pdf_processing_logs       | error_message       | text                     | YES         | null                       |
| pdf_processing_logs       | extraction_result   | jsonb                    | YES         | null                       |
| pdf_processing_logs       | metadata            | jsonb                    | YES         | null                       |
| pdf_processing_logs       | created_at          | timestamp with time zone | YES         | now()                      |
| pdf_processing_logs       | started_at          | timestamp with time zone | YES         | null                       |
| pdf_processing_logs       | completed_at        | timestamp with time zone | YES         | null                       |
| profiles                  | id                  | uuid                     | NO          | null                       |
| profiles                  | email               | text                     | NO          | null                       |
| profiles                  | full_name           | text                     | YES         | null                       |
| profiles                  | created_at          | timestamp with time zone | NO          | now()                      |
| project_citations         | id                  | uuid                     | NO          | gen_random_uuid()          |
| project_citations         | project_id          | uuid                     | NO          | null                       |
| project_citations         | paper_id            | uuid                     | NO          | null                       |
| project_citations         | number              | integer                  | NO          | null                       |
| project_citations         | csl_json            | jsonb                    | NO          | null                       |
| project_citations         | reason              | text                     | NO          | null                       |
| project_citations         | quote               | text                     | YES         | null                       |
| project_citations         | created_at          | timestamp with time zone | NO          | now()                      |
| research_projects         | id                  | uuid                     | NO          | gen_random_uuid()          |
| research_projects         | user_id             | uuid                     | YES         | null                       |
| research_projects         | topic               | text                     | NO          | null                       |
| research_projects         | status              | USER-DEFINED             | NO          | 'generating'::paper_status |
| research_projects         | generation_config   | jsonb                    | YES         | null                       |
| research_projects         | created_at          | timestamp with time zone | NO          | now()                      |
| research_projects         | completed_at        | timestamp with time zone | YES         | null                       |
| research_projects         | content             | text                     | YES         | null                       |
| tags                      | id                  | uuid                     | NO          | gen_random_uuid()          |
| tags                      | user_id             | uuid                     | YES         | null                       |
| tags                      | name                | USER-DEFINED             | NO          | null                       |
| user_quotas               | id                  | uuid                     | NO          | gen_random_uuid()          |
| user_quotas               | user_id             | uuid                     | YES         | null                       |
| user_quotas               | daily_pdf_limit     | integer                  | YES         | 50                         |
| user_quotas               | daily_pdf_used      | integer                  | YES         | 0                          |
| user_quotas               | monthly_ocr_limit   | integer                  | YES         | 10                         |
| user_quotas               | monthly_ocr_used    | integer                  | YES         | 0                          |
| user_quotas               | last_reset          | timestamp with time zone | YES         | now()                      |
| user_quotas               | created_at          | timestamp with time zone | YES         | now()                      |
| user_quotas               | updated_at          | timestamp with time zone | YES         | now()                      |
| vector_search_performance | schemaname          | name                     | YES         | null                       |
| vector_search_performance | table_name          | name                     | YES         | null                       |
| vector_search_performance | index_name          | name                     | YES         | null                       |
| vector_search_performance | searches_performed  | bigint                   | YES         | null                       |
| vector_search_performance | rows_examined       | bigint                   | YES         | null                       |
| vector_search_performance | rows_returned       | bigint                   | YES         | null                       |
| vector_search_performance | avg_rows_per_search | numeric                  | YES         | null                       |