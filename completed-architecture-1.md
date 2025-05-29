AI Research Assistant Software Architecture

This document outlines the architecture for an AI-powered research assistant designed to generate standard research papers from a topic title, complete with citations and references.

Core Technologies:

Frontend: Next.js (App Router)

Backend & Database: Supabase (PostgreSQL, Auth, Edge Functions/Storage)

AI Integration: A generic AI SDK (e.g., Vercel AI SDK, LangChain.js, or vendor-specific SDKs like OpenAI's) capable of:

Streaming text output

Tool calling (function calling)

Structured data generation

1. Overall Architecture

The system is primarily composed of three layers:

Frontend (Next.js): The user interface where users input topics, view the generated paper, manage projects, and interact with AI-driven suggestions. It handles UI state and communicates with the backend layer.

Backend Logic (Next.js API Routes / Supabase Edge Functions): This layer acts as a secure intermediary between the frontend and the AI SDK. It handles:

Authenticated requests from the frontend.

Orchestrating calls to the AI SDK.

Executing "tools" requested by the AI (e.g., database lookups, external API calls for literature search).

Processing and streaming responses from the AI SDK back to the frontend.

Interacting with Supabase for data persistence.

AI Service Layer (AI SDK): This is the core intelligence. It processes the input topic, uses language models to:

Generate a paper outline (structured data).

Draft paper sections (streaming text).

Identify and suggest citations (tool calling to search literature, then structured data for citation objects).

Format references.

Data & Auth Layer (Supabase):

Database: Stores user information, research projects, generated paper content, sections, citations, and references.

Authentication: Manages user sign-up, login, and session management.

Storage: (Optional) For storing any associated files, like PDFs of cited papers if fetched.

2. File & Folder Structure (Next.js App Router)

.
├── app/                                # Next.js App Router
│   ├── (auth)/                         # Routes for authentication (login, signup, etc.)
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   └── components/
│   │       └── AuthForm.tsx
│   ├── (dashboard)/                    # Protected routes after login
│   │   ├── layout.tsx                  # Dashboard layout (sidebar, header)
│   │   ├── projects/                   # User's research projects
│   │   │   ├── page.tsx                # List existing projects, create new
│   │   │   └── [projectId]/            # Individual project workspace
│   │   │       ├── page.tsx            # Main editor/viewer for the paper
│   │   │       ├── components/         # Components specific to the project view
│   │   │       │   ├── PaperEditor.tsx     # Rich text editor for paper content
│   │   │       │   ├── SectionOutline.tsx  # Displays and interacts with paper outline
│   │   │       │   ├── CitationManager.tsx # Manages suggested/added citations
│   │   │       │   └── ReferenceList.tsx   # Displays formatted bibliography
│   │   │       └── actions.ts            # Server Actions for this route (e.g., save section)
│   │   └── settings/
│   │       └── page.tsx                # User settings
│   ├── api/                            # Backend API Routes (primarily for streaming AI responses)
│   │   └── research/
│   │       └── generate/route.ts       # Endpoint to trigger paper generation & stream results
│   ├── layout.tsx                      # Root layout (providers, global styles)
│   ├── page.tsx                        # Landing page
│   └── global.css
├── components/                         # Shared UI components
│   ├── ui/                             # Basic UI elements (Button, Input, Modal, etc. from Shadcn/ui or similar)
│   └── common/                         # More complex shared components (Navbar, SidebarItem, etc.)
├── lib/                                # Core logic, clients, utilities
│   ├── supabase/
│   │   ├── client.ts                   # Supabase client (browser-safe)
│   │   ├── server.ts                   # Supabase client (server-side: RSC, API Routes, Server Actions)
│   │   └── utils.ts                    # Supabase helper functions (e.g., fetching user profile)
│   ├── ai/
│   │   ├── sdk.ts                      # AI SDK client initialization & core functions
│   │   ├── prompts.ts                  # Pre-defined prompts for various AI tasks (outline, sections, citations)
│   │   └── tools/                      # Definitions for tools the AI can call
│   │       ├── literatureSearch.ts
│   │       └── citationFormatter.ts
│   └── utils.ts                        # General utility functions (date formatting, etc.)
├── hooks/                              # Custom React hooks
│   └── useStreamingText.ts             # Hook to manage streamed text from AI
├── store/                              # Global/shared client-side state (e.g., Zustand, Jotai, or React Context)
│   └── projectStore.ts                 # State for the active project being edited/generated
├── types/                              # TypeScript type definitions
│   ├── db.ts                           # Auto-generated or manual types for Supabase schema
│   └── index.ts                        # General application types (Project, Section, Citation)
├── supabase/                           # Supabase specific files (migrations, edge functions)
│   └── functions/
│       └── literature-search-tool/     # Example Supabase Edge Function for an AI tool
│           └── index.ts
├── .env.local                          # Environment variables (Supabase keys, AI API keys)
├── next.config.mjs
├── package.json
└── tsconfig.json


3. What Each Part Does

app/ (Next.js App Router)

(auth) routes: Handle user authentication using Supabase Auth. AuthForm.tsx is a reusable component for login/signup.

(dashboard) routes: Protected areas accessible after login.

layout.tsx: Common layout for the dashboard (e.g., navigation sidebar, user menu).

projects/page.tsx: Displays a list of the user's research projects and allows creation of new ones. Fetches data from Supabase.

projects/[projectId]/page.tsx: The main workspace for a single research paper.

Fetches project data (outline, sections, citations) from Supabase.

Coordinates AI generation requests and displays streamed content.

projects/[projectId]/components/:

PaperEditor.tsx: A rich text editor (e.g., TipTap, Lexical, or a custom solution) to display and allow minor edits to the AI-generated paper content. Handles real-time updates from streamed text.

SectionOutline.tsx: Displays the paper's outline (potentially generated by AI as structured data) and allows users to navigate or trigger generation for specific sections.

CitationManager.tsx: Interface to view citations suggested by the AI, manually add/edit citations, and link them to parts of the text.

ReferenceList.tsx: Displays the formatted bibliography, generated based on the citations.

projects/[projectId]/actions.ts: Next.js Server Actions for mutating data related to a project (e.g., saving a manually edited section, adding a citation). These run on the server and can directly interact with Supabase.

api/research/generate/route.ts:

A Next.js API Route primarily used for handling requests that require streaming responses from the AI SDK.

Receives the project ID and/or topic from the frontend.

Authenticates the request using Supabase.

Interacts with the AI SDK (lib/ai/sdk.ts):

Initiates the paper generation process (e.g., "generate full paper" or "generate introduction section").

Handles tool calling: If the AI decides to use a tool (e.g., "search_academic_papers"), this API route will execute the corresponding function (defined in lib/ai/tools/ or as a Supabase Edge Function) and send the results back to the AI.

Receives streamed text and structured data (e.g., JSON for citations, outlines) from the AI SDK.

Streams this data back to the frontend client using a ReadableStream.

Can also trigger Server Actions or directly update Supabase as content is finalized.

layout.tsx (root): Sets up global context providers (e.g., Supabase session provider, state management provider).

components/

ui/: Atomic UI components (e.g., <Button>, <Input>). Often from a library like Shadcn/UI.

common/: More complex, shared components used across multiple pages (e.g., Navbar.tsx).

lib/

supabase/client.ts & server.ts: Initialize Supabase client instances for browser and server environments, respectively.

supabase/utils.ts: Utility functions for common Supabase operations (e.g., getting current user session, fetching user profile data).

ai/sdk.ts:

Initializes and configures your chosen AI SDK.

Provides wrapper functions to call specific AI capabilities (e.g., generateOutline(topic), streamSection(topic, sectionPrompt, previousText), findCitations(textChunk)).

Manages interaction flows, including passing tool definitions to the AI and handling tool call requests/responses.

ai/prompts.ts: Contains structured prompts for guiding the LLM. This is crucial for quality and consistency. Examples:

SYSTEM_PROMPT_RESEARCH_PAPER_GENERATOR

USER_PROMPT_GENERATE_OUTLINE(topic)

USER_PROMPT_GENERATE_SECTION(sectionTitle, topic, outline, previousSectionsText)

USER_PROMPT_IDENTIFY_CITATIONS(textBlock)

ai/tools/: Defines functions that the AI can request to call.

literatureSearch.ts: Implements logic to search academic databases (e.g., Semantic Scholar, PubMed via their APIs, or a local vector DB if you build one).

citationFormatter.ts: Formats citation data into a specific style (e.g., APA, MLA).

utils.ts: General helper functions.

hooks/

useStreamingText.ts: A custom hook to simplify fetching and managing streamed text data from the api/research/generate/route.ts endpoint on the client-side.

store/

projectStore.ts: (Optional, if using Zustand/Jotai) Manages client-side state for the active research project, such as:

Current paper content being streamed/edited.

Loading states for AI operations.

Outline structure.

List of citations and references.

Alternatively, React Context or Server Components with Server Actions can manage much of this state.

types/

db.ts: TypeScript definitions for your Supabase database schema. Can be auto-generated using supabase gen types typescript.

index.ts: Custom types for your application (e.g., Project, Section, CitationObject, ReferenceObject).

supabase/functions/

This directory is for Supabase Edge Functions. These can be used as an alternative to Next.js API routes for backend logic, especially for AI tool execution if they need direct, low-latency access to the database or are simpler to deploy as standalone units.

Example: literature-search-tool/index.ts could be an Edge Function that takes a query and returns search results, callable by the AI via the Next.js API route.

4. Where State Lives & How Services Connect

A. User Authentication & Session Management:

State: User session (JWT) managed by Supabase Auth. Available client-side via supabase.auth.getSession() and server-side (API Routes, Server Actions, RSCs) by reading cookies or headers.

Connection:

Frontend ((auth)/login/page.tsx) uses supabase.auth.signInWithPassword().

Supabase handles auth, sets secure cookies.

Subsequent requests from client to Supabase (RLS) or to backend API routes include auth information.

Backend API routes/Server Actions verify the session using lib/supabase/server.ts.

B. Creating a New Research Project & Initial Generation:

User Input (Frontend):

User enters a "topic title" in app/(dashboard)/projects/page.tsx.

State: Local component state for the form.

Project Creation (Frontend -> Server Action -> Supabase):

On submit, a Server Action is called.

The Server Action creates a new project entry in the Supabase projects table (e.g., id, user_id, title, status: 'initializing').

State: New row in Supabase projects table.

Triggering AI Generation (Frontend -> API Route):

After project creation (or when opening an existing project to generate/regenerate), the frontend (projects/[projectId]/page.tsx) makes a POST request to /api/research/generate/route.ts with the projectId and the task (e.g., "generate_full_paper" or "generate_introduction").

AI Processing (API Route <-> AI SDK <-> Tools):

API Route (/api/research/generate/route.ts):

Authenticates the user.

Fetches project details (topic) from Supabase.

Calls the AI SDK (e.g., aiSDK.streamPaper(topic, toolDefinitions)).

AI SDK (lib/ai/sdk.ts):

Sends initial prompts (from lib/ai/prompts.ts) to the LLM.

Tool Calling Loop:

LLM decides to use a tool (e.g., literatureSearch with query "benefits of X").

AI SDK communicates this tool call request back to the API Route.

The API Route executes the tool function (e.g., literatureSearchTool(query) defined in lib/ai/tools/ or calls a Supabase Edge Function). This tool might call external APIs (e.g., Semantic Scholar).

The API Route sends the tool's output (e.g., list of paper abstracts) back to the AI SDK.

AI SDK sends this output to the LLM to continue generation.

Structured Data Generation: For outlines or citation objects, the AI SDK is prompted to return JSON. This JSON is parsed by the API route.

Text Streaming: As the LLM generates text for sections, the AI SDK streams it.

Streaming to Frontend & Persisting (API Route -> Frontend & API Route -> Supabase):

API Route:

Receives streamed text and structured data from AI SDK.

Streams this data (e.g., using ReadableStream and Server-Sent Events or chunked HTTP response) to the frontend.

As significant chunks of data (e.g., a full section, a set of citations) are finalized by the AI, the API route (or a Server Action triggered by it/client) saves this data to the relevant Supabase tables (paper_sections, citations, references).

State (Backend): Temporary state in the API route for the ongoing stream.

Frontend (projects/[projectId]/page.tsx & PaperEditor.tsx):

Uses fetch with the API route and reads the stream. The useStreamingText hook can manage this.

Updates UI components (e.g., PaperEditor, SectionOutline, CitationManager) in real-time.

State (Client): Managed by projectStore or local component state (e.g., useState for the current streamed content).

Supabase:

Persisted state for the generated content, outline, citations, references. Supabase Realtime can be used to update other clients if collaboration is a feature.

C. Data Display and Editing:

State: Primarily fetched from Supabase and managed by Server Components or client-side fetching hooks (SWR/React Query) in app/(dashboard)/projects/[projectId]/page.tsx.

Connection:

User navigates to a project page.

Next.js Server Components fetch initial data from Supabase.

Client Components can re-fetch or subscribe to Realtime updates from Supabase.

Manual edits in PaperEditor.tsx can trigger Server Actions (projects/[projectId]/actions.ts) to update the content in Supabase.

State Management Summary:

Server State / Source of Truth: Supabase database.

Client-Side Cache of Server State: Managed by Next.js App Router's caching, React Server Components, or client-side data fetching libraries (if used).

UI State (Client-Side): Local component state (useState, useReducer), React Context, or a global client state manager like Zustand/Jotai (store/projectStore.ts) for complex, shared UI states like the currently streaming AI response or editor selections.

Form State (Client-Side): Typically local component state or libraries like React Hook Form.

Ephemeral AI Interaction State (Backend): Handled within the /api/research/generate/route.ts during an active generation stream.

This architecture provides a robust and scalable foundation for your AI research assistant. The key is the clear separation of concerns: Next.js for the user experience, Supabase for data and auth, and the API route/Edge Functions acting as the crucial orchestration layer for complex AI interactions involving tool usage and streaming.