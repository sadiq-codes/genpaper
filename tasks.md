
## Advanced Features: Task Breakdown 🚀

We'll organize tasks into epics. For now, all tasks are in the **"Ready for Development"** state.

### Epic: Advanced Citation Management 📚

This epic focuses on moving beyond placeholder citations to robust, AI-assisted citation and reference management.

**Task ID: ACM-01**
* **Title:** Design Enhanced Supabase Schema for Structured Citations
* **Purpose:** To create the database structure necessary for storing detailed, structured citation information and linking it to project content.
* **Steps:**
    1.  Define fields for a `citations` table (e.g., `project_id`, `doi`, `title`, `authors` (JSONB), `year`, `journal`, `abstract`, `source_type`, `retrieved_at`).
    2.  Define fields for a `reference_links` table to link specific text segments or claims within `paper_sections` to entries in the `citations` table.
    3.  Define fields for storing formatted `references` within a project, possibly linked to a chosen citation style.
    4.  Write SQL migration scripts for these new tables and relationships.
* **Acceptance Criteria:**
    * New `citations`, `reference_links`, and project-level `references` (or similar) tables are created in Supabase via a migration.
    * Relationships (foreign keys) are correctly established between these tables and existing tables like `projects` and `paper_sections`.
    * RLS policies are considered and drafted for the new tables.
* **Estimated Effort:** M
* **Dependencies:** MVP Database Schema

**Task ID: ACM-02**
* **Title:** Implement Basic `literatureSearch` Tool Shell
* **Purpose:** To set up the foundational AI tool in `lib/ai/tools/literatureSearch.ts` that can be called by the AI, initially returning mock data.
* **Steps:**
    1.  Define the input parameters for the `literatureSearch` tool (e.g., `query: string`, `max_results: int`).
    2.  Define the expected output structure (e.g., an array of objects, each with `title`, `authors`, `year`, `abstract_snippet`, `source_url`, `doi`).
    3.  Implement the tool function to accept parameters and return a hardcoded list of 2-3 mock search results matching the defined output structure.
    4.  Ensure the tool is correctly described for the AI SDK (function name, description, parameters).
* **Acceptance Criteria:**
    * The `literatureSearch` tool can be invoked by the AI SDK (tested via a backend script or API route).
    * The tool returns the predefined mock search results in the correct format.
    * The AI (via logs or simple response) indicates it "received" the mock results.
* **Estimated Effort:** S
* **Dependencies:** MVP AI SDK setup (`lib/ai/sdk.ts`)

**Task ID: ACM-03**
* **Title:** Update AI Prompt to Request Literature Search via Tool
* **Purpose:** To modify an existing section generation prompt to instruct the AI to use the `literatureSearch` tool when it identifies a claim needing a citation.
* **Steps:**
    1.  Choose a section generation prompt (e.g., `USER_PROMPT_GENERATE_SECTION` in `lib/ai/prompts.ts`).
    2.  Update the prompt to explicitly ask the AI to:
        * Identify a specific claim.
        * Formulate a search query for that claim.
        * Call the `literatureSearch` tool with that query.
        * Initially, just report back the mock results it received (actual citation insertion will be a later task).
* **Acceptance Criteria:**
    * When the AI generates a section using the updated prompt, it attempts to call the `literatureSearch` tool (verified via backend logs).
    * The AI's response (or internal monologue if logged) indicates it has processed the (mock) results from the tool.
* **Estimated Effort:** S
* **Dependencies:** ACM-02

**Task ID: ACM-04**
* **Title:** Integrate Semantic Scholar API into `literatureSearch` Tool
* **Purpose:** To replace mock data in the `literatureSearch` tool with actual search results from the Semantic Scholar API.
* **Steps:**
    1.  Obtain a Semantic Scholar API key (if required) and add it to environment variables.
    2.  Modify `lib/ai/tools/literatureSearch.ts` to:
        * Accept the search query from the AI.
        * Make an API call to Semantic Scholar's public API using the query.
        * Parse the API response.
        * Transform the results into the standardized output format defined in ACM-02.
        * Implement basic error handling for API call failures.
* **Acceptance Criteria:**
    * When the `literatureSearch` tool is called with a test query, it successfully fetches results from Semantic Scholar.
    * The results are returned in the correct standardized format.
    * API errors (e.g., network issues, invalid query) are handled gracefully (e.g., return an empty array or an error message).
* **Estimated Effort:** M
* **Dependencies:** ACM-02, Semantic Scholar API access

**Task ID: ACM-05**
* **Title:** Update AI Prompt to Generate Structured Citation from Tool Results
* **Purpose:** To enable the AI to process actual literature search results and attempt to generate a structured citation object for one relevant source.
* **Steps:**
    1.  Update the section generation prompt (from ACM-03) or create a new one.
    2.  Instruct the AI to:
        * Call the `literatureSearch` tool.
        * Evaluate the returned search results.
        * Select the most relevant result for the claim it's trying to cite.
        * Extract information (authors, title, year, DOI) from the selected result.
        * Return this information as a **structured JSON object** (using the AI SDK's structured data generation capabilities).
        * Insert a simple placeholder like `[CITE: <DOI or Title>]` in the generated text.
* **Acceptance Criteria:**
    * When generating a section, the AI calls `literatureSearch` and receives real results.
    * The AI's output includes a structured JSON object representing a citation for at least one source.
    * The generated text includes a placeholder like `[CITE: ...]`.
* **Estimated Effort:** M
* **Dependencies:** ACM-03, ACM-04, AI SDK supports structured data generation.

**Task ID: ACM-06**
* **Title:** Save Structured Citation and Link to Project Content
* **Purpose:** To persist the AI-generated structured citation data into the new Supabase tables and link it to the generated text.
* **Steps:**
    1.  Modify the backend API route (e.g., `app/api/research/generate/section/route.ts`) that handles section generation.
    2.  When the AI returns a structured citation object and the text with `[CITE: ...]` placeholders:
        * Parse the structured citation JSON.
        * Save the citation details to the `citations` table in Supabase (handle potential duplicates based on DOI).
        * Identify the location of the `[CITE: ...]` placeholder in the generated text.
        * Create an entry in the `reference_links` table, linking the text segment (or an identifier for it) to the new `citations` table entry.
        * (Optional) Replace the `[CITE: ...]` placeholder with a more formal in-text citation marker if feasible at this stage.
* **Acceptance Criteria:**
    * A new record is created in the `citations` table with the correct structured data.
    * A corresponding record is created in the `reference_links` table.
    * The text saved to `paper_sections` either contains the updated marker or allows for later association.
* **Estimated Effort:** L
* **Dependencies:** ACM-01, ACM-05

**Task ID: ACM-07**
* **Title:** Implement Basic UI for Displaying Suggested Citations (`CitationManager.tsx`)
* **Purpose:** To provide a user interface where users can see the citations the AI has identified and linked to the text.
* **Steps:**
    1.  Modify `app/(dashboard)/projects/[projectId]/components/CitationManager.tsx`.
    2.  Fetch linked citations for the current project/section from Supabase (using `citations` and `reference_links` tables).
    3.  Display a list of these citations (e.g., title, authors, year).
    4.  (Optional) Highlight or allow navigation to the part of the text where the citation is relevant.
* **Acceptance Criteria:**
    * `CitationManager.tsx` correctly fetches and displays a list of structured citations associated with the project.
    * The displayed information is accurate based on what's in the database.
* **Estimated Effort:** M
* **Dependencies:** ACM-06

**Task ID: ACM-08**
* **Title:** Generate Basic Formatted Reference List (`ReferenceList.tsx`)
* **Purpose:** To display a simple, dynamically generated list of all unique cited works for the project.
* **Steps:**
    1.  Modify `app/(dashboard)/projects/[projectId]/components/ReferenceList.tsx`.
    2.  Fetch all unique entries from the `citations` table for the current project.
    3.  Display them as a numbered or bulleted list, formatted consistently (e.g., "Author(s). (Year). *Title*.").
    4.  (No complex APA/MLA formatting yet, just a clean, consistent presentation).
* **Acceptance Criteria:**
    * `ReferenceList.tsx` displays all unique citations saved for the project.
    * The list updates if new citations are added.
* **Estimated Effort:** M
* **Dependencies:** ACM-06

---
### Epic: Automated Literature Review Synthesis 📝

This epic aims to enable the AI to draft sections of a literature review by synthesizing information from multiple sources.

**Task ID: ALR-01**
* **Title:** Define AI Prompt for Multi-Document Summarization and Thematic Analysis
* **Purpose:** To create a sophisticated prompt that guides the AI to read several provided abstracts/text snippets and identify common themes or contrasting points.
* **Steps:**
    1.  Design a prompt in `lib/ai/prompts.ts` that accepts an array of text snippets (representing abstracts or key sections from multiple papers).
    2.  Instruct the AI to:
        * Identify 2-3 key themes or arguments present across the provided texts.
        * For each theme, list which texts support or discuss it.
        * (Optional) Identify any contrasting viewpoints.
        * Return this analysis as structured JSON.
* **Acceptance Criteria:**
    * Given a set of 3-5 sample abstracts, the AI (called via a backend test script) returns a structured JSON object accurately identifying common themes and the source snippets for each.
* **Estimated Effort:** M
* **Dependencies:** ACM-04 (to get multiple real abstracts for testing), AI SDK supports structured data generation.

**Task ID: ALR-02**
* **Title:** Implement "Synthesize Literature" API Endpoint
* **Purpose:** To create a backend endpoint that takes a topic or a list of document identifiers, fetches their content (e.g., abstracts), and uses the ALR-01 prompt to generate a thematic analysis.
* **Steps:**
    1.  Create a new API route, e.g., `app/api/research/synthesize/literature/route.ts`.
    2.  The endpoint should accept a `topic` or an array of `document_identifiers` (e.g., DOIs or internal IDs from a `literature_corpus` table if ACM-01 creates one).
    3.  If `topic`, use the `literatureSearch` tool to find relevant papers and get their abstracts. If `document_identifiers`, fetch their abstracts from Supabase (if stored) or externally.
    4.  Pass the collected abstracts to the AI using the prompt from ALR-01.
    5.  Return the AI's structured JSON analysis.
* **Acceptance Criteria:**
    * The API endpoint successfully retrieves abstracts for a given topic/set of IDs.
    * It calls the AI with the thematic analysis prompt.
    * It returns the structured JSON analysis from the AI.
* **Estimated Effort:** L
* **Dependencies:** ALR-01, ACM-04

**Task ID: ALR-03**
* **Title:** Develop UI for Initiating and Displaying Literature Synthesis
* **Purpose:** To allow users to trigger the literature synthesis process and view the results.
* **Steps:**
    1.  Add a new section/button in `app/(dashboard)/projects/[projectId]/page.tsx` or a dedicated "Literature Review" component.
    2.  Allow the user to input a sub-topic for synthesis.
    3.  On submission, call the API endpoint from ALR-02.
    4.  Display the returned structured JSON (themes, supporting sources) in a readable format.
* **Acceptance Criteria:**
    * User can input a sub-topic and trigger the synthesis.
    * The UI displays a loading state while waiting for the API.
    * The thematic analysis (themes and which papers support them) is clearly presented to the user.
* **Estimated Effort:** M
* **Dependencies:** ALR-02

**(Further tasks in this epic would involve the AI drafting actual literature review paragraphs based on this synthesis, incorporating citations, etc.)**

---
### Epic: Enhanced Writing & Editing Assistance ✍️

Focuses on making the AI a better writing partner by improving cohesion, style, and argumentation.

**Task ID: EWE-01**
* **Title:** Implement "Analyze Section Cohesion" AI Prompt
* **Purpose:** To create an AI prompt that evaluates a given text section for logical flow and connection between ideas.
* **Steps:**
    1.  Design a prompt in `lib/ai/prompts.ts` that takes a block of text (a generated section).
    2.  Instruct the AI to:
        * Assess the logical flow and transitions between sentences and paragraphs.
        * Identify any abrupt shifts or unclear connections.
        * Suggest specific areas for improvement or rephrasing to enhance cohesion.
        * Return feedback as structured JSON (e.g., array of suggestions with text snippets).
* **Acceptance Criteria:**
    * Given a sample text section (with some deliberate awkward transitions), the AI (called via a backend test script) returns structured feedback pinpointing cohesion issues and offering actionable suggestions.
* **Estimated Effort:** M
* **Dependencies:** AI SDK supports structured data generation.

**Task ID: EWE-02**
* **Title:** Add "Analyze Cohesion" Feature to Paper Editor
* **Purpose:** To allow users to get AI feedback on the cohesion of a generated or edited section.
* **Steps:**
    1.  Add an "Analyze Cohesion" button within the `PaperEditor.tsx` component or for a selected section.
    2.  When clicked, send the current section's text to a new API endpoint (e.g., `app/api/research/analyze/cohesion/route.ts`).
    3.  This API route will use the prompt from EWE-01 to get feedback.
    4.  Display the AI's cohesion feedback to the user (e.g., in a sidebar, as inline annotations if possible).
* **Acceptance Criteria:**
    * User can click the "Analyze Cohesion" button for a section.
    * AI-generated feedback on cohesion is displayed in a user-friendly way.
* **Estimated Effort:** M
* **Dependencies:** EWE-01

**(Further tasks: style adaptation, argument strength analysis, counter-argument suggestions.)**