| table_name        | column_name       | data_type                | is_nullable | column_default     |
| ----------------- | ----------------- | ------------------------ | ----------- | ------------------ |
| library_papers    | id                | uuid                     | NO          | gen_random_uuid()  |
| library_papers    | user_id           | uuid                     | NO          | null               |
| library_papers    | paper_id          | uuid                     | NO          | null               |
| library_papers    | collection        | text                     | YES         | null               |
| library_papers    | tags              | ARRAY                    | YES         | null               |
| library_papers    | notes             | text                     | YES         | null               |
| library_papers    | added_at          | timestamp with time zone | NO          | now()              |
| paper_chunks      | id                | uuid                     | NO          | gen_random_uuid()  |
| paper_chunks      | paper_id          | uuid                     | NO          | null               |
| paper_chunks      | content           | text                     | NO          | null               |
| paper_chunks      | embedding         | USER-DEFINED             | NO          | null               |
| paper_chunks      | chunk_index       | integer                  | NO          | null               |
| paper_chunks      | created_at        | timestamp with time zone | YES         | now()              |
| papers            | id                | uuid                     | NO          | gen_random_uuid()  |
| papers            | title             | text                     | NO          | null               |
| papers            | abstract          | text                     | YES         | null               |
| papers            | authors           | jsonb                    | YES         | null               |
| papers            | publication_date  | date                     | YES         | null               |
| papers            | venue             | text                     | YES         | null               |
| papers            | doi               | text                     | YES         | null               |
| papers            | pdf_url           | text                     | YES         | null               |
| papers            | pdf_content       | text                     | YES         | null               |
| papers            | source            | text                     | YES         | null               |
| papers            | citation_count    | integer                  | YES         | 0                  |
| papers            | embedding         | USER-DEFINED             | NO          | null               |
| papers            | created_at        | timestamp with time zone | NO          | now()              |
| processing_logs   | id                | uuid                     | NO          | gen_random_uuid()  |
| processing_logs   | paper_id          | uuid                     | YES         | null               |
| processing_logs   | operation_type    | text                     | NO          | null               |
| processing_logs   | status            | text                     | NO          | null               |
| processing_logs   | error_message     | text                     | YES         | null               |
| processing_logs   | metadata          | jsonb                    | YES         | null               |
| processing_logs   | created_at        | timestamp with time zone | YES         | now()              |
| processing_logs   | completed_at      | timestamp with time zone | YES         | null               |
| profiles          | id                | uuid                     | NO          | null               |
| profiles          | email             | text                     | NO          | null               |
| profiles          | full_name         | text                     | YES         | null               |
| profiles          | created_at        | timestamp with time zone | NO          | now()              |
| project_citations | id                | uuid                     | NO          | gen_random_uuid()  |
| project_citations | project_id        | uuid                     | NO          | null               |
| project_citations | paper_id          | uuid                     | NO          | null               |
| project_citations | citation_number   | integer                  | YES         | null               |
| project_citations | reason            | text                     | YES         | null               |
| project_citations | quote             | text                     | YES         | null               |
| project_citations | csl_json          | jsonb                    | YES         | null               |
| project_citations | created_at        | timestamp with time zone | YES         | now()              |
| research_projects | id                | uuid                     | NO          | gen_random_uuid()  |
| research_projects | user_id           | uuid                     | NO          | null               |
| research_projects | topic             | text                     | NO          | null               |
| research_projects | status            | text                     | YES         | 'generating'::text |
| research_projects | content           | text                     | YES         | null               |
| research_projects | generation_config | jsonb                    | YES         | null               |
| research_projects | created_at        | timestamp with time zone | NO          | now()              |
| research_projects | completed_at      | timestamp with time zone | YES         | null               |