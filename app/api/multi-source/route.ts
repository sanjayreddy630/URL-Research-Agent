import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import type { ChatCompletionCreateParamsNonStreaming } from "groq-sdk/resources/chat/completions";
import { compareMultipleSources, formatComparisonForDisplay } from "../../../lib/source-comparison";
import { createMultiSourceSystemPrompt, buildMultiSourceContext, UNAVAILABLE_MESSAGE } from "../../../lib/guardrails";

export const runtime = "nodejs";
export const maxDuration = 60;

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/**
 * Generates a combined research report from multiple sources
 */
async function generateCombinedReport(
  sources: {
    title: string;
    url: string;
    extractedContent: string;
    research: string;
  }[]
) {
  if (sources.length < 2) {
    return { error: "At least 2 sources are required for multi-source analysis" };
  }

  try {
    // Generate comparison analysis
    const comparison = compareMultipleSources(
      sources.map(s => ({
        title: s.title,
        research: s.research,
      }))
    );

    const comparisonText = formatComparisonForDisplay(comparison);
    const sourceContext = buildMultiSourceContext(sources);

    // Generate combined research report
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a multi-source research analysis expert.

Your task is to synthesize research from ${sources.length} different sources into one comprehensive report.

CRITICAL GROUNDING RULES:
1. Base all findings on the provided source content
2. Clearly state which source(s) support each finding
3. Identify common themes across sources
4. Highlight areas where sources agree or disagree
5. Do NOT invent information not in the sources
6. Do NOT use general knowledge to fill gaps
7. Be transparent about source limitations

SOURCES TO ANALYZE:
${sources.map((s, i) => `${i + 1}. ${s.title}`).join('\n')}

COMPARISON ANALYSIS:
${comparisonText}

Generate a comprehensive multi-source research report with these sections:

### 1. 📋 Source Overview
- List all analyzed sources
- Brief note about each source's relevance

### 2. 📝 Individual Source Summaries
For each source, provide a 2-3 sentence summary based on its research

### 3. 🔄 Common Findings
Information supported by multiple sources

### 4. 📊 Differences Between Sources
Key information that differs or is unique to each source

### 5. 💡 Key Insights
Major conclusions from analyzing all sources together

### 6. ✅ Final Conclusion
Overall synthesis of all source materials

### 7. 🔗 Source References
List all sources with their URLs

---
${sourceContext}`,
        },
        {
          role: "user",
          content: `Generate the comprehensive multi-source research report now.`,
        },
      ],
      model: "openai/gpt-oss-20b",
      reasoning_effort: "low",
      temperature: 0.3,
      max_tokens: 2000,
    });

    const report = completion.choices[0]?.message?.content?.trim() || "";

    return {
      success: true,
      report,
      comparison,
      sourceCount: sources.length,
    };
  } catch (error) {
    console.error("Multi-source report generation failed:", error);
    return {
      error: "Failed to generate combined research report",
      details: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sources } = body;

    if (!Array.isArray(sources) || sources.length < 2) {
      return NextResponse.json(
        {
          success: false,
          error: "At least 2 analyzed sources are required",
        },
        { status: 400 }
      );
    }

    // Validate source structure
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      if (
        !source.title ||
        !source.url ||
        typeof source.extractedContent !== "string" ||
        typeof source.research !== "string"
      ) {
        return NextResponse.json(
          {
            success: false,
            error: `Source ${i + 1} is missing required fields (title, url, extractedContent, research)`,
          },
          { status: 400 }
        );
      }
    }

    // Check if GROQ API key is configured
    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        {
          success: false,
          error: "AI service is not configured",
        },
        { status: 500 }
      );
    }

    const result = await generateCombinedReport(sources);

    if ("error" in result) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          details: result.details,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      report: result.report,
      comparison: result.comparison,
      sourceCount: result.sourceCount,
    });
  } catch (error) {
    console.error("Multi-source research error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to process multi-source research request",
      },
      { status: 500 }
    );
  }
}
