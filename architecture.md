## Updated Architecture Focus for Advanced Features

The core technologies and overall layered architecture remain the same. The advancements will be in the complexity and capabilities within these layers.

**Key Areas of Enhancement in Your Existing Structure:**

### 1. Backend Logic (Next.js API Routes / Supabase Edge Functions) & AI Service Layer (AI SDK)
   This is where the most significant "advanced" work will happen.

   * **`app/api/research/generate/route.ts` (and potentially new, specialized API routes):**
        * **More Sophisticated Orchestration:** This route (or new ones like `app/api/research/analyze/literature/route.ts` or `app/api/research/suggest/hypothesis/route.ts`) will manage more complex multi-step AI workflows.
        * **Advanced Tool Calling & Management:**
            * The AI will call a wider array of more powerful tools (defined in `lib/ai/tools/`).
            * The API route will need robust logic to handle sequences of tool calls, aggregate results, and feed them back to the AI for synthesis or further action.
            * Error handling for failed tool calls or unexpected API responses from external services becomes even more critical.
        * **Deeper AI Chaining/Agentic Behavior:** You might implement patterns where the AI plans steps, calls tools, evaluates results, and decides on next actions, making your backend act more like an AI agent orchestrator.

   * **`lib/ai/sdk.ts`:**
        * May need wrappers for more specialized AI model interactions (e.g., if you use different models or prompting techniques for analysis vs. generation).
        * Enhanced functions to support more complex tool interaction patterns.

   * **`lib/ai/prompts.ts`:** ✍️
        * **Crucial Enhancement:** Development of highly detailed and nuanced prompts will be key. These prompts will need to guide the AI through complex tasks like literature synthesis, gap identification, methodological critique, and targeted revisions. This is a major area of "advanced implementation."
        * Prompts for eliciting structured JSON output for various new data types (e.g., hypotheses, research gaps, synthesized review points).

   * **`lib/ai/tools/`:** 🛠️
        * **Expansion with New Tools:** This directory will grow significantly. Examples:
            * `literatureSearch.ts`: Will become more robust, potentially querying multiple academic databases (Semantic Scholar, PubMed, CORE, ArXiv via their APIs) and handling diverse result formats. May include PDF text extraction capabilities if full-text analysis is needed.
            * `multiDocumentAnalyzer.ts`: A new tool (or set of tools/prompts) for tasks like thematic analysis across several documents, or identifying conflicting information.
            * `methodologySuggester.ts`: Could interface with a knowledge base or use advanced prompting to suggest research methodologies.
            * `hypothesisGenerator.ts`: Tool to help formulate or refine hypotheses.
            * `styleAdaptationTool.ts`: (Potentially) if specific style transformations are complex enough to warrant a separate tool/AI call.
        * **Integration with External Services:** These tools will be the primary interface to external APIs or data sources.

### 2. Data & Auth Layer (Supabase)
   * **Database Schema Evolution:** 📊
        * **More Granular Data Storage:**
            * `projects`: Stays largely the same.
            * `paper_sections`: May need fields for storing structured feedback or revision history.
            * `citations`: Will become more structured, storing detailed metadata (authors, year, title, journal, DOI, abstract snippets, links to PDFs if fetched).
            * `references`: May be dynamically generated or stored based on the `citations` table and chosen style.
            * **New Tables Possible:**
                * `literature_corpus` (Optional): If you allow users to upload papers or build a project-specific library, or if the AI fetches and caches papers. Could include embeddings for semantic search.
                * `hypotheses` or `research_questions`: To store AI-generated or user-defined hypotheses linked to projects.
                * `synthesis_nodes` or `knowledge_graph_elements`: If you implement knowledge graph features.
        * **Relationships:** More complex relationships between projects, sections, claims within sections, and specific citations/sources.
   * **Supabase Storage:** Will be more critical if you start fetching and storing PDFs of research papers that the AI analyzes.
   * **Supabase Edge Functions:** Could be used to implement some of the more data-intensive "tools" directly, especially if they need low-latency access to the database or involve pre-processing of stored literature.

### 3. Frontend (Next.js)
   * **`app/(dashboard)/projects/[projectId]/components/`:** ✨
        * `PaperEditor.tsx`: Will need to support more interactive elements, such as:
            * Displaying AI-suggested revisions or feedback inline.
            * Allowing users to click on a claim to see supporting sources or trigger a new literature search.
            * Highlighting areas identified by the AI (e.g., potential gaps, weak arguments).
        * `CitationManager.tsx`: Will evolve to handle structured citation objects, allow users to review/edit AI-found sources, manually add citations from search results, and manage different citation styles.
        * **New Interactive Components:**
            * `LiteratureReviewExplorer.tsx`: To display synthesized literature review points and allow navigation through sources.
            * `HypothesisBoard.tsx`: For viewing and interacting with AI-suggested hypotheses.
            * `FeedbackInput.tsx`: A component for users to give granular, targeted feedback on specific text segments.
            * `MethodologyAdvisor.tsx`: Interface for AI suggestions on research methods.
   * **`app/(dashboard)/projects/[projectId]/page.tsx`:** Will orchestrate these more complex components and manage more sophisticated client-side state related to the advanced features.
   * **`store/projectStore.ts` (or chosen state management):** May need to handle more complex state, like the current set of literature search results, AI suggestions, or the state of an interactive revision process.

### 4. File & Folder Structure
   The existing file and folder structure is generally sound and can accommodate these enhancements. The main changes will be:
   * **More files within `lib/ai/tools/`**.
   * **More files within `app/(dashboard)/projects/[projectId]/components/`** for the richer UI.
   * Potentially more specialized API routes under `app/api/research/` if you break down functionalities (e.g., `app/api/research/literature/`, `app/api/research/critique/`).
   * The `types/` directory will grow with more complex type definitions for structured AI outputs and database entities.

---

**In essence, your core architectural blueprint remains valid.** The "advanced" nature comes from:
* 🧠 **More sophisticated AI logic** (prompts, chaining, agent-like behavior).
* 🔧 **A richer set of powerful tools** for the AI to use.
* 💾 **More detailed and structured data storage** in Supabase.
* 🎨 **More interactive and feature-rich UI components** on the frontend.

