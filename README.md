# GenPaper

GenPaper is a web app that writes research papers with AI. You enter a topic, and it searches academic sources, builds an outline, and writes full sections with citations. It also has an editor with AI chat and autocomplete for polishing your work.

## Features

- Paper generation pipeline: topic parsing, paper discovery, outline planning, section writing
- Editor with AI chat, inline autocomplete, and citation tools
- Library: upload PDFs, extract findings, search your collection
- Academic search across OpenAlex, Crossref, Semantic Scholar, arXiv, and more
- User accounts, usage limits, and paid plans
- AI tracing with Foglamp (cost, latency, tokens per model call)

## Tech stack

- Next.js 15 + React 19 + TypeScript
- Bun as package manager and runtime
- Supabase for auth and Postgres database
- Qdrant for vector search
- OpenAI or Azure OpenAI through the Vercel AI SDK
- Polar for billing
- Tailwind CSS + Tiptap editor

## Prerequisites

- Bun 1.3 or newer
- Node 20 or newer (only needed for some tooling)
- A Supabase project (cloud or local)
- An OpenAI API key, or Azure OpenAI credentials
- A Qdrant instance (cloud or local)

## Setup

1. Install dependencies:

```bash
bun install
```

2. Create your env files. Copy the keys below into `.env.local` for local work:

| Key | What it is |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server only, never public) |
| `OPENAI_API_KEY` | OpenAI API key |
| `QDRANT_URL` | Qdrant server URL |
| `NEXT_PUBLIC_APP_URL` | App URL, `http://localhost:3000` for local work |
| `FOGLAMP_API_KEY` | Foglamp key for AI tracing (run `npx foglamp login`) |

For Azure OpenAI instead of plain OpenAI, also set `USE_AZURE_OPENAI=true` plus `AZURE_OPENAI_RESOURCE_NAME`, `AZURE_OPENAI_API_KEY`, and the deployment names. For billing, add the `POLAR_*` keys.

3. Set up the database:

```bash
supabase db push
```

Or link to your cloud project first with `supabase link`, then push. SQL migrations live in `supabase/migrations`.

4. Start the dev server:

```bash
bun run dev
```

Open `http://localhost:3000`.

## Background workers

Paper generation runs in background workers, not in the web request. Start one alongside the dev server:

```bash
bun run worker:generation
```

To process a single run and exit (useful for debugging):

```bash
bun run worker:generation:once -- --run-id <uuid>
```

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Start the dev server |
| `bun run build` | Build for production |
| `bun run start` | Run the production build |
| `bun run lint` | Run ESLint |
| `bun test` | Run unit tests with Vitest |
| `bun run test:ui` | Run tests with the Vitest UI |
| `bun run test:coverage` | Run tests with coverage |
| `bun run ingest` | Run the content ingest script |
| `bun run worker:generation` | Start the generation worker loop |
| `bun run worker:generation:once` | Process one generation job and exit |
| `bun run types:generate` | Regenerate TypeScript types from Supabase |
| `bun run backfill-embeddings` | Backfill missing embeddings |

## Project structure

- `app/` - pages and API routes (editor, library, generation, billing)
- `components/` - React components, including the editor
- `lib/` - business logic: generation pipeline, AI clients, search, billing
- `scripts/` - one-off scripts and workers
- `supabase/` - database migrations and config
- `test/` - unit and integration tests
- `embedding-server/` - optional self-hosted embedding server
- `content/blog/` - blog posts

## AI tracing

Model calls are traced with Foglamp. You need `FOGLAMP_API_KEY` in your env, otherwise tracing stays off and the app works as normal. In local dev, a small HUD overlay shows live runs on top of the app. The dashboard shows cost, tokens, and latency per agent and workflow.

## Testing

Tests use Vitest. Files that mock the `ai` module must spread the original module so the Foglamp wrapper keeps working:

```ts
vi.mock('ai', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  generateObject: vi.fn(),
}))
```

## Notes

- AI model names have defaults in `lib/ai/config.ts` and can be changed with `AI_MODEL`, `AI_CHAT_MODEL`, and similar env vars.
- PDF text extraction can use Grobid or OCR. See `ENABLE_GROBID`, `ENABLE_SERVER_OCR`, and `GROBID_URL`.
- Never commit `.env`, `.env.local`, or `.env.production`. They hold secrets and are gitignored.
