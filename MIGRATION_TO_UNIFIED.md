# Migration Guide: From Hard-coded Prompts to Unified Template System

## Overview

This guide helps you migrate from the legacy hard-coded prompt system (50+ separate functions) to the unified template approach that uses **one intelligent skeleton** with contextual data.

## What Changed

### Before: Hard-coded Prompts
```typescript
// Separate function for each section type
generateLiteratureReviewPrompt(topic, papers, options)
generateMethodologyPrompt(topic, papers, options)
generateDiscussionPrompt(paperType, options)
// ... 47 more functions
```

### After: Unified Template
```typescript
// Single template with contextual data
buildUnifiedPrompt(context, options)
```

## Migration Steps

### 1. Update Imports

**Old:**
```typescript
import { 
  generateSectionPrompt,
  generateLiteratureReviewPrompt,
  generateMethodologyPrompt 
} from '@/lib/prompts/generators'
```

**New:**
```typescript
import { buildUnifiedPrompt } from '@/lib/prompts/unified/prompt-builder'
import { generateWithUnifiedTemplate } from '@/lib/generation/unified-generator'
```

### 2. Replace Section Generation Calls

**Old approach:**
```typescript
// Generate literature review
const prompt = generateLiteratureReviewPrompt(topic, papers, {
  paperType: 'researchArticle',
  expectedWords: 1200,
  contextChunks: chunks
})

const result = await streamText({
  system: prompt.systemPrompt,
  prompt: prompt.userPromptTemplate,
  // ... AI SDK config
})
```

**New approach:**
```typescript
// Create unified context
const context = {
  projectId: 'project-123',
  sectionId: 'lit-review-001',
  paperType: 'researchArticle',
  sectionKey: 'literatureReview',
  availablePapers: papers,
  contextChunks: chunks
}

// Generate with unified template
const result = await generateWithUnifiedTemplate({
  context,
  options: { targetWords: 1200 },
  enableReflection: true,
  enableDriftDetection: true
})
```

### 3. Update Block Runner Integration

**Old (block-runner.ts):**
```typescript
const { generateSectionPrompt } = await import('@/lib/prompts/generators')
const sectionPrompt = generateSectionPrompt(
  config?.paper_settings?.paperType || 'researchArticle',
  section.sectionKey,
  { topic, paperIds, expectedWords, contextChunks }
)
```

**New (block-runner.ts):**
```typescript
const { buildUnifiedPrompt } = await import('@/lib/prompts/unified/prompt-builder')

const unifiedContext = {
  projectId: documentId,
  sectionId: `${documentId}-section-${i}`,
  paperType: config?.paper_settings?.paperType || 'researchArticle',
  sectionKey: section.sectionKey,
  availablePapers: section.candidatePaperIds,
  contextChunks: section.contextChunks
}

const promptData = await buildUnifiedPrompt(unifiedContext, {
  targetWords: section.expectedWords
})
```

### 4. Leverage Coherence Features

**Key advantage of unified system:** Automatic coherence through rolling summaries

```typescript
// Generate multiple sections with coherence
const sections = ['introduction', 'methodology', 'results', 'discussion']
const contexts = sections.map((section, idx) => ({
  projectId: 'paper-123',
  sectionId: `section-${idx}`,
  paperType: 'researchArticle',
  sectionKey: section,
  availablePapers: paperIds,
  contextChunks: getRelevantChunks(section)
}))

// Batch generation maintains coherence automatically
const results = await generateMultipleSectionsUnified(contexts)
```

## API Endpoint Migration

### Old Endpoints
- `/api/generate` - Used hard-coded prompts
- `/api/generate/section` - Section-specific generation
- `/api/generate/outline` - Outline generation

### New Unified Endpoint
- `/api/generate/unified` - Handles all generation types

**Example usage:**
```typescript
// Full section generation
await fetch('/api/generate/unified', {
  method: 'POST',
  body: JSON.stringify({
    action: 'generate',
    context: { /* section context */ },
    options: { targetWords: 1000 }
  })
})

// Block-level rewrite
await fetch('/api/generate/unified', {
  method: 'POST',
  body: JSON.stringify({
    action: 'rewrite',
    context: { /* includes blockId */ },
    options: { forceRewrite: true }
  })
})

// Sentence-level edit
await fetch('/api/generate/unified', {
  method: 'POST',
  body: JSON.stringify({
    action: 'edit',
    context: { /* includes blockId */ },
    options: { sentenceMode: true, targetWords: 30 }
  })
})
```

## Benefits After Migration

### 1. **Automatic Coherence**
- Rolling summaries maintain narrative flow
- Consistent terminology across sections
- Topic drift detection

### 2. **Simplified Maintenance**
- Change prompts in ONE YAML file
- No more updating 50+ functions
- A/B testing through versioning

### 3. **Better Quality Control**
- Unified metrics tracking
- Consistent reflection system
- Automated quality scoring

### 4. **Scalability**
- Same system for sentences → blocks → sections → papers
- Easy to add new paper types
- No code changes for prompt updates

## Cleanup Checklist

After migration, you can safely remove:

- [ ] Legacy prompt generation functions in `generators.ts` (keep only for backward compatibility)
- [ ] Unused template files if no longer referenced
- [ ] Old prompt registry code if replaced by unified system
- [ ] Test files for legacy prompt functions

## Testing the Migration

Run the coherence test to verify the unified system works:

```bash
npm test test/generation/unified-coherence.test.ts
```

This test demonstrates:
- Multi-section generation with coherence
- Consistent terminology maintenance
- Topic drift detection

## Common Issues & Solutions

### Issue: "No prompt template found"
**Solution:** Ensure the unified skeleton.yaml file exists at `lib/prompts/unified/skeleton.yaml`

### Issue: Missing context data
**Solution:** The unified system requires full context. Ensure you provide:
- `projectId` and `sectionId`
- `paperType` and `sectionKey`
- `availablePapers` and `contextChunks`

### Issue: Quality scores differ from legacy system
**Solution:** The unified system uses more comprehensive quality metrics. Adjust thresholds accordingly.

## Next Steps

1. **Update all generation calls** to use unified approach
2. **Remove deprecated functions** after confirming everything works
3. **Monitor quality metrics** to fine-tune the unified template
4. **Implement embedding-based drift detection** for production

The unified template system transforms your prompt management from a maintenance burden to a scalable, coherent content generation platform. 