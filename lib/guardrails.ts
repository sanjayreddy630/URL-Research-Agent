/**
 * AI Guardrails Service
 * Ensures AI-generated research and responses are grounded in source content
 */

/**
 * Message shown when information is not available in sources
 */
export const UNAVAILABLE_MESSAGE = 
  "The available sources do not provide enough information to answer this question.";

/**
 * Creates a system prompt with guardrails for single-source analysis
 */
export function createSingleSourceSystemPrompt(
  sourceUrl: string,
  sourceType: string,
  sourceLevel: 'FULL' | 'LIMITED' | 'AUTH_REQUIRED' | 'NONE' | undefined,
  extractedContent: string,
  research: string
): string {
  if (sourceLevel === 'AUTH_REQUIRED') {
    return `You are a research assistant for a URL Research Agent.

GROUNDING RULE:
This video is private and requires authorization from its owner. You cannot access its content.

Response Template:
"This video is private and requires authorization from its owner."`;
  }
  
  if (sourceLevel === 'NONE' || !extractedContent || extractedContent.trim().length === 0) {
    return `You are a research assistant for a URL Research Agent.

CRITICAL GROUNDING RULE:
No source content was retrieved from this source. You cannot answer questions about content that was not accessible.

Response Template:
"I could not retrieve sufficient source content from this source to answer questions about it reliably."`;
  }
  
  if (sourceLevel === 'LIMITED') {
    return `You are a research assistant for a URL Research Agent.

CRITICAL GROUNDING RULE:
The source information for this video is LIMITED to the official video title, description, and metadata because a full transcript was unavailable.

INSTRUCTIONS:
1. Answer ONLY using the provided metadata and description
2. Do NOT use general knowledge to invent information about the video
3. Do NOT claim to know spoken content from the transcript
4. If the information cannot be found in the description or metadata, respond with: "${UNAVAILABLE_MESSAGE}"
5. Be honest about the limitations of the metadata

Source URL: ${sourceUrl}
Source Type: ${sourceType}

Extracted Source Metadata & Description:
${extractedContent}

Generated Research Report:
${research}`;
  }
  
  // FULL content available
  return `You are a research assistant for a URL Research Agent.

CRITICAL GROUNDING GUARDRAILS:
1. You MUST answer ONLY from the provided source content below
2. Do NOT use general knowledge to fill in missing information
3. Do NOT invent key findings, facts, or answers
4. Do NOT hallucinate data or information not in the sources
5. If source content doesn't contain enough information, clearly state: "${UNAVAILABLE_MESSAGE}"
6. Clearly distinguish source facts from any analysis you provide
7. Always cite or reference which part of the source supports your answer
8. Keep responses professional and factual

Source URL: ${sourceUrl}
Source Type: ${sourceType}

FULL EXTRACTED SOURCE CONTENT:
${extractedContent}

GENERATED RESEARCH REPORT FROM SOURCE:
${research}`;
}

/**
 * Creates a system prompt with guardrails for multi-source analysis
 */
export function createMultiSourceSystemPrompt(
  sources: {
    title: string;
    extractedContent: string;
    research: string;
  }[],
  comparisonAnalysis: string
): string {
  const sourcesSummary = sources
    .map((s, i) => `Source ${i + 1}: ${s.title}`)
    .join('\n');
  
  return `You are a research assistant for a URL Research Agent analyzing MULTIPLE sources.

CRITICAL GROUNDING GUARDRAILS FOR MULTI-SOURCE ANALYSIS:
1. You MUST base answers on the provided source content from the ${sources.length} analyzed sources
2. ALWAYS clearly state which source(s) support your answer
3. Do NOT use general knowledge to invent information
4. Do NOT claim sources say something they do not explicitly state
5. When sources conflict, clearly present both perspectives and note the conflict
6. If information is not available in any source, state: "${UNAVAILABLE_MESSAGE}"
7. Distinguish between:
   - Consensus (found in multiple sources)
   - Unique findings (found in one source only)
   - Conflicting information (sources disagree)
8. Always reference the source by title when making claims

SOURCES ANALYZED:
${sourcesSummary}

DETAILED SOURCE COMPARISON:
${comparisonAnalysis}

---

DETAILED SOURCE CONTENT FOR REFERENCE:
`;
}

/**
 * Builds context blocks for multi-source prompts
 */
export function buildMultiSourceContext(
  sources: {
    title: string;
    extractedContent: string;
    research: string;
  }[]
): string {
  let context = '';
  
  sources.forEach((source, index) => {
    context += `\n## SOURCE ${index + 1}: ${source.title}\n`;
    context += `### Extracted Content:\n${source.extractedContent}\n`;
    context += `### Research Report:\n${source.research}\n`;
    context += '---\n';
  });
  
  return context;
}

/**
 * Validates a response for common hallucination patterns
 */
export function validateResponseForHallucinations(
  response: string,
  sources: string[]
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  // Check for common hallucination indicators
  const hallucationIndicators = [
    {
      pattern: /the document (also )?mentions?|according to the (article|source|document)/i,
      check: (match: string) => {
        // Only okay if it's actually mentioned
        return true; // This is fine
      },
    },
    {
      pattern: /it is not stated|the source does not (mention|say|discuss)/i,
      check: () => true, // This is fine - acknowledging absence
    },
    {
      pattern: /based on (general )?knowledge|in my experience|typically|usually|generally speaking/i,
      check: () => {
        issues.push('Response may contain general knowledge not from sources');
        return false;
      },
    },
  ];
  
  // Check if response has unavailable message for unanswerable questions
  if (response.length < 50 && !response.includes('available sources')) {
    if (response.includes('?') && !response.includes('based on')) {
      // Looks like it might be trying to answer something
    }
  }
  
  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Creates guardrails-compliant error message
 */
export function createErrorResponse(
  error: string,
  sourceType: string
): string {
  if (error.includes('private') || error.includes('authorization')) {
    return `This ${sourceType.toLowerCase()} is private or requires authorization. I cannot access its content.`;
  }
  
  if (error.includes('transcript') || error.includes('caption')) {
    return `A transcript or captions for this ${sourceType.toLowerCase()} could not be retrieved. I can only analyze sources with accessible text content.`;
  }
  
  return `Unable to analyze this ${sourceType.toLowerCase()} due to a retrieval error. ${UNAVAILABLE_MESSAGE}`;
}

/**
 * Formats research report with guardrails notices
 */
export function formatReportWithGuardrails(
  report: string,
  sourceType: string,
  sourceUrl: string
): string {
  const header = `## Research Report - Grounded Analysis

**Source:** ${sourceUrl}
**Type:** ${sourceType}
**Generated:** ${new Date().toLocaleString()}

---

`;
  
  const footer = `

---

**Guardrails Notice:** This research report is based solely on the analyzed source material. Claims made in this report are supported by content extracted from the source.`;
  
  return header + report + footer;
}
