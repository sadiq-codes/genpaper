Okay, this is a granular step-by-step plan to build the MVP of your AI Research Assistant. Each task is designed to be small, testable, with a clear start and end, focusing on a single concern. This plan assumes the architecture previously discussed.

---

### MVP Build Plan: AI Research Assistant

**Phase 0: Project Setup & Basic Configuration**

1.  **Task:** Initialize Next.js Project (App Router)
    * **Start:** No project exists.
    * **Action:** Run `npx create-next-app@latest --typescript --tailwind --eslint --app` (or your preferred Next.js setup).
    * **End:** A new Next.js project directory is created and runnable.
    * **Test:** Run `npm run dev` and see the default Next.js page in the browser.

2.  **Task:** Install Supabase JS Library
    * **Start:** Next.js project initialized.
    * **Action:** Run `npm install @supabase/supabase-js`.
    * **End:** `@supabase/supabase-js` is added to `package.json` and installed.
    * **Test:** Verify package is listed in `package.json` and `node_modules`.

3.  **Task:** Configure Supabase Environment Variables
    * **Start:** Supabase JS library installed. Supabase project created on `supabase.com`.
    * **Action:** Create `.env.local` file. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from your Supabase project settings.
    * **End:** Environment variables for Supabase are configured.
    * **Test:** Check that `process.env.NEXT_PUBLIC_SUPABASE_URL` can be accessed (e.g. in a test server component).

4.  **Task:** Create Basic Root Layout (`app/layout.tsx`)
    * **Start:** Default Next.js layout exists.
    * **Action:** Modify `app/layout.tsx` to include basic HTML structure (html, body tags), and potentially a simple global navbar placeholder.
    * **End:** A custom root layout structure is in place.
    * **Test:** View the app in browser; any changes to the root layout (e.g., a static header) should be visible on all pages.

5.  **Task:** Create Supabase Client Utility (`lib/supabase/client.ts`)
    * **Start:** Supabase env vars configured.
    * **Action:** Create `lib/supabase/client.ts`. Initialize and export a Supabase client instance using the public environment variables.
    * **End:** A reusable Supabase client for client-side operations is available.
    * **Test:** Import the client in a test client component and log it; ensure no errors.

**Phase 1: Authentication (Supabase)**

6.  **Task:** Database: Create `profiles` Table
    * **Start:** Supabase project exists.
    * **Action:** In Supabase SQL Editor, create a `profiles` table (e.g., `id` (matches `auth.users.id`, UUID, primary key), `email` (TEXT), `full_name` (TEXT, optional), `created_at` (TIMESTAMPTZ)). Set up RLS if desired (e.g., users can only see their own profile).
    * **End:** `profiles` table exists in Supabase DB.
    * **Test:** View table schema in Supabase dashboard.

7.  **Task:** Frontend: Create Sign Up Page UI (`app/(auth)/signup/page.tsx`)
    * **Start:** Basic project structure.
    * **Action:** Create `app/(auth)/signup/page.tsx`. Add form fields for email, password, and a submit button (no logic yet).
    * **End:** `/signup` route renders a basic sign-up form.
    * **Test:** Navigate to `/signup` and see the form elements.

8.  **Task:** Frontend: Implement Sign Up Logic
    * **Start:** Sign Up UI exists. Supabase client utility available.
    * **Action:** In `app/(auth)/signup/page.tsx`, import Supabase client. Add state for form fields. On submit, call `supabase.auth.signUp()`. Add basic error handling/success message (console.log is fine for now).
    * **End:** Sign Up form attempts to register a user with Supabase.
    * **Test:** Successfully create a new user. Verify user appears in Supabase `auth.users` table.

9.  **Task:** Frontend: Create Login Page UI (`app/(auth)/login/page.tsx`)
    * **Start:** Basic project structure.
    * **Action:** Create `app/(auth)/login/page.tsx`. Add form fields for email, password, and a submit button (no logic yet).
    * **End:** `/login` route renders a basic login form.
    * **Test:** Navigate to `/login` and see the form elements.

10. **Task:** Frontend: Implement Login Logic
    * **Start:** sts. SupabaseLogin UI exi client utility available.
    * **Action:** In `app/(auth)/login/page.tsx`, import Supabase client. Add state for form fields. On submit, call `supabase.auth.signInWithPassword()`. Add basic error handling/success message. Redirect on success (e.g., to `/dashboard`).
    * **End:** Login form attempts to authenticate a user.
    * **Test:** Log in with the previously created user. Verify session is established (e.g., Supabase client reports an active session).

11. **Task:** Frontend: Create Logout Button/Functionality
    * **Start:** User can log in.
    * **Action:** Add a "Logout" button (e.g., in the root layout if user is logged in, or on a test page). On click, call `supabase.auth.signOut()`. Redirect to login page.
    * **End:** User can log out.
    * **Test:** Click logout button, user is signed out, and session is cleared.

12. **Task:** Frontend: Create Protected Route and Dashboard Placeholder (`app/(dashboard)/layout.tsx` and `app/(dashboard)/projects/page.tsx`)
    * **Start:** Auth logic in place.
    * **Action:** Create `app/(dashboard)/layout.tsx`. This layout should check for an active Supabase session. If no session, redirect to `/login`. Create a basic `app/(dashboard)/projects/page.tsx` that says "Welcome to Projects".
    * **End:** `/dashboard/projects` is a protected route.
    * **Test:** Try accessing `/dashboard/projects` when logged out (should redirect). Log in and access it (should show "Welcome to Projects").

13. **Task:** Server-Side Supabase Client (`lib/supabase/server.ts`)
    * **Start:** Supabase env vars configured.
    * **Action:** Create `lib/supabase/server.ts`. Implement function(s) to create a Supabase client for use in Server Components, API Routes, and Server Actions using `cookies` from `next/headers`.
    * **End:** A reusable Supabase client for server-side operations is available.
    * **Test:** (No direct runnable test without usage yet, but ensure code compiles and seems correct).

**Phase 2: Project Management (Core App - No AI yet)**

14. **Task:** Database: Define `projects` Table Schema
    * **Start:** Supabase `profiles` table exists.
    * **Action:** In Supabase SQL Editor, create `projects` table (e.g., `id` (UUID, primary key, default `gen_random_uuid()`), `user_id` (UUID, foreign key to `auth.users.id`), `title` (TEXT), `outline` (TEXT, nullable), `content` (TEXT, nullable), `created_at` (TIMESTAMPTZ default `now()`)). Setup RLS (users can CRUD their own projects).
    * **End:** `projects` table exists in Supabase.
    * **Test:** View table schema in Supabase dashboard.

15. **Task:** Backend: Create Server Action for New Project (`app/(dashboard)/projects/actions.ts`)
    * **Start:** `projects` table exists. Server-side Supabase client available.
    * **Action:** Create `app/(dashboard)/projects/actions.ts`. Define a Server Action `createProject(formData)` that takes a `title` from `formData`. It should:
        1. Get current user ID from Supabase server client.
        2. Insert a new project into the `projects` table with the `title` and `user_id`.
        3. Return success/failure or new project ID.
    * **End:** Server Action to create a project is defined.
    * **Test:** Manually invoke the Server Action with test data (can be done from a temporary test component/page or later from the actual UI). Verify a new project row appears in the DB associated with the correct user.

16. **Task:** Frontend: Create UI for Project Creation (`app/(dashboard)/projects/page.tsx`)
    * **Start:** `app/(dashboard)/projects/page.tsx` exists as a placeholder.
    * **Action:** Modify `app/(dashboard)/projects/page.tsx` to include a form with an input field for "Project Title" and a submit button.
    * **End:** UI for creating a new project is present.
    * **Test:** Page renders the form correctly.

17. **Task:** Frontend: Connect Project Creation UI to Server Action
    * **Start:** Project creation UI and Server Action exist.
    * **Action:** In `app/(dashboard)/projects/page.tsx`, make the form call the `createProject` Server Action on submit. Handle response (e.g., clear form, show message).
    * **End:** User can create a project through the UI.
    * **Test:** Input a title, submit. Verify project is created in DB.

18. **Task:** Frontend: List User's Projects (`app/(dashboard)/projects/page.tsx`)
    * **Start:** Users can create projects. Server-side Supabase client available.
    * **Action:** Modify `app/(dashboard)/projects/page.tsx` (it's a Server Component by default). Fetch projects for the currently logged-in user from Supabase within the component. Display the list of project titles.
    * **End:** User's projects are listed on the page.
    * **Test:** Create a few projects. They should appear on the `/dashboard/projects` page.

19. **Task:** Frontend: Create Dynamic Project Page Route (`app/(dashboard)/projects/[projectId]/page.tsx`)
    * **Start:** Projects can be listed.
    * **Action:** Create `app/(dashboard)/projects/[projectId]/page.tsx`. This page should be a Server Component.
    * **End:** Dynamic route structure for individual projects is set up.
    * **Test:** Manually navigate to `/dashboard/projects/some-uuid` (even if it 404s or errors for now, the routing should attempt to load it).

20. **Task:** Frontend: Fetch and Display Project Title on Project Page
    * **Start:** Dynamic project page exists.
    * **Action:** In `app/(dashboard)/projects/[projectId]/page.tsx`, fetch the project details (especially `title`) from Supabase using the `projectId` from params. Display the project title. Handle cases where project is not found or doesn't belong to user.
    * **End:** Individual project page displays the project title.
    * **Test:** Click on a project link from the list (add links in step 18 if not done). The correct project title should be displayed.

**Phase 3: Basic AI Integration (Outline Generation)**

21. **Task:** Setup: Install AI SDK (e.g., `openai` or `ai`)
    * **Start:** Project exists.
    * **Action:** Run `npm install openai` (or your chosen AI SDK like Vercel's `ai` package).
    * **End:** AI SDK is added to `package.json` and installed.
    * **Test:** Verify package in `package.json`.

22. **Task:** Config: Add AI API Key to Environment Variables
    * **Start:** AI SDK installed. You have an API key from your AI provider.
    * **Action:** Add your AI provider's API key (e.g., `OPENAI_API_KEY`) to `.env.local`.
    * **End:** AI API key is configured.
    * **Test:** (No direct test, but next steps will fail without it).

23. **Task:** Backend: Initialize AI SDK Client (`lib/ai/sdk.ts`)
    * **Start:** AI SDK installed, API key configured.
    * **Action:** Create `lib/ai/sdk.ts`. Initialize and export your AI SDK client (e.g., `const openai = new OpenAI();`).
    * **End:** Reusable AI SDK client is available.
    * **Test:** Ensure file compiles and client initializes without runtime errors (can add a simple log).

24. **Task:** Backend: Define Outline Generation Prompt (`lib/ai/prompts.ts`)
    * **Start:** `lib/ai/` directory structure exists.
    * **Action:** Create `lib/ai/prompts.ts`. Add a constant string for a simple system prompt and a user prompt function that takes a `topicTitle` and asks for a research paper outline (e.g., "Generate a concise research paper outline for the topic: {topicTitle}. Return as a numbered list.").
    * **End:** Prompts for outline generation are defined.
    * **Test:** Review prompts for clarity and correctness.

25. **Task:** Backend API Route for Outline Generation (`app/api/research/generate/outline/route.ts`) - Non-streaming
    * **Start:** AI SDK client and prompts available. Server-side Supabase client available.
    * **Action:** Create `app/api/research/generate/outline/route.ts`. Implement a `POST` handler:
        1.  Read `topicTitle` from request body.
        2.  Authenticate the user (e.g., using Supabase server client with request headers/cookies).
        3.  Call the AI SDK (e.g., `openai.chat.completions.create`) with prompts from `lib/ai/prompts.ts`.
        4.  Return the generated outline text as JSON response (e.g., `{ outline: "1. Intro..." }`).
    * **End:** API route for generating outlines is functional.
    * **Test:** Call API route using Postman/curl with a topic. Verify it returns an AI-generated outline (or a mock for now if AI credits are a concern initially).

26. **Task:** Backend: Server Action to Trigger Outline Generation & Save (`app/(dashboard)/projects/[projectId]/actions.ts`)
    * **Start:** Outline generation API route exists. `projects` table has `outline` column.
    * **Action:** Create `app/(dashboard)/projects/[projectId]/actions.ts`. Add a Server Action `generateAndSaveOutline(projectId, topicTitle)`:
        1.  Calls the `/api/research/generate/outline/route.ts` (using `fetch`).
        2.  Parses the response to get the outline text.
        3.  Updates the specified project's `outline` field in Supabase.
        4.  `revalidatePath` for the project page.
    * **End:** Server Action to generate and save outline is functional.
    * **Test:** Call Server Action. Verify project in DB has its `outline` field updated.

27. **Task:** Frontend: "Generate Outline" Button (`app/(dashboard)/projects/[projectId]/page.tsx`)
    * **Start:** Project page displays project title.
    * **Action:** Add a "Generate Outline" button to `app/(dashboard)/projects/[projectId]/page.tsx`.
    * **End:** Button is visible on the project page.
    * **Test:** Page renders the button.

28. **Task:** Frontend: Wire "Generate Outline" Button to Server Action
    * **Start:** "Generate Outline" button and `generateAndSaveOutline` Server Action exist. Project title is available on page.
    * **Action:** Make the button call the `generateAndSaveOutline` Server Action, passing the current `projectId` and `project.title`.
    * **End:** Button triggers outline generation and saving.
    * **Test:** Click button. Check DB that outline is populated.

29. **Task:** Frontend: Display Project Outline (`app/(dashboard)/projects/[projectId]/page.tsx`)
    * **Start:** Outline can be saved to DB. Project page fetches project data.
    * **Action:** Modify `app/(dashboard)/projects/[projectId]/page.tsx` to display the `project.outline` text if it exists (e.g., in a `<pre>` tag or simple div).
    * **End:** Generated outline is visible on the project page after generation and page refresh/revalidation.
    * **Test:** Generate outline, it should appear on the page.

**Phase 4: AI Content Generation (One Section - Streaming)**

30. **Task:** Backend: Define Section Generation Prompt (`lib/ai/prompts.ts`)
    * **Start:** `lib/ai/prompts.ts` exists.
    * **Action:** Add a prompt function for generating a single section (e.g., "Introduction") given a `topicTitle` and optionally the `outline`. Instruct AI to generate content for a specific section (e.g., "Write the Introduction for a research paper on '{topicTitle}'. The outline is: {outline}. Focus only on the Introduction section.").
    * **End:** Prompt for section generation is defined.
    * **Test:** Review prompt.

31. **Task:** Backend API Route for Streaming Section Content (`app/api/research/generate/section/route.ts`)
    * **Start:** AI SDK client, section prompt, Vercel AI SDK (if using).
    * **Action:** Create `app/api/research/generate/section/route.ts`. Implement a `POST` handler:
        1.  Read `topicTitle`, `outline`, `sectionName` from request body.
        2.  Authenticate user.
        3.  Use AI SDK (e.g., `OpenAIStream` from `ai` package, or manually handle streams if using `openai` directly) to call the LLM with the section prompt.
        4.  Return the `StreamingTextResponse` (from `ai` package) or equivalent `ReadableStream`.
    * **End:** API route streams section content.
    * **Test:** Call API route with Postman/curl. Verify text chunks are streamed back.

32. **Task:** Hooks: Create `useStreamingText` Hook (`hooks/useStreamingText.ts`)
    * **Start:** Basic project structure.
    * **Action:** Create `hooks/useStreamingText.ts`. This hook should:
        1.  Accept an API endpoint URL and request body.
        2.  Manage state for `isLoading`, `error`, and `streamedText`.
        3.  Provide a function to initiate the streaming `fetch` call.
        4.  Read the streamed response and append chunks to `streamedText`.
    * **End:** Custom hook for handling streaming text is available.
    * **Test:** Create a dummy client component that uses this hook with the `/api/research/generate/section` endpoint. Log `streamedText`.

33. **Task:** Frontend: "Generate Introduction" Button and Display Area (`app/(dashboard)/projects/[projectId]/page.tsx`)
    * **Start:** Project page exists. Outline can be displayed.
    * **Action:** Add a "Generate Introduction" button. Add a `div` or `<pre>` tag where the streamed introduction will be displayed.
    * **End:** UI elements for introduction generation are present.
    * **Test:** Page renders the button and an empty display area.

34. **Task:** Frontend: Wire "Generate Introduction" to Streaming API using Hook
    * **Start:** "Generate Introduction" button, display area, and `useStreamingText` hook exist.
    * **Action:** In `app/(dashboard)/projects/[projectId]/page.tsx` (make it a client component or put this logic in a child client component):
        1.  Use the `useStreamingText` hook.
        2.  On button click, call the hook's function to fetch from `/api/research/generate/section` with appropriate body (topic, outline, section name "Introduction").
        3.  Bind the hook's `streamedText` state to the display area.
    * **End:** Introduction text streams into the display area.
    * **Test:** Click button. Text for the introduction should stream onto the page.

35. **Task:** Backend: Server Action to Save Section Content (`app/(dashboard)/projects/[projectId]/actions.ts`)
    * **Start:** `projects` table has `content` column.
    * **Action:** Add a Server Action `saveSectionContent(projectId, sectionContent)`:
        1.  Updates the `projects` table's `content` field for the given `projectId` with `sectionContent`. For MVP, append or replace. (Appending might be better: `content = content || '' || newSectionContent`).
        2.  `revalidatePath` for the project page.
    * **End:** Server Action to save generated content is functional.
    * **Test:** Call Server Action with test data. Verify `content` field in DB is updated.

36. **Task:** Frontend: Save Streamed Introduction Content
    * **Start:** Introduction streams to page. `saveSectionContent` Server Action exists.
    * **Action:** Add a "Save Introduction" button that appears after streaming is complete OR automatically call `saveSectionContent` Server Action when the `useStreamingText` hook indicates completion. Pass the `projectId` and the fully accumulated `streamedText`.
    * **End:** Streamed introduction content can be saved to the DB.
    * **Test:** Generate introduction, save it. Verify it's stored in the `content` field of the project in DB.

37. **Task:** Frontend: Display Saved Project Content (`app/(dashboard)/projects/[projectId]/page.tsx`)
    * **Start:** Content can be saved to DB. Project page fetches project data.
    * **Action:** Modify the project page to display the `project.content` if it exists (this might be the same area used for streaming, or a separate one for persisted content).
    * **End:** Saved content is visible on page load/refresh.
    * **Test:** Generate and save introduction. Refresh page. The introduction should be displayed from the DB.

**Phase 5: Basic Citation Identification (Simplified)**

38. **Task:** Backend: Modify Section Prompt for Citation Placeholders (`lib/ai/prompts.ts`)
    * **Start:** Section generation prompt exists.
    * **Action:** Update the section generation prompt to instruct the AI to insert placeholders like `[CN: concept needing citation]` or `[CITATION_NEEDED_FOR: specific concept]` within the generated text where a citation would be appropriate.
    * **End:** Prompt is updated to request citation placeholders.
    * **Test:** Manually call the section generation API (or trigger via UI). Inspect the output for `[CN: ...]` placeholders.

39. **Task:** Database: Add `citations_identified` Field to `projects` Table
    * **Start:** `projects` table exists.
    * **Action:** Add a `citations_identified` (JSONB or TEXT[]) field to the `projects` table in Supabase.
    * **End:** `projects` table schema is updated.
    * **Test:** Verify schema change in Supabase dashboard.

40. **Task:** Backend: Server Action to Extract and Save Identified Citations (`app/(dashboard)/projects/[projectId]/actions.ts`)
    * **Start:** `citations_identified` field exists. Generated content may contain `[CN: ...]` placeholders.
    * **Action:** Create a Server Action `extractAndSaveCitations(projectId, textContent)`:
        1.  Use a regular expression (e.g., `/\[CN: (.*?)\]/g`) to find all `[CN: ...]` placeholders in `textContent`.
        2.  Extract the concepts (the part inside the placeholder).
        3.  Save this array of concepts to the `citations_identified` field for the project in Supabase.
        4.  `revalidatePath`.
    * **End:** Server Action extracts and saves citation needs.
    * **Test:** Call Server Action with sample text containing placeholders. Verify `citations_identified` field in DB is populated correctly.

41. **Task:** Frontend: Trigger Citation Extraction After Section Save
    * **Start:** Section content can be saved. `extractAndSaveCitations` Server Action exists.
    * **Action:** Modify the logic for saving section content (e.g., in the "Save Introduction" step) to also call `extractAndSaveCitations` Server Action, passing the `projectId` and the saved `textContent`.
    * **End:** Citation needs are extracted and saved automatically after content generation.
    * **Test:** Generate and save a section. Check DB to ensure `citations_identified` is populated.

42. **Task:** Frontend: Display Identified Citation Needs (`app/(dashboard)/projects/[projectId]/page.tsx`)
    * **Start:** `citations_identified` are saved in DB. Project page fetches project data.
    * **Action:** On the project page, if `project.citations_identified` exists and is not empty, display it as a list (e.g., "Citations Needed For: concept1, concept2...").
    * **End:** List of citation needs is visible.
    * **Test:** After generating content, the identified citation needs should appear on the page.

**Phase 6: Basic Reference List (Placeholder)**

43. **Task:** Database: Add `references_list` Field to `projects` Table
    * **Start:** `projects` table exists.
    * **Action:** Add a `references_list` (JSONB or TEXT[]) field to the `projects` table.
    * **End:** `projects` table schema is updated.
    * **Test:** Verify schema change in Supabase dashboard.

44. **Task:** Backend: Server Action to Generate Placeholder References (`app/(dashboard)/projects/[projectId]/actions.ts`)
    * **Start:** `citations_identified` can be populated. `references_list` field exists.
    * **Action:** Create a Server Action `generatePlaceholderReferences(projectId)`:
        1.  Fetch the project's `citations_identified` from Supabase.
        2.  If not empty, format them into a simple numbered list (e.g., `["1. [Placeholder for: concept1]", "2. [Placeholder for: concept2]"]`).
        3.  Save this list to the `references_list` field for the project.
        4.  `revalidatePath`.
    * **End:** Server Action generates placeholder references.
    * **Test:** Manually call Server Action for a project with identified citations. Verify `references_list` is populated.

45. **Task:** Frontend: "Generate References" Button (`app/(dashboard)/projects/[projectId]/page.tsx`)
    * **Start:** Project page exists.
    * **Action:** Add a "Generate Placeholder References" button.
    * **End:** Button is visible.
    * **Test:** Page renders the button.

46. **Task:** Frontend: Wire "Generate References" Button to Server Action
    * **Start:** Button and Server Action exist.
    * **Action:** Make the button call `generatePlaceholderReferences(projectId)`.
    * **End:** Button triggers placeholder reference generation.
    * **Test:** Click button. Check DB that `references_list` is populated.

47. **Task:** Frontend: Display Placeholder Reference List (`app/(dashboard)/projects/[projectId]/page.tsx`)
    * **Start:** `references_list` can be populated. Project page fetches project data.
    * **Action:** Display the `project.references_list` if it exists (e.g., as a list of items).
    * **End:** Placeholder references are visible.
    * **Test:** Generate references. They should appear on the page.

**Phase 7: UI Polish & Basic Structure Components**

48. **Task:** Frontend: Create Basic `PaperEditor.tsx` Component
    * **Start:** Project outline and content are displayed directly in `page.tsx`.
    * **Action:** Create `app/(dashboard)/projects/[projectId]/components/PaperEditor.tsx`. This component will receive `outline` and `content` as props and display them in a slightly more structured way (e.g., outline with a heading, content below). For MVP, no actual editing functionality.
    * **End:** A dedicated component for displaying paper elements.
    * **Test:** Use `PaperEditor.tsx` in `[projectId]/page.tsx`. Verify outline and content are displayed.

49. **Task:** Frontend: Create Basic `SectionOutlineViewer.tsx` Component (Optional for MVP if outline is simple text)
    * **Start:** Outline is displayed as raw text.
    * **Action:** Create `app/(dashboard)/projects/[projectId]/components/SectionOutlineViewer.tsx`. If the outline is structured (e.g., JSON from AI later), this component would parse and display it nicely. For MVP with text outline, it might just wrap the text in a styled box.
    * **End:** Component for displaying the outline.
    * **Test:** Integrate into `PaperEditor.tsx` or `[projectId]/page.tsx`. Verify outline display.

50. **Task:** Frontend: Create Basic `CitationViewer.tsx` Component
    * **Start:** Citation needs are displayed directly in `page.tsx`.
    * **Action:** Create `app/(dashboard)/projects/[projectId]/components/CitationViewer.tsx`. This component receives `citations_identified` and displays them as a list.
    * **End:** Dedicated component for viewing citation needs.
    * **Test:** Use `CitationViewer.tsx` in `[projectId]/page.tsx`. Verify display.

51. **Task:** Frontend: Create Basic `ReferenceViewer.tsx` Component
    * **Start:** References are displayed directly in `page.tsx`.
    * **Action:** Create `app/(dashboard)/projects/[projectId]/components/ReferenceViewer.tsx`. This component receives `references_list` and displays them.
    * **End:** Dedicated component for viewing references.
    * **Test:** Use `ReferenceViewer.tsx` in `[projectId]/page.tsx`. Verify display.

52. **Task:** General: Basic CSS Styling for Readability
    * **Start:** Application has default or minimal Tailwind styling.
    * **Action:** Apply basic Tailwind CSS classes to all created pages and components (`AuthForm`, `PaperEditor`, lists, buttons, etc.) to improve readability and provide a minimal, clean user experience.
    * **End:** Application is visually coherent and more usable.
    * **Test:** Manually navigate through all implemented MVP features and check for acceptable visual presentation and usability.

---

This plan breaks the MVP down into very small, testable steps. Each step focuses on one concern, making it easier for an engineering LLM to implement and for you to verify. Good luck!