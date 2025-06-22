/**
 * Demo: Before vs After - Unified Template Approach
 * Shows how we replaced 50+ hard-coded prompts with one intelligent skeleton
 */

// ========================================
// 🔴 BEFORE: Hard-coded prompt explosion
// ========================================

// Old approach: Separate function for each section type
function generateResultsPromptOLD(topic: string, papers: string[], options: any): PromptTemplate {
  return {
    systemPrompt: `You are writing the Results section of a research article. Present findings objectively...`,
    userPromptTemplate: `Write the Results section for "${topic}". Include statistical details, organize by research questions...`,
    requiredDepthCues: ['statistical precision', 'objective reporting']
  }
}

function generateMethodsPromptOLD(topic: string, papers: string[], options: any): PromptTemplate {
  return {
    systemPrompt: `You are writing the Methods section of a research article. Provide detailed procedures...`,
    userPromptTemplate: `Write the Methods section for "${topic}". Include detailed procedures, justify choices...`,
    requiredDepthCues: ['replication detail', 'methodological justification']
  }
}

function generateDiscussionPromptOLD(topic: string, papers: string[], options: any): PromptTemplate {
  return {
    systemPrompt: `You are writing the Discussion section of a research article. Interpret findings...`,
    userPromptTemplate: `Write the Discussion section for "${topic}". Interpret results, discuss implications...`,
    requiredDepthCues: ['interpretation', 'theoretical integration']
  }
}

// And 47 more functions like this... 😵

// Usage - requires knowing which function to call
function generateSectionOLD(paperType: string, section: string, options: any) {
  switch (section) {
    case 'results': return generateResultsPromptOLD(options.topic, options.papers, options)
    case 'methods': return generateMethodsPromptOLD(options.topic, options.papers, options)
    case 'discussion': return generateDiscussionPromptOLD(options.topic, options.papers, options)
    // ... 47 more cases
    default: return null
  }
}

// ========================================
// 🟢 AFTER: One unified skeleton template
// ========================================

// New approach: Single YAML template that adapts through data
const UNIFIED_SKELETON = `
system: |-
  You are drafting a scholarly paper that must read as a single, coherent narrative.
  Adopt an objective, academic tone and follow APA style.

user: |-
  ## Paper Details
  **Title:** {{paperTitle}}
  **Global Objectives:** {{paperObjectives}}
  
  ## Document Structure
  {{outlineTree}}
  
  ## Approved Sections Summary
  {{previousSectionsSummary}}
  
  ## Current Writing Task
  **Section Path:** {{sectionPath}}
  **Target Length:** {{targetWords}} words
  **Minimum Citations:** {{minCitations}} sources
  
  {{#currentText}}
  ### Current Draft
  {{currentText}}
  {{/currentText}}
  
  ### Evidence Context
  {{evidenceSnippets}}
  
  Write the {{sectionPath}} section maintaining coherence with approved sections.
`

// Single function that works for ANY section, block, or sentence
async function generateSectionNEW(context: SectionContext, options: BuildPromptOptions) {
  // Build contextual data
  const promptData = await buildUnifiedPrompt(context, options)
  
  // Fill the single template with different data
  const filled = Mustache.render(UNIFIED_SKELETON, promptData)
  
  // Generate content
  return await streamText({ prompt: filled })
}

// ========================================
// 🎯 MAGIC: Same skeleton, different behavior
// ========================================

// Example 1: Full Results section generation
const resultsContext = {
  projectId: 'proj-123',
  sectionId: 'results-section',
  sectionPath: 'Results',
  paperTitle: 'Machine Learning in Healthcare',
  paperObjectives: 'Evaluate ML model performance in medical diagnosis',
  outlineTree: '• Introduction\n• Methods\n• Results\n• Discussion',
  previousSectionsSummary: '**Methods:** Used random forest classifier on 1000 patient records...',
  targetWords: 1000,
  currentText: '', // Empty = new generation
  evidenceSnippets: '[{paper_id: "ml-2023", content: "Accuracy improved by 15%..."}]'
}

// Example 2: Block-level Methods rewrite
const methodsBlockContext = {
  ...resultsContext,
  sectionPath: 'Methods → Data Collection',
  targetWords: 300,
  currentText: 'We collected data from hospital systems...', // Has content = rewrite
}

// Example 3: Sentence-level edit
const sentenceContext = {
  ...resultsContext,
  sectionPath: 'Results → Statistical Analysis → P-values',
  targetWords: 25,
  sentenceMode: true,
  currentText: 'The results were significant.'
}

// All use the SAME template but get different behavior:

await generateSectionNEW(resultsContext, {})        // → Full Results section
await generateSectionNEW(methodsBlockContext, {})   // → Focused Methods block
await generateSectionNEW(sentenceContext, {})       // → Single improved sentence

// ========================================
// 📊 COMPARISON: What we gained
// ========================================

/*
BEFORE (Hard-coded approach):
❌ 50+ separate prompt functions
❌ Inconsistent quality across sections  
❌ No coherence between sections
❌ Hard to maintain and update
❌ No context awareness
❌ Duplicate prompt logic everywhere

AFTER (Unified approach):
✅ 1 skeleton template for everything
✅ Consistent quality through data
✅ Perfect coherence via rolling summaries
✅ Easy to update (edit YAML, not code)
✅ Full context awareness
✅ DRY principle - no duplication

SCALING:
- Before: Adding new section type = new function + switch case + testing
- After: Adding new section type = just add data mapping

MAINTENANCE:
- Before: Style change = update 50+ functions
- After: Style change = edit 1 YAML file

COHERENCE:
- Before: Each section generated in isolation
- After: Each section aware of entire document context
*/

// ========================================
// 🚀 REAL USAGE EXAMPLES
// ========================================

// Generate full paper with coherence
async function generateCoherentPaper() {
  const sections = ['introduction', 'methods', 'results', 'discussion']
  const generatedSections = []
  
  for (const section of sections) {
    const context = {
      projectId: 'paper-123',
      sectionId: `${section}-id`,
      sectionPath: section,
      paperTitle: 'Research Paper Title',
      paperObjectives: 'Study objectives...',
      outlineTree: buildOutlineTree(),
      previousSectionsSummary: buildRollingSummary(generatedSections), // 🔥 Coherence!
      targetWords: getSectionWordCount(section),
      evidenceSnippets: getRelevantEvidence(section)
    }
    
    const result = await generateSectionNEW(context, {})
    generatedSections.push(result)
  }
  
  return generatedSections // Each section perfectly coherent with previous ones!
}

// Edit specific block maintaining paper coherence
async function smartBlockEdit(blockId: string) {
  const context = await buildContextFromBlockId(blockId) // Gets full paper context
  
  const result = await generateSectionNEW(context, { 
    forceRewrite: true,
    targetWords: 200 
  })
  
  // Even small edits maintain coherence with entire document!
  return result
}

// ========================================
// 💡 KEY INSIGHT
// ========================================

/*
The magic isn't in the template - it's in the DATA you feed it:

OLD THINKING: "I need different prompts for different sections"
NEW THINKING: "I need different CONTEXT for the same prompt"

The unified skeleton is like a smart function that adapts its behavior 
based on the parameters you pass. Same code, different results.

This is the difference between:
- Hard-coding 50 if/else statements
- Writing one function that accepts parameters

Your prompt system just graduated from script to API.
*/

export {
  generateSectionNEW as generateWithUnifiedTemplate,
  UNIFIED_SKELETON,
  generateCoherentPaper,
  smartBlockEdit
} 