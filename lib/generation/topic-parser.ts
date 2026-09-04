/**
 * Topic Parser - Extracts structured instructions from freeform user input.
 *
 * Users can type rich prompts like:
 *   "AI in healthcare diagnostics, focusing on imaging and excluding treatment"
 *
 * This module splits that into:
 *   - title: "AI in healthcare diagnostics"
 *   - customInstructions: "Focus on imaging, exclude treatment recommendations"
 *
 * Dropdowns (paperType, length, sources) are authoritative and never overridden.
 */

import { fog } from "@/lib/ai/foglamp";

const { generateObject } = fog.with({ traceName: "Topic parser" });
import { z } from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { createAzure } from "@ai-sdk/azure";
import { shouldUseAzureOpenAIForLLM, getAzureDeploymentForModel } from "../ai/config";

// Use GPT-4.1-mini for fast, cheap parsing
const PARSER_MODEL = "gpt-4.1-mini";

/**
 * Get the language model for topic parsing.
 * Uses Azure OpenAI if configured, otherwise falls back to OpenAI.
 */
function getParserModel() {
  if (shouldUseAzureOpenAIForLLM()) {
    const azure = createAzure({
      resourceName: process.env.AZURE_OPENAI_RESOURCE_NAME!,
      apiKey: process.env.AZURE_OPENAI_API_KEY!,
    });
    return azure.languageModel(getAzureDeploymentForModel(PARSER_MODEL));
  }
  
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
  });
  return openai.languageModel(PARSER_MODEL);
}

const ParsedTopicSchema = z.object({
  title: z
    .string()
    .describe(
      "The core research topic or paper title, cleaned of any instructional language. Should be a concise, academic-sounding topic statement."
    ),
  customInstructions: z
    .string()
    .nullable()
    .describe(
      "Any constraints, focus areas, exclusions, scope limitations, or methodology preferences the user specified. Return null if the input is just a simple topic with no additional instructions."
    ),
});

export type ParsedTopicResult = z.infer<typeof ParsedTopicSchema>;

const SYSTEM_PROMPT = `You are a topic parser for an academic paper generation system.

Given a user's freeform input, extract:
1. **title**: The core research topic or paper title. Remove instructional language ("write about", "research on", "I want a paper about"). Keep it concise and academic.
2. **customInstructions**: Any additional constraints, focus areas, exclusions, scope limitations, or methodology preferences. Return null if there are none.

RULES:
- Never override system parameters (paper type, length, sources) — those come from UI dropdowns.
- If the user mentions a paper type ("write a thesis about X"), ignore the paper type part and just extract the topic.
- If the user mentions length ("make it short", "a brief paper"), ignore the length part.
- Preserve the user's specific constraints verbatim when possible (focus areas, exclusions, regional scope, etc.)
- If the input is already a clean topic with no instructions, return customInstructions as null.

EXAMPLES:
Input: "The impact of AI on healthcare diagnostics"
→ title: "The impact of AI on healthcare diagnostics", customInstructions: null

Input: "Write about AI in healthcare, focusing specifically on diagnostic imaging and excluding treatment recommendations"
→ title: "AI in healthcare", customInstructions: "Focus specifically on diagnostic imaging. Exclude treatment recommendations."

Input: "Research on climate change adaptation in Southeast Asia, emphasizing economic impacts and using only papers from 2020 onwards"
→ title: "Climate change adaptation in Southeast Asia", customInstructions: "Emphasize economic impacts. Prioritize papers from 2020 onwards."

Input: "I want a detailed literature review about the effects of social media on adolescent mental health, but only looking at longitudinal studies"
→ title: "Effects of social media on adolescent mental health", customInstructions: "Focus on longitudinal studies only."`;

/**
 * Parse freeform user input into a clean title and optional custom instructions.
 * Returns quickly (~200-400ms) using GPT-4o-mini.
 *
 * Falls back gracefully: if parsing fails, returns the original input as-is.
 */
export async function parseTopicInput(
  rawInput: string
): Promise<ParsedTopicResult> {
  const trimmed = rawInput.trim();

  // Fast path: very short inputs are almost certainly just titles
  if (trimmed.length < 40 && !/[,;]/.test(trimmed) && !/\b(focus|exclude|only|but|specifically|emphasiz)/i.test(trimmed)) {
    return { title: trimmed, customInstructions: null };
  }

  try {
    const result = await generateObject({
      model: getParserModel(),
      schema: ParsedTopicSchema,
      system: SYSTEM_PROMPT,
      prompt: trimmed,
      temperature: 0,
    });

    const { title, customInstructions } = result.object;

    // Sanity check: title should not be empty
    if (!title || title.trim().length === 0) {
      return { title: trimmed, customInstructions: null };
    }

    return {
      title: title.trim(),
      customInstructions: customInstructions?.trim() || null,
    };
  } catch (error) {
    console.error("[topic-parser] Parsing failed, using raw input:", error);
    return { title: trimmed, customInstructions: null };
  }
}
