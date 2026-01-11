/**
 * Prompts for Paper Profile Generation
 * 
 * These prompts guide the LLM to generate contextual, discipline-aware
 * paper profiles that replace hardcoded rules.
 */

import type { ProfileGenerationInput } from './paper-profile-types'

interface PromptOutput {
  system: string
  user: string
}

/**
 * Generate the system and user prompts for paper profile generation
 */
export function getPaperProfilePrompt(input: ProfileGenerationInput): PromptOutput {
  const { topic, paperType, hasOriginalResearch, userContext } = input
  
  const system = `You are an expert academic advisor with deep knowledge across all disciplines. Your task is to analyze a research topic and paper type, then create a comprehensive profile that will guide paper generation.

Your profile must be:
- CONTEXTUAL: Specific to this topic and discipline, not generic advice
- PRACTICAL: Actionable guidance that can be directly used in generation
- ACCURATE: Reflect actual academic norms and expectations for this field
- COMPREHENSIVE: Cover structure, sources, quality criteria, and content coverage

You have expertise in identifying:
- What makes excellent papers in different disciplines and traditions
- Appropriate structure and sections for different paper types
- Source expectations (types, recency, quantity) by field
- Field-specific quality criteria and evaluation standards
- Common pitfalls and mistakes in different paper types

CRITICAL PRINCIPLE FOR ALL PAPER TYPES:
The profile you create will guide a writing system that uses REAL source documents.
- For Literature Reviews: The writer should ONLY cite information actually present in the provided sources
- For Research Articles: If this is a TEMPLATE/EXAMPLE paper, illustrative data may be generated, but this must be clearly marked as illustrative in the Limitations section
- NEVER encourage fabricating citations, statistics, or claims not supported by provided evidence
- Specificity should come from the ACTUAL sources available, not invented details

Different disciplines have different norms for evidence:
- Quantitative fields expect statistics, but only when sources provide them
- Qualitative fields expect themes and quotes from the actual evidence
- Theoretical fields expect precise argumentation based on cited frameworks
- Humanities expect textual evidence and close reading of actual sources

IMPORTANT: Your response must be valid JSON matching the schema exactly. Do not include any text outside the JSON object.`

  const paperTypeGuidance = getPaperTypeGuidance(paperType, hasOriginalResearch || false)
  
  const user = `ANALYZE THIS PAPER REQUEST AND CREATE A COMPREHENSIVE PROFILE:

Topic: "${topic}"
Paper Type: ${formatPaperType(paperType)}
${hasOriginalResearch ? 'Note: This paper presents ORIGINAL RESEARCH with data collection.\n' : ''}${userContext ? `Additional Context: ${userContext}\n` : ''}
${paperTypeGuidance}

Create a comprehensive paper profile by analyzing:

1. DISCIPLINE CONTEXT
   - What is the primary academic discipline for this topic?
   - What related fields inform this area?
   - What are the methodological traditions (quantitative, qualitative, mixed, theoretical)?
   - How fast-moving is this field? Is it theory-heavy or empirical-heavy?
   - Is practitioner relevance expected?

2. STRUCTURE GUIDANCE
   - What sections are APPROPRIATE for this specific ${formatPaperType(paperType)} on this topic?
   - For each section provide: key (camelCase), title, purpose, word range (min/max), citation expectation (none/light/moderate/heavy), and key elements that should appear
   - What sections would be INAPPROPRIATE for this paper type and why?
   - What elements are REQUIRED somewhere in the paper (e.g., theoretical framework, practical implications)?

3. SOURCE EXPECTATIONS
   - How many unique sources should a comprehensive ${formatPaperType(paperType)} on this topic cite? (Consider topic breadth and depth)
   - What is the ideal source count for excellence?
   - What types of sources are expected? (peer-reviewed journals, books, conference papers, industry reports, case studies, government data, etc.)
   - For each source type: approximate percentage and importance (required/recommended/optional)
   - Should recent literature be prioritized, or do foundational works matter equally?
   - Provide specific recency guidance for this field
   - Are there seminal works commonly cited in this area?

4. QUALITY CRITERIA
   - What specific criteria define excellence for this paper type in this discipline?
   - Provide 4-6 criteria, each with: name, description of what it means, and how to achieve it
   - Criteria should be specific to this topic/discipline, not generic

5. CONTENT COVERAGE
   - What themes MUST be addressed for comprehensive coverage of this topic?
   - What themes would strengthen the paper if included?
   - What scholarly debates or tensions exist in this area?
   - What methodological considerations are specific to this topic?
   - What common pitfalls should be avoided?

6. GENRE RULES
   - What rules define this paper type that must not be violated?
   - For each rule: state the rule and explain why it matters

Return a JSON object with this exact structure:
{
  "discipline": {
    "primary": "string",
    "related": ["string"],
    "methodologicalTraditions": ["string"],
    "fieldCharacteristics": {
      "paceOfChange": "rapid|moderate|slow",
      "theoryVsEmpirical": "theory-heavy|balanced|empirical-heavy",
      "practitionerRelevance": "high|medium|low"
    }
  },
  "structure": {
    "appropriateSections": [
      {
        "key": "string (camelCase)",
        "title": "string",
        "purpose": "string",
        "minWords": number,
        "maxWords": number,
        "citationExpectation": "none|light|moderate|heavy",
        "keyElements": ["string"]
      }
    ],
    "inappropriateSections": [
      { "name": "string", "reason": "string" }
    ],
    "requiredElements": ["string"]
  },
  "sourceExpectations": {
    "minimumUniqueSources": number,
    "idealSourceCount": number,
    "sourceTypeDistribution": [
      { "type": "string", "percentage": number, "importance": "required|recommended|optional" }
    ],
    "recencyProfile": "cutting-edge|balanced|foundational-heavy",
    "recencyGuidance": "string",
    "seminalWorks": ["string"] or null
  },
  "qualityCriteria": [
    {
      "criterion": "string",
      "description": "string",
      "howToAchieve": "string"
    }
  ],
  "coverage": {
    "requiredThemes": ["string"],
    "recommendedThemes": ["string"],
    "debates": ["string"],
    "methodologicalConsiderations": ["string"],
    "commonPitfalls": ["string"]
  },
  "genreRules": [
    { "rule": "string", "rationale": "string" }
  ]
}`

  return { system, user }
}

/**
 * Get paper type-specific guidance to include in the prompt
 */
function getPaperTypeGuidance(paperType: string, hasOriginalResearch: boolean): string {
  if (hasOriginalResearch) {
    return `EMPIRICAL RESEARCH PAPER CONTEXT:
This paper presents ORIGINAL RESEARCH with data collection. The profile should reflect:
- A detailed, reproducible Methodology section is REQUIRED
- Results section presents the author's OWN findings (minimal to no citations in Results)
- Discussion section interprets results and compares with existing literature
- The paper makes an original empirical contribution to the field
`
  }
  
  switch (paperType) {
    case 'literatureReview':
      return `LITERATURE REVIEW CONTEXT:
This paper SYNTHESIZES existing research - it does NOT involve original data collection.

CRITICAL DISTINCTIONS:
- "Methodology" for a literature review means the LITERATURE SEARCH methodology:
  * Which databases were searched (e.g., Web of Science, Scopus, PubMed)
  * What keywords and search strings were used
  * What date range was covered
  * What inclusion/exclusion criteria were applied
  * How many papers were screened and selected
  
- "Methodology" does NOT mean empirical research methodology:
  * NO descriptions of data collection procedures
  * NO descriptions of surveys, interviews, or experiments conducted
  * NO sample sizes or participant recruitment
  * NO statistical analysis of original data

- A literature review should NOT have a "Results" section presenting original findings
- Instead, use sections like "Findings", "Thematic Analysis", or "Synthesis"
- The paper should emphasize: synthesis across sources, critical analysis, gap identification
- Source diversity and comprehensiveness are CRUCIAL for literature reviews
- The reader should gain a comprehensive understanding of the state of knowledge

ORGANIZATIONAL APPROACH (Choose based on topic):
The literature review should be organized using ONE of these approaches (or a combination):

1. **THEMATIC** - Organize by recurring themes or concepts
   Best when: The topic has multiple distinct aspects or sub-areas
   Example: "Barriers to healthcare" → policy barriers, economic barriers, cultural barriers, geographic barriers
   
2. **CHRONOLOGICAL** - Trace the development of ideas over time
   Best when: The topic has evolved significantly, showing how understanding changed
   Example: "Distance learning" → correspondence courses → video lectures → MOOCs → AI tutors
   
3. **METHODOLOGICAL** - Compare findings from different research approaches
   Best when: Different methods yield different insights or conflicting results
   Example: "Employee motivation" → survey studies vs. experimental studies vs. qualitative interviews
   
4. **THEORETICAL** - Organize by competing theories or frameworks
   Best when: Multiple theoretical perspectives explain the phenomenon
   Example: "Organizational change" → planned change theory vs. emergent change vs. complexity theory

Choose the approach that best illuminates the topic. For complex topics, COMBINE approaches
(e.g., thematic overall with chronological development within each theme).

PIVOTAL PUBLICATIONS:
Identify and highlight LANDMARK STUDIES that shaped the field:
- Foundational works that established key concepts or frameworks
- Studies that challenged prevailing assumptions and redirected research
- Methodological innovations that changed how the topic is studied
- Highly influential works that many subsequent studies cite or build upon

When discussing landmark studies, explain their INFLUENCE:
"Bandura's (1977) social learning theory was pivotal because it expanded behavioral 
explanations to include cognitive and social factors, fundamentally changing how 
researchers approached skill acquisition and spawning decades of self-efficacy research."

LITERATURE REVIEW STRUCTURE:
The review must have clear Introduction, Body, and Conclusion:

**INTRODUCTION** should:
- Establish the focus, scope, and purpose of the review
- Define key terms and boundaries (what's included/excluded)
- State the research question or gap being addressed
- Preview the organizational approach you're using

**BODY** should:
- Follow your chosen organizational approach (thematic, chronological, etc.)
- Use clear subheadings for each major section
- Synthesize sources WITHIN each section (don't just list studies)
- Show connections and transitions BETWEEN sections
- Identify contradictions, debates, and patterns

**CONCLUSION** should:
- Summarize the key findings from the reviewed literature
- Emphasize the significance of these findings
- Clearly state the gap in knowledge that remains
- Explain how future research (or your research) addresses this gap

CRITICAL ANALYSIS REQUIREMENTS (Include in Quality Criteria):
A literature review MUST include critical analysis, not just summaries. The profile's qualityCriteria MUST include:
1. "Identification of contradictions and debates between sources"
2. "Critical evaluation of methodological strengths and limitations"
3. "Synthesis showing patterns across multiple studies"
4. "Discussion of unresolved tensions in the literature"
5. "Identification of pivotal/landmark publications and their influence"

WHEN TO CITE IN LITERATURE REVIEWS:
Since a literature review synthesizes existing research, MOST claims require citations:
- ALWAYS cite: statistics, findings, theories, methods, opinions from other authors
- ALWAYS cite: specific claims, definitions, frameworks from the literature
- ALWAYS cite: when comparing or contrasting what different authors found
- NO citation needed: your own synthesis, analysis, or conclusions drawn from cited work
- NO citation needed: widely accepted common knowledge in the field

In literature reviews, most paragraphs should contain multiple citations because you are 
reporting what the literature says. Only your analytical observations connecting sources 
do not require citations.

⚠️ CRITICAL: ONLY CITE WHAT IS IN THE PROVIDED SOURCES
- Include statistics, sample sizes, and specific findings ONLY if they appear in the evidence
- If a source doesn't provide specific numbers, describe the findings qualitatively
- NEVER fabricate statistics, percentages, or specific claims not in the sources
- It is better to write "Smith (2020) found a positive relationship" than to invent "r=0.45"
- Different disciplines have different norms: qualitative research may not have statistics
`

    case 'mastersThesis':
      return `MASTER'S THESIS CONTEXT:
A master's thesis demonstrates mastery of research methods and makes a meaningful contribution to the field.

STRUCTURE EXPECTATIONS:
1. **Introduction** (Funnel Structure):
   - Start broad: general topic and its importance
   - Narrow down: specific area of investigation
   - State: research problem, purpose, questions/hypotheses
   - Preview: significance and scope of study

2. **Literature Review** (Critical Analysis Required):
   - Synthesize existing research, don't just summarize
   - Identify debates, contradictions, and gaps
   - Justify how YOUR study addresses the gap
   - End with clear statement of what remains unknown
   
   ORGANIZATIONAL APPROACH - Choose based on your topic:
   * THEMATIC: Organize by themes (best for multi-faceted topics)
   * CHRONOLOGICAL: Trace development over time (best for evolving topics)
   * METHODOLOGICAL: Compare research approaches (best for method-diverse topics)
   * THEORETICAL: Organize by competing theories (best for theory-rich topics)
   
   PIVOTAL PUBLICATIONS: Identify landmark studies that shaped the field and 
   explain WHY they were influential (not just what they found).

3. **Methodology** (Replicable Detail):
   - Research design with justification
   - Population and sampling (who, how many, how selected)
   - Instruments with validity and reliability evidence
   - Data collection procedures
   - Analysis methods with justification

4. **Results** (Systematic Presentation):
   - Present findings without interpretation
   - Use tables and figures appropriately
   - Organize by research questions/hypotheses
   - Include summary of key findings

5. **Discussion** (Three-Part Structure for Each Finding):
   - STATE: What did you find?
   - COMPARE: How does it align/contrast with prior research?
   - EXPLAIN: Why might your results agree or differ?

6. **Conclusion**:
   - Implications (theoretical and practical)
   - Limitations acknowledged honestly
   - Recommendations for future research

CITING EMPIRICAL STUDIES IN LITERATURE REVIEW:
When reviewing prior research, include context about methodology:
- Weak: "Smith (2020) found motivation affects performance."
- Strong: "Smith (2020) surveyed 250 undergraduates and found intrinsic motivation 
  significantly predicted GPA (β = 0.42, p < .001), though the cross-sectional design 
  limits causal inference."

GAP IDENTIFICATION IS MANDATORY:
Your literature review must explicitly state what gap exists and how your study addresses it.
`

    case 'phdDissertation':
      return `PHD DISSERTATION CONTEXT:
A doctoral dissertation represents an ORIGINAL CONTRIBUTION TO KNOWLEDGE in the field.

STRUCTURE EXPECTATIONS (Highest Standards):
1. **Introduction** (Funnel Structure):
   - Broad context: significance of the research area
   - Narrow focus: specific problem being addressed
   - Clear statement: research questions/hypotheses
   - Contribution preview: what this dissertation adds to knowledge

2. **Literature Review** (Exhaustive and Critical):
   - Comprehensive coverage of relevant literature
   - Critical analysis of theories, methods, and findings
   - Identification of contradictions and debates in the field
   - Clear articulation of the gap your research fills
   - Theoretical/conceptual framework guiding the study
   
   ORGANIZATIONAL APPROACH - Choose the most illuminating structure:
   * THEMATIC: Organize by recurring themes or concepts
   * CHRONOLOGICAL: Trace how understanding evolved over time
   * METHODOLOGICAL: Compare findings from different research approaches
   * THEORETICAL: Examine competing theoretical perspectives
   * COMBINED: Use thematic structure with chronological development within themes
   
   PIVOTAL PUBLICATIONS (Required at doctoral level):
   - Identify foundational works that established key concepts
   - Highlight studies that redirected the field's direction
   - Explain the INFLUENCE of landmark studies, not just their findings
   - Show how your work builds on or challenges these pivotal contributions

3. **Methodology** (Rigorous and Justified):
   - Philosophical underpinnings (epistemology, ontology if relevant)
   - Research design with thorough justification
   - Detailed sampling strategy
   - Instruments with validity and reliability evidence
   - Ethical considerations
   - Detailed procedures for data collection and analysis
   - Strategies for ensuring trustworthiness/rigor

4. **Results** (Comprehensive Presentation):
   - Systematic presentation aligned with research questions
   - Appropriate use of tables, figures, and statistical reporting
   - For qualitative: themes with rich supporting evidence
   - Summary of findings

5. **Discussion** (Three-Part Structure - Rigorous):
   For EACH major finding:
   - STATE: Present the finding clearly
   - COMPARE: Discuss alignment/contradiction with existing literature
   - EXPLAIN: Provide theoretical explanation for agreement/disagreement
   - EXTEND: Discuss implications for theory and practice

6. **Contribution to Knowledge** (REQUIRED):
   - Explicitly state what NEW knowledge this dissertation provides
   - How does it advance theory in the field?
   - How does it inform practice?

7. **Conclusion**:
   - Theoretical and practical implications
   - Honest acknowledgment of limitations
   - Specific recommendations for future research
   - Final statement of contribution

CITING EMPIRICAL STUDIES:
For doctoral-level work, provide methodological context when citing:
- Include: purpose, sample/method, key findings, and limitations
- This demonstrates critical engagement with the literature

GAP IDENTIFICATION IS MANDATORY:
The literature review must build a compelling case for why this study is necessary.
`

    case 'capstoneProject':
      return `CAPSTONE PROJECT CONTEXT:
A capstone project demonstrates your ability to conduct independent research and apply 
knowledge from your program of study. It should meet rigorous academic standards.

STRUCTURE EXPECTATIONS:
1. **Introduction** (Use Funnel Structure):
   - Start BROAD: Introduce the general topic and its importance (global/societal level)
   - NARROW DOWN: Focus on the specific area you're investigating
   - STATE THE PROBLEM: What gap or issue does your study address?
   - PURPOSE: Clear statement of what your study aims to accomplish
   - SIGNIFICANCE: Who benefits from this research and how?
   - SCOPE: Define the boundaries of your study

2. **Literature Review** (Critical Analysis, Not Just Summary):
   - Synthesize existing research to show patterns and themes
   - Identify debates, contradictions, and tensions in the literature
   - Evaluate methodological strengths and limitations of prior studies
   - EXPLICITLY STATE THE GAP your study addresses
   - End with justification for why your study is needed
   
   ORGANIZATIONAL APPROACH - Choose based on your topic:
   * THEMATIC: Group by themes (e.g., economic factors, social factors, policy factors)
   * CHRONOLOGICAL: Show how understanding evolved (e.g., 1990s → 2000s → 2010s → present)
   * METHODOLOGICAL: Compare quantitative vs. qualitative findings
   * THEORETICAL: Examine different theoretical explanations
   
   PIVOTAL PUBLICATIONS: Identify and discuss landmark studies that shaped the field.
   Explain WHY they were influential, not just what they found.

3. **Methodology** (Detailed and Replicable):
   - Research design with justification for your choice
   - Population and sample (who, how many, how selected)
   - Instruments/measures (describe and justify)
   - Validity and reliability of instruments
   - Data collection procedures (step by step)
   - Method of data analysis (statistical tests or qualitative approach)

4. **Results** (Present Without Interpretation):
   - Present findings systematically (by research question or hypothesis)
   - Use tables and figures appropriately
   - Report statistics completely (means, SDs, test statistics, p-values, effect sizes)
   - Include a summary of key findings at the end

5. **Discussion** (Three-Part Structure for EACH Finding):
   For every major finding, you MUST:
   - STATE: "Our results showed that..." (what did you find?)
   - COMPARE: "This aligns with / contradicts Smith (2020) who found..."
   - EXPLAIN: "This difference may be explained by..." (why agree/disagree?)
   
   Do NOT simply restate results. Connect each finding to existing literature.

6. **Conclusion**:
   - Implications: What do your findings mean for theory and practice?
   - Limitations: Honest acknowledgment of study constraints
   - Recommendations: Practical suggestions based on findings
   - Future Research: What questions remain unanswered?

CITING EMPIRICAL STUDIES IN LITERATURE REVIEW:
When reviewing prior research, provide methodological context:
- WEAK: "Jones (2019) found that motivation affects learning."
- STRONG: "Jones (2019) surveyed 180 high school students using the Academic 
  Motivation Scale and found that intrinsic motivation significantly predicted 
  test scores (r = .45, p < .01), though the sample was limited to urban schools."

This level of detail shows you understand how methodology affects findings.

GAP IDENTIFICATION (REQUIRED):
After reviewing literature, explicitly state:
- What has been studied extensively
- What remains understudied or contested  
- How YOUR study addresses this gap

Example: "Despite extensive research on motivation in university settings, few studies 
have examined its role in online learning environments. This gap is significant because..."
`

    case 'researchArticle':
      return `RESEARCH ARTICLE CONTEXT:
A research article presents ORIGINAL EMPIRICAL RESEARCH - NOT a literature review.

═══════════════════════════════════════════════════════════════════════════════
⚠️  CRITICAL: THIS IS EMPIRICAL RESEARCH - NOT A LITERATURE REVIEW  ⚠️
═══════════════════════════════════════════════════════════════════════════════

MANDATORY SECTIONS FOR RESEARCH ARTICLES:
1. **Introduction** - Research problem, significance, and specific research questions/hypotheses
2. **Literature Review** - Brief review to establish theoretical framework (NOT the main content)
3. **Methodology** - EMPIRICAL research design:
   * Sample/participants description (who, how many, how selected)
   * Variables (independent, dependent, control)
   * Data collection methods (surveys, experiments, observations, datasets used)
   * Analytical methods (regression, ANOVA, qualitative coding, etc.)
   * Validity and reliability measures
4. **Results** - YOUR ORIGINAL FINDINGS:
   * Descriptive statistics (means, SDs, frequencies)
   * Inferential statistics with p-values, confidence intervals
   * Tables and figures presenting YOUR data
   * Hypothesis testing outcomes (supported/not supported)
5. **Discussion** - Interpretation of YOUR results in context of existing literature
6. **Limitations** - Honest assessment of study constraints
7. **Conclusion** - Summary of YOUR contributions and implications

FORBIDDEN FOR RESEARCH ARTICLES:
- "Thematic Analysis" as a main section (that's for lit reviews)
- Reporting what OTHER studies found as your main content
- Literature search methodology (that's for systematic reviews)
- Sections that only summarize existing work without original data

═══════════════════════════════════════════════════════════════════════════════
📊 HANDLING RESEARCH DATA IN RESEARCH ARTICLES
═══════════════════════════════════════════════════════════════════════════════

Research articles present ORIGINAL findings. How data is handled depends on context:

**SCENARIO A: User provides their own research data**
If the user has provided their own methodology, results, or data:
- Use THEIR actual data and findings
- Do NOT fabricate or replace their numbers
- Format their data properly with statistics

**SCENARIO B: Template/Example paper (no user data provided)**
If this is a demonstration of research article format WITHOUT real data:
- Generate ILLUSTRATIVE data that demonstrates proper format
- Make numbers realistic and internally consistent
- CLEARLY STATE in Limitations: "This paper presents illustrative data to demonstrate 
  research article structure. Actual research would require primary data collection."

**SCENARIO C: Literature-based research article**
If the research uses secondary data from cited sources:
- Only include statistics that appear in the cited sources
- Do NOT fabricate numbers not in the evidence
- Clearly attribute all data to sources

REQUIRED FORMAT FOR RESULTS (when data is available):

**Descriptive Statistics Table:**
| Variable | N | Mean | SD | Min | Max |
|----------|---|------|-----|-----|-----|
| Variable 1 | 247 | 3.45 | 1.12 | 1 | 5 |

**Analysis Results Table:**
| Predictor | β | SE | t | p | 95% CI |
|-----------|-----|------|------|-------|--------------|
| Predictor 1 | 0.34 | 0.08 | 4.25 | <.001 | [0.18, 0.50] |

**Hypothesis testing format:**
- "H1 was supported: X significantly predicted Y (β = 0.34, p < .001)"
- "H2 was not supported: no significant relationship (β = -0.12, p = .184)"

KEY PRINCIPLE: Be specific when data is available, but NEVER fabricate data 
and claim it's real research. Transparency about data sources is essential.

WHEN TO CITE IN RESEARCH ARTICLES (Section-Specific):

**Introduction:** Cite when establishing the research problem, prior work, and theoretical background.
  - Cite: statistics showing the importance of the problem
  - Cite: prior findings that motivate your research question
  - Cite: theories or frameworks you're building on

**Literature Review:** Cite extensively - you're reporting what others found.
  - Cite: every finding, theory, or method you discuss from another author
  - No citation: your synthesis or identification of gaps

**Methodology:** Cite sparingly - only for established methods.
  - Cite: validated instruments, scales, or procedures from published sources
  - Cite: methodological frameworks you're following
  - No citation: descriptions of YOUR specific procedures

**Results:** MINIMAL TO NO CITATIONS - these are YOUR findings.
  - No citation: your data, statistics, tables, and findings
  - Rare citation: only if directly comparing your result to a specific prior finding

**Discussion:** Moderate citations - interpreting YOUR results in context.
  - Cite: when comparing your findings to prior work
  - Cite: theories that help explain your results
  - No citation: your interpretations, implications, and conclusions

**Limitations/Conclusion:** Minimal citations.
  - Cite: only if referencing specific methodological literature
  - No citation: your own assessment of limitations and contributions

APPROPRIATE LANGUAGE:
- "Our findings indicate..." / "The results show..."
- "We found that X was significantly related to Y (β = 0.45, p < 0.01)"
- "Hypothesis 1 was supported: entrepreneurs with prior experience..."
- "Our data suggest..."

INAPPROPRIATE LANGUAGE (Literature Review Style):
- "Studies have shown..." / "Research indicates..."
- "According to Smith (2020)..."
- "The literature suggests..."
- "Scholars have found..."

The profile's qualityCriteria MUST include:
1. "Clear hypothesis or research question formulation"
2. "Rigorous empirical methodology with defined sample and variables"
3. "Original data presentation with statistical evidence including tables"
4. "Specific statistical results (β coefficients, p-values, confidence intervals)"
5. "Interpretation of findings in theoretical context"
`

    default:
      return ''
  }
}

/**
 * Format paper type for display in prompts
 */
function formatPaperType(paperType: string): string {
  const formatMap: Record<string, string> = {
    'literatureReview': 'Literature Review',
    'researchArticle': 'Research Article',
    'mastersThesis': "Master's Thesis",
    'phdDissertation': 'PhD Dissertation',
    'capstoneProject': 'Capstone Project'
  }
  return formatMap[paperType] || paperType
}

/**
 * JSON Schema for validating the profile response
 * Used for structured output mode
 */
export const PAPER_PROFILE_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    discipline: {
      type: 'object' as const,
      properties: {
        primary: { type: 'string' as const },
        related: { type: 'array' as const, items: { type: 'string' as const } },
        methodologicalTraditions: { type: 'array' as const, items: { type: 'string' as const } },
        fieldCharacteristics: {
          type: 'object' as const,
          properties: {
            paceOfChange: { type: 'string' as const, enum: ['rapid', 'moderate', 'slow'] },
            theoryVsEmpirical: { type: 'string' as const, enum: ['theory-heavy', 'balanced', 'empirical-heavy'] },
            practitionerRelevance: { type: 'string' as const, enum: ['high', 'medium', 'low'] }
          },
          required: ['paceOfChange', 'theoryVsEmpirical', 'practitionerRelevance']
        }
      },
      required: ['primary', 'related', 'methodologicalTraditions', 'fieldCharacteristics']
    },
    structure: {
      type: 'object' as const,
      properties: {
        appropriateSections: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              key: { type: 'string' as const },
              title: { type: 'string' as const },
              purpose: { type: 'string' as const },
              minWords: { type: 'number' as const },
              maxWords: { type: 'number' as const },
              citationExpectation: { type: 'string' as const, enum: ['none', 'light', 'moderate', 'heavy'] },
              keyElements: { type: 'array' as const, items: { type: 'string' as const } }
            },
            required: ['key', 'title', 'purpose', 'minWords', 'maxWords', 'citationExpectation', 'keyElements']
          }
        },
        inappropriateSections: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              name: { type: 'string' as const },
              reason: { type: 'string' as const }
            },
            required: ['name', 'reason']
          }
        },
        requiredElements: { type: 'array' as const, items: { type: 'string' as const } }
      },
      required: ['appropriateSections', 'inappropriateSections', 'requiredElements']
    },
    sourceExpectations: {
      type: 'object' as const,
      properties: {
        minimumUniqueSources: { type: 'number' as const },
        idealSourceCount: { type: 'number' as const },
        sourceTypeDistribution: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              type: { type: 'string' as const },
              percentage: { type: 'number' as const },
              importance: { type: 'string' as const, enum: ['required', 'recommended', 'optional'] }
            },
            required: ['type', 'percentage', 'importance']
          }
        },
        recencyProfile: { type: 'string' as const, enum: ['cutting-edge', 'balanced', 'foundational-heavy'] },
        recencyGuidance: { type: 'string' as const },
        seminalWorks: { type: 'array' as const, items: { type: 'string' as const } }
      },
      required: ['minimumUniqueSources', 'idealSourceCount', 'sourceTypeDistribution', 'recencyProfile', 'recencyGuidance']
    },
    qualityCriteria: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          criterion: { type: 'string' as const },
          description: { type: 'string' as const },
          howToAchieve: { type: 'string' as const }
        },
        required: ['criterion', 'description', 'howToAchieve']
      }
    },
    coverage: {
      type: 'object' as const,
      properties: {
        requiredThemes: { type: 'array' as const, items: { type: 'string' as const } },
        recommendedThemes: { type: 'array' as const, items: { type: 'string' as const } },
        debates: { type: 'array' as const, items: { type: 'string' as const } },
        methodologicalConsiderations: { type: 'array' as const, items: { type: 'string' as const } },
        commonPitfalls: { type: 'array' as const, items: { type: 'string' as const } }
      },
      required: ['requiredThemes', 'recommendedThemes', 'debates', 'methodologicalConsiderations', 'commonPitfalls']
    },
    genreRules: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          rule: { type: 'string' as const },
          rationale: { type: 'string' as const }
        },
        required: ['rule', 'rationale']
      }
    }
  },
  required: ['discipline', 'structure', 'sourceExpectations', 'qualityCriteria', 'coverage', 'genreRules']
}
