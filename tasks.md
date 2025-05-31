Okay, let's break down the integration of your new `ProjectWorkspace.tsx` UI into a granular, step-by-step plan. This plan focuses on replacing the old project page structure and wiring up the new UI with essential functionalities, paving the way for the full advanced features.

All tasks are in **"Ready for Development."**

---

### Epic: Workspace Foundation & UI Integration 뼈대

This epic focuses on getting the new `ProjectWorkspace.tsx` rendering with basic project data and replacing the old project page.

**Task ID: WFI-00 (Prerequisite)**
* **Title:** Ensure UI Component Library & Icons are Installed
* **Purpose:** To confirm all necessary UI building blocks (`@/components/ui/...`) and `lucide-react` icons used in `ProjectWorkspace.tsx` are available in the project.
* **Steps:**
    1.  Review `ProjectWorkspace.tsx` for all imported components from `@/components/ui/` (e.g., `Button`, `Card`, `Input`, `Textarea`, `Badge`, `Avatar`, `Progress`).
    2.  If using Shadcn/UI, ensure these components have been added to your project (`npx shadcn-ui@latest add ...`).
    3.  Verify `lucide-react` is installed.
* **Acceptance Criteria:**
    * All UI primitive components and icon libraries referenced in `ProjectWorkspace.tsx` are correctly installed and importable.
* **Estimated Effort:** S
* **Dependencies:** None (but essential for next tasks).

**Task ID: WFI-01**
* **Title:** Adapt `app/(dashboard)/projects/[projectId]/page.tsx` to Render `ProjectWorkspace.tsx`
* **Purpose:** To make the new `ProjectWorkspace.tsx` the primary client component for viewing a single project, receiving initial data from a parent server component.
* **Steps:**
    1.  Modify the existing `app/(dashboard)/projects/[projectId]/page.tsx` (which is currently a Server Component, as per your "old code").
    2.  This `page.tsx` (Server Component) will now:
        * Fetch only essential initial data for the project (e.g., `id`, `title`, `user_id`, maybe `created_at`, initial `status`). Authentication check for the user remains.
        * **Do not** fetch the full `content`, `outline`, `citations_identified`, or `references_list` here as `ProjectWorkspace.tsx` will manage fetching its detailed content requirements.
        * Import and render the `ProjectWorkspace` client component, passing the fetched `projectId` and initial minimal project data as props.
    3.  Move the `ProjectWorkspace.tsx` file to `app/(dashboard)/projects/[projectId]/ProjectWorkspace.tsx` (or a suitable `components` subfolder within this route segment). Ensure it has `"use client";` at the top.
* **Acceptance Criteria:**
    * Navigating to `/projects/[projectId]` renders the `ProjectWorkspace.tsx` UI.
    * The `ProjectWorkspace` component receives `projectId` and basic project details (like title) as props.
    * The old UI rendered by `ProjectPage.tsx` is no longer visible.
* **Estimated Effort:** M
* **Dependencies:** WFI-00, `ProjectWorkspace.tsx` code provided by user.

**Task ID: WFI-02**
* **Title:** Implement Initial Project Data Loading within `ProjectWorkspace.tsx`
* **Purpose:** To enable `ProjectWorkspace.tsx` to fetch its required detailed project data after the initial server-rendered shell.
* **Steps:**
    1.  In `ProjectWorkspace.tsx`, utilize the `useEffect` hook (triggered by `projectId`) to fetch detailed project data from Supabase using the client-side `supabase` client. This includes:
        * `title`, `outline` (if still used), `status`, `word_count` (overall, to be refined per section).
        * Initially, `content` can be fetched if it's still a single blob in your `projects` table.
    2.  Update the `project`, `editorContent`, and `wordCount` states with the fetched data.
    3.  Handle loading and error states appropriately.
* **Acceptance Criteria:**
    * `ProjectWorkspace.tsx` successfully fetches and displays the project title.
    * If `projects.content` exists, it's loaded into the `editorContent` state.
    * Loading and error states within `ProjectWorkspace.tsx` are functional.
* **Estimated Effort:** M
* **Dependencies:** WFI-01, Supabase client (`@/lib/supabase/client`).

**Task ID: WFI-03**
* **Title:** Implement Basic UI Toggles in `ProjectWorkspace.tsx`
* **Purpose:** To make the focus mode, show outline, and show citations toggles functional for controlling UI visibility.
* **Steps:**
    1.  Ensure the `focusMode`, `showCitations`, and `showOutline` state variables are correctly toggling the visibility of the respective UI sections (left sidebar, right sidebar, and potentially header elements for focus mode).
    2.  The buttons in the header (`Maximize2`/`Minimize2`) and sidebar headers (`X` to close) should correctly update these state variables.
* **Acceptance Criteria:**
    * Clicking the focus mode toggle correctly hides/shows sidebars.
    * Clicking the close ('X') buttons on the outline and citation sidebars correctly hides them.
    * The UI responds visually to these state changes.
* **Estimated Effort:** S
* **Dependencies:** WFI-01.

---
### Epic: Core Editor & Per-Section Content Management ✍️📄

This epic adapts the editor to work with a more granular, per-section data model.

**Task ID: CES-01**
* **Title:** Create `paper_sections` Table in Supabase
* **Purpose:** To store research paper content in distinct, manageable sections.
* **Steps:**
    1.  Write a Supabase SQL migration script to create the `paper_sections` table:
        * `id` (UUID PK)
        * `project_id` (UUID FK referencing `projects.id`, ON DELETE CASCADE)
        * `section_key` (TEXT, e.g., "introduction", "methodology", "abstract"; unique per `project_id`)
        * `title` (TEXT, e.g., "Introduction", "Methodology")
        * `content` (TEXT, nullable)
        * `order` (INTEGER, for maintaining section sequence)
        * `status` (TEXT, e.g., "pending", "draft", "ai_drafting", "completed")
        * `word_count` (INTEGER, DEFAULT 0)
        * `created_at`, `updated_at` (TIMESTAMPTZ)
    2.  Add necessary indexes (on `project_id`, `project_id_section_key`, `project_id_order`).
    3. add unique(project_id, section_key) constraint and a partial index on status = 'ai_drafting'
    4.  Define RLS policies.
* **Acceptance Criteria:**
    * `paper_sections` table is created in Supabase with all specified columns and constraints.
    * RLS policies are applied.
* **Estimated Effort:** M
* **Dependencies:** Supabase project.

**Task ID: CES-02**
* **Title:** Load Section Data into `ProjectWorkspace.tsx` Outline and Editor
* **Purpose:** To fetch and display content on a per-section basis from the new `paper_sections` table.
* **Steps:**
    1.  Modify the `loadProject` function (or a new data fetching function) in `ProjectWorkspace.tsx`:
        * Fetch all sections for the current `projectId` from the `paper_sections` table, ordered by `order`.
        * If no sections exist for a new project, trigger a Server Action to create default sections (from `defaultSections` array in UI code) in `paper_sections` for that project.
    2.  Update the `sections` state in `ProjectWorkspace.tsx` with the fetched/created sections from the database.
    3.  When `activeSection` changes (user clicks in outline):
        * Find the corresponding section in the `sections` state.
        * Set `editorContent` to that section's `content`.
        * Update `wordCount` based on the active section's content.
    4.  after creating default sections, return them in the same RPC so the UI doesn’t make two round trips (create → read).
* **Acceptance Criteria:**
    * The "Document Outline" (left sidebar) is populated with sections fetched from `paper_sections` for the current project (or defaults if new).
    * Clicking a section in the outline loads its specific content into the main editor area (`editorContent`).
    * Word count updates based on the active section.
* **Estimated Effort:** L
* **Dependencies:** WFI-02, CES-01.

**Task ID: CES-03**
* **Title:** Adapt Auto-Save to Update `paper_sections` Table
* **Purpose:** To ensure editor content is saved to the correct section in the database.
* **Steps:**
    1.  Create a new Server Action: `updateSectionContent(projectId: string, sectionKey: string, newContent: string, newWordCount: number)`.
    2.  This action will update the `content`, `word_count`, and `updated_at` for the specific section in the `paper_sections` table (matching `projectId` and `sectionKey`).
    3.  Modify `saveContent` function in `ProjectWorkspace.tsx` to call this new Server Action, passing the `activeSection`'s key.
    4. call the action from a Zod-validated client helper (useSectionAutosave) with onBlur and debounce(800 ms) on change.
* **Acceptance Criteria:**
    * Changes made in the editor are debounced and saved to the correct section's record in the `paper_sections` table.
    * The `word_count` for that section is updated in the database.
* **Estimated Effort:** M
* **Dependencies:** CES-02, Server Actions setup.

**Task ID: CES-04 (Placeholder for now)**
* **Title:** Integrate Basic `SmartEditor.tsx` Functionality (Replacing Plain `Textarea`)
* **Purpose:** To swap the current `Textarea` with a proper rich-text editor foundation (e.g., TipTap, Plate) for future AI augmentations. Basic styling buttons non-functional.
* **Steps:**
    1.  Choose and install a rich-text editor library (e.g., TipTap).
    2.  Create a basic `SmartEditor.tsx` component that wraps this library.
    3.  Integrate this `SmartEditor.tsx` into `ProjectWorkspace.tsx` to replace the `<Textarea />`.
    4.  Ensure `editorContent` is correctly bound (two-way) to the rich-text editor.
    5.  Ensure `handleContentChange` and `saveContent` still function with the rich-text editor's content (may need to get HTML or specific JSON from editor).
    6.  The toolbar buttons (`Bold`, `Italic`, etc.) are present but may not be wired up to actual formatting commands yet, or only basic ones.
    7. TipTap: turn on the CharacterCount extension; surface word/char count via its API instead of manual split(' ').
* **Acceptance Criteria:**
    * The plain `Textarea` is replaced with a rich-text editor.
    * Content loads into and saves from the rich-text editor correctly (per section).
    * Basic typing and editing are functional.
* **Estimated Effort:** L
* **Dependencies:** CES-03.

---
### Epic: Connecting Mocked UI Elements & Basic AI Actions 🤖💬

**Task ID: MKB-01**
* **Title:** Populate Outline Section Stats with Real Data
* **Purpose:** To display actual word counts and AI suggestion counts (initially 0) per section in the outline.
* **Steps:**
    1.  Ensure the `sections` state (from CES-02) in `ProjectWorkspace.tsx` includes `wordCount` (from `paper_sections` table) and `aiSuggestions` (can be hardcoded to 0 initially for each section).
    2.  Update the rendering logic for each section in the outline panel to display these values.
    3. word counts: query paper_sections.word_count AND subscribe via Realtime so stats update as your debounce saves fire.
* **Acceptance Criteria:**
    * Each section in the outline displays its actual `wordCount` from the database.
    * Each section displays "0 AI suggestions" (or similar placeholder).
* **Estimated Effort:** S
* **Dependencies:** CES-02.

**Task ID: MKB-02**
* **Title:** Wire Up "Generate Full Draft" Button (Outline Panel) to Call Existing Server Action
* **Purpose:** To connect the UI button to the existing `generateAndSaveFullPaper` server action logic.
* **Steps:**
    1.  In `ProjectWorkspace.tsx`, find the "Generate Full Draft" button in the outline panel.
    2.  On click, call the `generateAndSaveFullPaper` server action (from your old code), passing `projectId`, `projectTitle` (from `project` state), and the current `project.outline` (fetched in WFI-02 or a dedicated field).
    3.  Handle loading state and display success/error messages (can be simple `alert` or `console.log` initially).
    4.  Note: The `generateAndSaveFullPaper` action itself calls `/api/research/generate/full-paper`. This task is just wiring the button.
    5. add a pre-flight check: abort if any section status = 'ai_drafting' to stop double streams.
* **Acceptance Criteria:**
    * Clicking "Generate Full Draft" calls the `generateAndSaveFullPaper` server action.
    * The action attempts to call the full paper generation API endpoint.
    * Basic feedback (e.g., console log) is provided on initiation.
* **Estimated Effort:** S
* **Dependencies:** WFI-02, `generateAndSaveFullPaper` Server Action.

**Task ID: MKB-03**
* **Title:** Wire Up Basic "Ask AI" (Chat Input) to Log Message
* **Purpose:** To make the AI assistant chat input functional for sending a message (initially just logging it).
* **Steps:**
    1.  In `ProjectWorkspace.tsx`, the `handleAiMessage` function should:
        * Prevent submission if `aiMessage` is empty.
        * `console.log` the `aiMessage` along with `projectId` or `activeSection` context.
        * Clear the `aiMessage` input.
    2.  (Connecting to a real AI chat API endpoint is a subsequent, more complex task).
* **Acceptance Criteria:**
    * Typing a message in the "Ask AI" input and pressing Enter or Send logs the message and context to the console.
    * Input field clears after sending.
* **Estimated Effort:** S
* **Dependencies:** ASI-02 (UI setup).

**Task ID: MKB-04**
* **Title:** Wire Up Context Menu "Find Sources" to Log Action
* **Purpose:** To connect the "Find Sources" button in the text selection context menu to a placeholder action.
* **Steps:**
    1.  In `ProjectWorkspace.tsx`, modify `handleAiAction`:
        * If `action === 'find-sources'`, `console.log` "AI Action: find-sources on text:", `selectedText`, and the `activeSection`.
        * Hide the context menu.
    2.  (Connecting to real literature search is a subsequent task).
* **Acceptance Criteria:**
    * Selecting text and clicking "Find Sources" in the context menu logs the action, selected text, and context.
* **Estimated Effort:** S
* **Dependencies:** CWS-04 (Context menu UI).

---
### Epic: Integrating Real Citation Data (Replacing Mocks) 📚➡️💾

This epic assumes the Supabase schema from `Task ID: ACM-01` (from the *previous* plan for "Advanced Citation Management") is in place (`citations`, `reference_links`, `formatted_references` tables).

**Task ID: RCD-01**
* **Title:** Fetch Real Structured Citations for `CitationManager`
* **Purpose:** To replace `mockCitations` with actual structured citation data fetched from Supabase for the current project.
* **Steps:**
    1.  Create a Server Action or modify `loadProject` / create a new client-side fetch in `ProjectWorkspace.tsx` for the `CitationManager` sidebar.
    2.  This logic should fetch data from the `citations` table, and potentially join with `reference_links` to get context, for the current `projectId`.
    3.  Update the `citations` state in `ProjectWorkspace.tsx` with this real data.
    4.  Adapt the `CitationManager` UI in `ProjectWorkspace.tsx` (the right sidebar) to correctly display the fields from your `citations` table (e.g., `doi`, `title`, `authors` JSONB, `year`, `journal`, `abstract`, `source_type`, `source_url`).
    5.  The `formatAuthors` helper might need to be adjusted based on your `authors` JSONB structure.
    6. fetch from a view citations_with_links (or RPC) rather than two separate queries; you already do that later in the real-time panel.
* **Acceptance Criteria:**
    * The "Citations & Sources" sidebar fetches and displays structured citations from the Supabase `citations` table for the current project.
    * If no citations exist, it shows an appropriate empty state.
    * Loading and error states are handled.
* **Estimated Effort:** L
* **Dependencies:** WFI-01, Schema from previous ACM-01 (or a new task to create `citations` & `reference_links` tables if not done). `ProjectWorkspace.tsx` UI for citation sidebar.

**Task ID: RCD-02**
* **Title:** Implement Dynamic Bibliography Preview from `citations` Table
* **Purpose:** To replace the mock bibliography with a dynamically generated list from the project's actual citations.
* **Steps:**
    1.  In `ProjectWorkspace.tsx`, within the "Bibliography Preview" section of the Citation Manager sidebar:
        * Use the `citations` state (populated in RCD-01).
        * Map over the `citations` and format each one into a simple reference string (e.g., "Author(s) (Year). Title. Journal.").
        * Display this list.
    2.  (Full CSL styling is a more advanced step).
* **Acceptance Criteria:**
    * The bibliography preview dynamically displays formatted references based on the data in the `citations` state.
    * The list updates if the `citations` state changes.
* **Estimated Effort:** M
* **Dependencies:** RCD-01.

---

This plan focuses on integrating the new UI and connecting its basic interactive parts, largely using mock data for complex AI interactions initially, but progressively wiring up the database for sections and real citation display. Subsequent epics would then replace all mock functionalities with live AI calls and the advanced features from your gap analysis (like actual AI suggestions, functional context menu actions, AI chat, advanced literature search, etc.).