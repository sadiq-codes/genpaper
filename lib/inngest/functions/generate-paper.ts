/**
 * Inngest Function: Paper Generation (Stepified)
 * 
 * This function runs the paper generation pipeline as multiple steps,
 * enabling execution on Vercel Hobby plan (60s timeout per step).
 * 
 * Each step runs as a separate serverless invocation, so the total
 * pipeline can take 10+ minutes while each individual step stays
 * under the 60-second limit.
 * 
 * NOTE: Data passed between Inngest steps is serialized to JSON.
 * We use type assertions (as any) at serialization boundaries.
 */

import { inngest } from "../client";
import {
  updateRunStatus,
  emitProgress,
  emitTextChunk,
  emitSectionStart,
  emitSectionComplete,
  emitComplete,
  emitError,
  emitCancelled,
  getRun,
} from "@/lib/generation/run-manager";
import type { PaperTypeKey, GeneratedOutline, SectionContext } from "@/lib/prompts/types";
import type { PaperProfile } from "@/lib/generation/paper-profile-types";
import type { EnrichedSectionContext } from "@/lib/synthesis-engine/outline-enricher";

// Step result types - these are JSON-serializable
interface ProfileStepResult {
  profile: any; // PaperProfile serialized
  sanitizedTopic: string;
}

interface DiscoveryStepResult {
  papers: any[]; // SerializedPaper[]
  uploadedCount: number;
  onlineCount: number;
}

interface ThemeStepResult {
  hybridResult: any | null; // HybridThemeExtractionResult serialized
  analysisResult: any | null; // AnalysisResult serialized  
  enhancedProfile: any; // PaperProfile serialized
}

interface OutlineStepResult {
  outline: any; // GeneratedOutline serialized
  sectionCount: number;
}

interface ContextStepResult {
  contexts: any[]; // SectionContext[] serialized
  sectionsWithSynthesis: number;
}

interface SectionStepResult {
  content: string;
  citations: Array<{ index: number; paperId: string; quote: string }>;
  sectionIndex: number;
  sectionTitle: string;
  sectionKey: string;
}

export const generatePaperFunction = inngest.createFunction(
  {
    id: "generate-paper",
    cancelOn: [
      {
        event: "paper/generation.cancel",
        match: "data.runId",
      },
    ],
    retries: 1,
    concurrency: {
      limit: 1,
      key: "event.data.userId",
    },
  },
  { event: "paper/generation.start" },
  async ({ event, step }) => {
    const { runId, projectId, userId, config } = event.data;

    // Helper to check cancellation
    const checkCancellation = async (): Promise<boolean> => {
      const run = await getRun(runId);
      if (!run || run.status === "cancelled") {
        await emitCancelled(runId);
        return true;
      }
      return false;
    };

    // =========================================================================
    // Step 1: Mark Started
    // =========================================================================
    const started = await step.run("mark-started", async () => {
      await updateRunStatus(runId, "running", {
        progress: 0,
        current_stage: "initialization",
      });
      await emitProgress(runId, "initialization", 0, "Starting paper generation...");
      return { started: true };
    });

    if (!started) {
      return { cancelled: true };
    }

    // =========================================================================
    // Step 2: Generate Paper Profile
    // =========================================================================
    const profileResult = await step.run("generate-profile", async (): Promise<ProfileStepResult | null> => {
      if (await checkCancellation()) {
        return null;
      }

      await emitProgress(runId, "profiling", 2, "Analyzing your topic...");

      const { sanitizeTopic } = await import("@/lib/utils/prompt-safety");
      const { generatePaperProfile } = await import("@/lib/generation/paper-profile");
      const { updateProjectVoiceProfile } = await import("@/lib/db/research");
      const { info, warn } = await import("@/lib/utils/logger");

      const sanitizedTopic = sanitizeTopic(config.topic);

      const profile = await generatePaperProfile({
        topic: sanitizedTopic,
        paperType: config.paperType as PaperTypeKey,
        hasOriginalResearch: config.originalResearch?.has_original_research,
        userContext: undefined,
      });

      info({
        discipline: profile.discipline.primary,
        sections: profile.structure.appropriateSections.map((s: any) => s.key),
        minSources: profile.sourceExpectations.minimumUniqueSources,
      }, "Paper profile generated");

      // Persist voice profile
      if (profile.voice?.profileId) {
        try {
          await updateProjectVoiceProfile(projectId, profile.voice.profileId);
        } catch (e) {
          warn({ error: e }, "Failed to persist voice profile");
        }
      }

      await emitProgress(runId, "profiling", 8, `Identified as ${profile.discipline.primary} research`);

      return { profile, sanitizedTopic };
    });

    if (!profileResult) {
      return { cancelled: true };
    }

    // Cast back from serialized form
    const paperProfile = profileResult.profile as PaperProfile;
    const sanitizedTopic = profileResult.sanitizedTopic;

    // =========================================================================
    // Step 3: Process Uploaded Papers (if any)
    // =========================================================================
    const uploadedCount = config.libraryPaperIds?.length || 0;
    
    if (uploadedCount > 0) {
      const uploadResult = await step.run("process-uploads", async () => {
        if (await checkCancellation()) {
          return null;
        }

        await emitProgress(runId, "search", 10, `Processing ${uploadedCount} uploaded paper${uploadedCount > 1 ? "s" : ""}...`);

        const { processMultiplePapers } = await import("@/lib/content/background-processor");
        const { info, warn } = await import("@/lib/utils/logger");

        try {
          const results = await processMultiplePapers(config.libraryPaperIds!);
          const successful = results.filter((r: any) => r.status === "processed").length;
          const failed = results.filter((r: any) => r.status === "failed").length;

          if (failed > 0) {
            warn({ successful, failed }, "Some papers failed to process");
          }

          info({ successful, failed, total: uploadedCount }, "Uploaded paper processing completed");
          await emitProgress(runId, "search", 15, `Processed ${successful} uploaded paper${successful > 1 ? "s" : ""}`);
          
          return { successful, failed };
        } catch (e) {
          warn({ error: e }, "Paper processing failed, continuing with available content");
          return { successful: 0, failed: uploadedCount };
        }
      });
      
      if (!uploadResult) {
        return { cancelled: true };
      }
    }

    // =========================================================================
    // Step 4: Discover Papers (Online Search)
    // =========================================================================
    const discoveryResult = await step.run("discover-papers", async (): Promise<DiscoveryStepResult | null> => {
      if (await checkCancellation()) {
        return null;
      }

      const { collectPapers } = await import("@/lib/generation/discovery");
      const { info, warn } = await import("@/lib/utils/logger");
      const { PAPER_TYPE_SEARCH_MULTIPLIERS, PAPER_TYPE_MIN_SEARCH } = await import("@/types/simplified");

      if (!config.useLibraryOnly) {
        await emitProgress(runId, "search", 18, "Searching online databases...");
      } else {
        await emitProgress(runId, "search", 18, "Using only your uploaded papers...");
      }

      const searchMultiplier = PAPER_TYPE_SEARCH_MULTIPLIERS[config.paperType as keyof typeof PAPER_TYPE_SEARCH_MULTIPLIERS] ?? 2.5;
      const minSearch = PAPER_TYPE_MIN_SEARCH[config.paperType as keyof typeof PAPER_TYPE_MIN_SEARCH] ?? 50;
      const idealSourceCount = paperProfile.sourceExpectations.idealSourceCount;
      const calculatedLimit = Math.ceil(idealSourceCount * searchMultiplier);
      const finalLimit = Math.max(minSearch, calculatedLimit);

      const discoveryOptions = {
        projectId,
        userId,
        topic: sanitizedTopic,
        paperType: config.paperType,
        libraryPaperIds: config.libraryPaperIds || [],
        sourceIds: config.libraryPaperIds || [],
        useLibraryOnly: config.useLibraryOnly || false,
        config: {
          temperature: config.temperature || 0.2,
          max_tokens: config.maxTokens || 16000,
          sources: config.sources || ["europe_pmc", "pubmed_central", "openalex", "core", "arxiv", "crossref", "semantic_scholar"],
          limit: finalLimit,
          library_papers_used: config.libraryPaperIds || [],
          length: config.length,
          paperType: config.paperType,
          useLibraryOnly: config.useLibraryOnly || false,
          localRegion: undefined,
        },
        recencyProfile: paperProfile.sourceExpectations.recencyProfile,
        searchYearRange: paperProfile.sourceExpectations.searchYearRange,
        discipline: paperProfile.discipline.primary,
      };

      const allPapers = await collectPapers(discoveryOptions);

      if (allPapers.length === 0) {
        await emitError(runId, "No papers found for the given topic");
        throw new Error("No papers found for the given topic");
      }

      // Warn if below minimum
      const minRequired = paperProfile.sourceExpectations.minimumUniqueSources;
      if (allPapers.length < minRequired) {
        warn({ available: allPapers.length, minRequired }, "Source availability below recommended minimum");
      }

      const onlineCount = allPapers.length - uploadedCount;
      let message = `Found ${allPapers.length} papers`;
      if (uploadedCount > 0 && onlineCount > 0) {
        message = `Ready: ${uploadedCount} uploaded + ${onlineCount} online = ${allPapers.length} papers`;
      }

      await emitProgress(runId, "search", 22, message);

      info({ totalPapers: allPapers.length }, "Paper discovery completed");

      // Return papers as-is - they'll be serialized by Inngest
      return {
        papers: allPapers,
        uploadedCount,
        onlineCount,
      };
    });

    if (!discoveryResult) {
      return { cancelled: true };
    }

    // Papers from previous step (serialized form is fine for our uses)
    const allPapers = discoveryResult.papers;

    // =========================================================================
    // Step 5: Extract Themes (Hybrid Analysis)
    // =========================================================================
    const themeResult = await step.run("extract-themes", async (): Promise<ThemeStepResult | null> => {
      if (await checkCancellation()) {
        return null;
      }

      await emitProgress(runId, "planning", 25, "Extracting findings from papers...");

      const { extractThemesHybrid } = await import("@/lib/synthesis-engine/pipeline-integration");
      const { mergeAnalysisResultIntoProfile } = await import("@/lib/generation/theme-extraction");
      const { info, warn } = await import("@/lib/utils/logger");

      let hybridResult: any = null;
      let analysisResult: any = null;
      let enhancedProfile: any = paperProfile;

      try {
        hybridResult = await extractThemesHybrid(
          allPapers as any, // Type assertion for serialization boundary
          sanitizedTopic,
          paperProfile,
          (message: string) => {
            // Fire and forget - don't await in callback
            emitProgress(runId, "planning", 27, message).catch(() => {});
          }
        );

        analysisResult = hybridResult.analysisResult;
        enhancedProfile = mergeAnalysisResultIntoProfile(paperProfile, analysisResult);

        info({
          patterns: analysisResult.patterns.length,
          contradictions: analysisResult.contradictions.length,
          gaps: analysisResult.gaps.length,
          totalFindings: hybridResult.extractionStats.totalFindings,
        }, "Hybrid theme extraction completed");

        await emitProgress(
          runId,
          "planning",
          30,
          `Found ${analysisResult.patterns.length} patterns from ${hybridResult.extractionStats.totalFindings} findings`
        );
      } catch (e) {
        warn({ error: e }, "Hybrid extraction failed, continuing without theme enrichment");
        await emitProgress(runId, "planning", 30, "Creating paper outline...");
      }

      return { hybridResult, analysisResult, enhancedProfile };
    });

    if (!themeResult) {
      return { cancelled: true };
    }

    const { hybridResult, analysisResult, enhancedProfile } = themeResult;

    // =========================================================================
    // Step 6: Generate Outline
    // =========================================================================
    const outlineResult = await step.run("generate-outline", async (): Promise<OutlineStepResult | null> => {
      if (await checkCancellation()) {
        return null;
      }

      await emitProgress(runId, "planning", 32, "Creating paper outline...");

      const { generateOutline } = await import("@/lib/prompts/generators");
      const { buildAnalysisGuidanceForOutline } = await import("@/lib/generation/theme-extraction");
      const { info } = await import("@/lib/utils/logger");

      const MAX_PAPERS_FOR_OUTLINE = 50;
      const outlinePaperIds = allPapers.slice(0, MAX_PAPERS_FOR_OUTLINE).map((p: any) => p.id);

      const originalResearchInput = config.originalResearch?.has_original_research
        ? {
            researchQuestion: config.originalResearch.research_question,
            keyFindings: config.originalResearch.key_findings,
          }
        : undefined;

      const themeGuidance = analysisResult ? buildAnalysisGuidanceForOutline(analysisResult) : undefined;

      const rawOutline = await generateOutline(
        config.paperType as PaperTypeKey,
        sanitizedTopic,
        outlinePaperIds,
        originalResearchInput,
        enhancedProfile as PaperProfile,
        themeGuidance
      );

      const outline: GeneratedOutline = {
        paperType: config.paperType as PaperTypeKey,
        topic: sanitizedTopic,
        sections: rawOutline.sections.map((section: any) => ({
          ...section,
          sectionKey: section.sectionKey,
        })),
        localRegion: undefined,
      };

      info({ sectionCount: outline.sections.length }, "Outline generated");

      await emitProgress(runId, "planning", 38, `Outline ready: ${outline.sections.length} sections`);

      return { outline, sectionCount: outline.sections.length };
    });

    if (!outlineResult) {
      return { cancelled: true };
    }

    const outline = outlineResult.outline as GeneratedOutline;

    // =========================================================================
    // Step 7: Build Contexts
    // =========================================================================
    const contextResult = await step.run("build-contexts", async (): Promise<ContextStepResult | null> => {
      if (await checkCancellation()) {
        return null;
      }

      await emitProgress(runId, "writing", 40, "Gathering evidence for each section...");

      const { enrichAndBuildContexts } = await import("@/lib/synthesis-engine/pipeline-integration");
      const { GenerationContextService } = await import("@/lib/rag/generation-context");
      const { info, warn } = await import("@/lib/utils/logger");

      let contexts: any[];
      let sectionsWithSynthesis = 0;

      const FINDINGS_THRESHOLD = 5;
      const totalFindings = hybridResult?.extractionStats?.totalFindings || 0;
      const useSynthesis = hybridResult && totalFindings >= FINDINGS_THRESHOLD;

      if (useSynthesis && hybridResult) {
        try {
          contexts = await enrichAndBuildContexts(
            outline,
            hybridResult as any,
            enhancedProfile as PaperProfile,
            allPapers as any,
            sanitizedTopic
          );

          sectionsWithSynthesis = contexts.filter(
            (s: any) => s.hasSynthesisEnrichment
          ).length;

          info({ totalSections: contexts.length, enrichedSections: sectionsWithSynthesis }, "Enriched contexts built");
        } catch (e) {
          warn({ error: e }, "Hybrid enrichment failed, falling back to RAG-only");
          contexts = await GenerationContextService.buildContexts(outline, sanitizedTopic, allPapers as any);
        }
      } else {
        contexts = await GenerationContextService.buildContexts(outline, sanitizedTopic, allPapers as any);
      }

      await emitProgress(runId, "writing", 45, `Built contexts for ${contexts.length} sections`);

      return { contexts, sectionsWithSynthesis };
    });

    if (!contextResult) {
      return { cancelled: true };
    }

    const sectionContexts = contextResult.contexts;

    // =========================================================================
    // Step 8: Generate Each Section (One step per section)
    // =========================================================================
    const sectionResults: SectionStepResult[] = [];
    const totalSections = sectionContexts.length;

    for (let i = 0; i < totalSections; i++) {
      const sectionContext = sectionContexts[i];
      const safeStepId = `generate-section-${i}`;

      const sectionResult = await step.run(safeStepId, async (): Promise<SectionStepResult | null> => {
        if (await checkCancellation()) {
          return null;
        }

        const progress = Math.round((i / totalSections) * 35) + 50;
        await emitProgress(runId, "writing", progress, `Writing ${sectionContext.title} (${i + 1}/${totalSections})...`);
        await emitSectionStart(runId, sectionContext.title, i, totalSections);

        const { generateWithUnifiedTemplate } = await import("@/lib/generation/unified-generator");
        const { buildProfileGuidanceForPrompt } = await import("@/lib/generation/paper-profile");

        const profileGuidance = buildProfileGuidanceForPrompt(enhancedProfile as PaperProfile);
        const outlineTree = outline.sections.map((s: any) => `• ${s.title}`).join("\n");
        const perSectionTokens = Math.max(1000, Math.floor((config.maxTokens || 16000) / totalSections));

        const result = await generateWithUnifiedTemplate({
          context: sectionContext as SectionContext,
          options: {
            temperature: config.temperature || 0.2,
            maxTokens: perSectionTokens,
            outlineTree,
            topic: sanitizedTopic,
            paperType: config.paperType,
            projectTitle: sanitizedTopic,
            originalResearch: config.originalResearch?.has_original_research
              ? {
                  hasOriginalResearch: true,
                  researchQuestion: config.originalResearch.research_question,
                  keyFindings: config.originalResearch.key_findings,
                }
              : undefined,
            profileGuidance,
            voiceConfig: (enhancedProfile as PaperProfile).voice,
            profileCriteria: (enhancedProfile as PaperProfile).qualityCriteria,
          },
          onStreamEvent: (event) => {
            // Stream text chunks to client
            if (event.type === 'sentence' && event.data.text) {
              emitTextChunk(runId, sectionContext.title, event.data.text).catch(() => {});
            }
          },
        });

        // Emit section complete
        const completionProgress = Math.round(((i + 1) / totalSections) * 35) + 50;
        await emitProgress(runId, "writing", completionProgress, `Completed ${sectionContext.title} (${i + 1}/${totalSections})`);
        await emitSectionComplete(runId, sectionContext.title, result.content, i + 1, totalSections);

        return {
          content: result.content,
          citations: result.citations,
          sectionIndex: i,
          sectionTitle: sectionContext.title,
          sectionKey: sectionContext.sectionKey?.toString() || `section-${i}`,
        };
      });

      if (!sectionResult) {
        return { cancelled: true };
      }

      sectionResults.push(sectionResult);
    }

    // =========================================================================
    // Step 9: Finalize - Quality Review & Save
    // =========================================================================
    const finalResult = await step.run("finalize", async () => {
      if (await checkCancellation()) {
        return { status: "cancelled" };
      }

      await emitProgress(runId, "finishing", 88, "Reviewing and saving paper...");

      const { updateProjectContent, updateResearchProjectStatus } = await import("@/lib/db/research");
      const { cleanNonCitationArtifacts } = await import("@/lib/citations/post-processor");
      const { getServiceClient } = await import("@/lib/supabase/service");
      const { info, warn } = await import("@/lib/utils/logger");

      // Combine all section content
      let fullContent = "";
      const allCitations: Array<{ index: number; paperId: string; quote: string }> = [];

      for (const result of sectionResults) {
        let sectionContent = result.content.trim();
        const sectionTitle = result.sectionTitle;

        // Ensure section has heading
        const startsWithHeading = /^##?\s+\w/.test(sectionContent);
        if (!startsWithHeading && sectionTitle) {
          const isSubsection = result.sectionKey.includes(".");
          const headingLevel = isSubsection ? "###" : "##";
          sectionContent = `${headingLevel} ${sectionTitle}\n\n${sectionContent}`;
        }

        fullContent += sectionContent + "\n\n";
        allCitations.push(...result.citations);
      }

      // Clean artifacts
      fullContent = cleanNonCitationArtifacts(fullContent);

      // Convert citations to storage format
      const validPaperIds = new Set(allPapers.map((p: any) => p.id));
      const citationInstances: Array<{ instanceId: string; paperId: string; quote: string }> = [];
      const citedPaperIds = new Set<string>();

      // Process citations
      for (const citation of allCitations) {
        if (!validPaperIds.has(citation.paperId)) continue;
        
        const instanceId = `${citation.paperId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        citationInstances.push({
          instanceId,
          paperId: citation.paperId,
          quote: citation.quote,
        });
        citedPaperIds.add(citation.paperId);

        // Replace first occurrence of [N] with [@paperId#instanceId]
        const pattern = new RegExp(`\\[${citation.index}\\]`);
        fullContent = fullContent.replace(pattern, `[@${citation.paperId}#${instanceId}]`);
      }

      // Build citations map
      const citationsMap: Record<string, { paperId: string; citationText: string }> = {};
      for (const paperId of citedPaperIds) {
        citationsMap[`cite-${paperId}`] = {
          paperId,
          citationText: `[@${paperId}]`,
        };
      }

      // Save content
      await updateProjectContent(projectId, fullContent.trim(), citationsMap);

      // Save citation instances
      if (citationInstances.length > 0) {
        try {
          const supabase = getServiceClient();
          await supabase.from("citation_instances").upsert(
            citationInstances.map((inst) => ({
              id: inst.instanceId,
              paper_id: inst.paperId,
              project_id: projectId,
              quote: inst.quote,
            })),
            { onConflict: "id" }
          );
          info({ count: citationInstances.length }, "Citation instances saved");
        } catch (e) {
          warn({ error: e }, "Failed to save citation instances");
        }
      }

      // Update project status - use 'complete' not 'completed'
      await updateResearchProjectStatus(projectId, "complete");

      // Emit completion
      await emitProgress(runId, "complete", 100, "Paper generation completed successfully");
      await emitComplete(runId, fullContent.trim());

      info({
        totalWords: fullContent.split(" ").length,
        sectionsGenerated: sectionResults.length,
        citationsUsed: citedPaperIds.size,
      }, "Paper generation completed");

      return {
        status: "completed",
        content: fullContent.trim(),
        sectionsGenerated: sectionResults.length,
        papersUsed: allPapers.length,
        citationsUsed: citedPaperIds.size,
      };
    });

    return finalResult;
  }
);

import { cleanupExpiredGenerationData } from "./cleanup-events";

// Export all functions for the Inngest serve handler
export const functions = [generatePaperFunction, cleanupExpiredGenerationData];
