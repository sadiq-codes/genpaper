You're absolutely right to think about reusing existing code—it's often more efficient to build upon what you have! We can definitely integrate your new sophisticated UI (`ProjectWorkspace.tsx`) with the existing backend logic and Supabase setup from your MVP, adapting and enhancing as needed.

Here's the **High-Level Architecture of the Integration**:

Your goal is to replace the current server-rendered project page with the highly interactive, client-side `ProjectWorkspace.tsx`. This involves shifting how data is fetched, how UI state is managed for the workspace, and how backend actions (especially AI interactions) are triggered and their results displayed.

**1. Core Shift: From Server Component to Rich Client Component for Workspace**

* **Current MVP:** `app/(dashboard)/projects/[projectId]/page.tsx` is likely a Server Component that fetches data and renders UI like `PaperEditor`, `CitationViewer`, etc.
* **New Architecture:**
    * The route `app/(dashboard)/projects/[projectId]/page.tsx` will still be a **Server Component**, but its primary role will be to perform initial data fetching (e.g., basic project details, user authentication) and then render the **`<ProjectWorkspace />` client component**, passing this initial data as props. This ensures a fast initial load and SEO benefits if applicable, while enabling rich client-side interactivity.
    * The new `ProjectWorkspace.tsx` (marked `"use client"`) will be responsible for:
        * Rendering the entire three-column layout (Outline, SmartEditor, Citation Manager) and all interactive elements (AI suggestion overlays, context menus, AI chat).
        * Managing its own extensive UI state using React hooks (`useState`, `useEffect`, `useRef`, etc.).
        * Fetching additional dynamic data or updates after the initial load if necessary (e.g., using `useEffect` with the Supabase client).

**2. Data Flow and Backend Interactions:**

* **Initial Data Load:**
    * The parent `page.tsx` (Server Component) fetches essential project data (e.g., project ID, title, initial content for the active section, user details) from Supabase.
    * This data is passed as props to `<ProjectWorkspace />`.
* **Real-time Content Saving (Editor):**
    * The `ProjectWorkspace.tsx` will use its `saveContent` function (triggered by `handleContentChange` with a debounce).
    * This `saveContent` will call a **Next.js Server Action** (adapted from your old `saveSectionContent` or a new one like `updateSectionContent`). This action will:
        * Authenticate the user.
        * Update the specific section's content in the `paper_sections` table in Supabase (requires the schema change from CWS-06).
* **Triggering AI Actions (from `ProjectWorkspace.tsx`):**
    * **Non-Streaming AI Actions:** For contextual actions like "Rephrase selected text," "Summarize," "Check Cohesion," or simpler AI suggestions that don't require continuous output, `ProjectWorkspace.tsx` will call **Next.js Server Actions.**
        * These Server Actions will interact with your `lib/ai/sdk.ts` and `lib/ai/prompts.ts` to get results from the LLM and can update Supabase if needed.
        * *Reusability:* Your existing Server Actions like `generateAndSaveOutline` can be called directly from buttons in the new UI.
    * **Streaming AI Actions:** For features like streaming AI text suggestions directly into the editor, or the AI Assistant chat responses, `ProjectWorkspace.tsx` will make `fetch` requests to dedicated **Next.js API Routes** (e.g., `app/api/ai/stream-text`, `app/api/ai/chat`).
        * These API Routes will use the AI SDK's streaming capabilities and send data back as a stream.
    * **Long-Running AI Tasks** (e.g., "Generate Full Draft," "Analyze Paper Gaps," "Automated Literature Review Synthesis"):
        * The UI will trigger these via a Server Action or an API Route.
        * This backend endpoint will enqueue a job with your **AI Task Orchestrator Service** (as outlined in the gap analysis/updated architecture – potentially using Supabase Queues or BullMQ).
        * The orchestrator will process the job asynchronously.
        * The frontend will receive updates via a **Notification Service** (e.g., using Supabase Realtime or SSE).
* **Citation Management:**
    * The `CitationManager` section in `ProjectWorkspace.tsx` will:
        * Fetch structured citations from your new `citations` and `reference_links` tables in Supabase.
        * Trigger AI-driven literature searches (via Server Action/API Route calling the `literatureSearch` tool).
        * Allow manual addition/editing of citations (saving via Server Actions).
        * Interface with a "Citation Service" (can be a Server Action or API route calling `lib/ai/tools/citationFormatter.ts`) for bibliography formatting.
    * *Reusability:* The logic in `extractAndSaveCitations` and `generatePlaceholderReferences` (from your old code) that deals with `citations_identified` and `references_list` on the main `projects` table will likely be phased out or heavily adapted to work with the new structured `citations` and `reference_links` tables. The core idea of extracting placeholders can be reused, but the saving mechanism will target the new schema.

**3. Component Reusability & Evolution:**

* **`ProjectPage.tsx` (Old Server Component):** Its role as the main UI renderer for this route is taken over by `ProjectWorkspace.tsx`. It becomes a leaner Server Component, mainly for initial data fetching and rendering the client component.
* **Server Actions (from old `actions.ts`):**
    * `generateAndSaveOutline`: High reusability.
    * `saveSectionContent`: High reusability, but will target the `paper_sections` table.
    * `extractAndSaveCitations`: The *concept* of extracting placeholders is reusable. The *implementation* needs to be updated to work with the AI suggesting structured citations and saving them to the new `citations` and `reference_links` tables, rather than just a string array in `projects.citations_identified`.
    * `generatePlaceholderReferences`: Similar to above, its output target will change to reflect structured data from the new `citations` table, eventually being replaced by proper bibliography generation.
    * `generateAndSaveFullPaper`, `saveFullPaperContent`: The triggering UI moves to `ProjectWorkspace.tsx`. The backend Server Action that calls the `/api/research/generate/full-paper` can still be used. The API route itself will be the one handling the complex AI orchestration.
* **UI Components (`PaperEditor`, `CitationViewer`, etc. from old `components/`):**
    * These specific components, as rendered directly by the old `ProjectPage.tsx`, will likely be retired.
    * Their *functionality and visual intent* will be integrated into the new, more complex components within `ProjectWorkspace.tsx` (e.g., the main editor area in `ProjectWorkspace` *is* the new "SmartEditor," the right sidebar *is* the new "Citation Manager").
    * For instance, the `PaperEditor`'s logic of displaying outline and content will be handled by the respective panels within `ProjectWorkspace.tsx`.

**4. Database Schema:**

* The integration heavily relies on the **database schema evolution** previously discussed:
    * Adding new fields to the `projects` table.
    * Creating the `paper_sections` table (crucial for the new editor experience).
    * Creating the `citations`, `reference_links`, and `formatted_references` tables for advanced citation management.
    * Creating `activity_log`, `ai_jobs`, `project_collaborators`, etc., for other advanced features shown in the new UI.

**In summary, the integration strategy is:**

1.  **Elevate `ProjectWorkspace.tsx`** to be the main client-rendered UI for the project view, hydrated with initial data from a parent Server Component.
2.  **Adapt and reuse existing Server Actions** for data mutations where they still fit (e.g., saving, outline generation).
3.  **Introduce new Server Actions and API Routes** to handle the richer set of AI interactions (contextual actions, chat, streaming, long-running jobs) initiated from `ProjectWorkspace.tsx`.
4.  **Implement the necessary Supabase schema changes** to support the detailed data requirements of the new UI (per-section content, structured citations, etc.).
5.  The specific UI rendering components from the old `ProjectPage` structure will be superseded by the more integrated design of `ProjectWorkspace.tsx`.

This approach allows you to leverage your existing backend logic where appropriate while building a much more dynamic and feature-rich frontend experience.