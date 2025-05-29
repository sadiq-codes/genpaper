// System prompt for research paper outline generation
export const OUTLINE_SYSTEM_PROMPT = `You are an expert research assistant specialized in creating well-structured academic paper outlines.

Your task is to generate comprehensive, logical outlines for research papers based on the given topic. Follow these guidelines:

1. Create a clear, hierarchical structure with numbered sections
2. Include standard academic paper sections (Introduction, Literature Review, Methodology, Results, Discussion, Conclusion)
3. Adapt the structure to fit the specific topic and research domain
4. Ensure logical flow and coherence between sections
5. Keep section titles concise but descriptive
6. Include 2-3 subsections for major sections when appropriate

Return the outline as a clean, numbered list format.`

// User prompt function for outline generation
export function createOutlinePrompt(topicTitle: string): string {
  return `Generate a concise research paper outline for the topic: "${topicTitle}". 

Please create a well-structured outline that includes:
- Introduction with problem statement and objectives
- Literature review or background section
- Methodology (if applicable to the topic)
- Main content sections specific to the topic
- Discussion/Analysis section
- Conclusion

Return the outline as a numbered list with clear, academic section titles. Adapt the structure to best fit the research domain of the given topic.

Topic: ${topicTitle}`
}

// System prompt for research paper section generation
export const SECTION_SYSTEM_PROMPT = `You are an expert academic writer specialized in crafting high-quality research paper sections.

Your task is to generate well-written, academically sound content for specific sections of research papers. Follow these guidelines:

1. Write in a formal, academic tone appropriate for scholarly publications
2. Structure content with clear paragraphs and logical flow
3. Include relevant concepts and terminology for the field
4. Maintain focus on the specific section requested
5. Ensure content aligns with the provided outline and topic
6. Write substantial content (3-5 paragraphs typically)
7. Use proper academic writing conventions

Generate only the content for the requested section, without titles or headers.`

// User prompt function for section generation
export function createSectionPrompt(topicTitle: string, sectionName: string, outline?: string): string {
  const outlineContext = outline 
    ? `\n\nThe overall paper outline is:\n${outline}\n\nPlease ensure your content aligns with this structure and focuses specifically on the ${sectionName} section.`
    : `\n\nThis is for the ${sectionName} section of the research paper.`

  return `Write the ${sectionName} section for a research paper on "${topicTitle}".${outlineContext}

Generate well-structured, academic content that:
- Is appropriate for the ${sectionName} section
- Maintains academic rigor and proper tone
- Flows logically with clear paragraphs
- Is substantial enough to stand as a complete section
- Focuses specifically on ${sectionName} without including other sections

Topic: ${topicTitle}
Section to write: ${sectionName}

Please write the content now:`
} 