# Frontend State Audit

## React Query

Use React Query for remote data that benefits from caching, refetching, invalidation, or optimistic updates.

- `components/projects/projects-grid.tsx`: project list fetch
- `components/library/LibraryPage.tsx`: library data fetch plus bookmark/remove mutations
- `components/ui/use-library-drawer.ts`: library paging, remote search, rerank, and add-to-library mutation
- `components/editor/hooks/useEditorChat.ts`: chat history fetch and clear-history mutation
- `components/editor/hooks/usePaperManagement.ts`: add/remove paper mutations with optimistic updates
- `components/library/PaperDetailContent.tsx`: notes, add/remove library entry, and signed PDF actions
- `components/editor/CitationEditModal.tsx`: citation fetch and save mutation

## Local State

Keep local state for transient UI that should not be shared via URL or cache.

- `components/providers/AuthProvider.tsx`: hydrated client auth session state
- `components/ui/use-library-drawer.ts`: drawer open behavior, expanded abstract, temporary added/saved sets, file picker flow
- `components/editor/hooks/useEditorChat.ts`: pending tool review state, input text, ghost preview state
- `components/editor/hooks/usePaperManagement.ts`: remove-confirmation dialog state and optimistic local paper list
- `components/library/PaperDetailContent.tsx`: notes draft text, delete dialog visibility, PDF loading button state
- `components/editor/CitationEditModal.tsx`: modal form inputs before save

## URL State

Use URL state for shareable, refresh-safe view controls.

- `components/library/LibraryPage.tsx`: `q`, `sort`, `source`, `project`, and `bookmarked`

## Current Guidance

- Keep current React Query usage in the editor and paper-management flows.
- Keep modal, form draft, and one-off interaction state local.
- Prefer URL state next for any other searchable/filterable index pages that users may want to revisit or share.
