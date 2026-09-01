import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { createMultiSourceSystemPrompt, buildMultiSourceContext, UNAVAILABLE_MESSAGE } from "../../../lib/guardrails";
import { compareMultipleSources, formatComparisonForDisplay } from "../../../lib/source-comparison";

export const runtime = "nodejs";
export const maxDuration = 60;

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      question,
      sources, // Array of sources for multi-source chat
      history = [],
    } = body;

    if (typeof question !== "string" || !question.trim()) {
      return NextResponse.json(
        { success: false, error: "Question is required" },
        { status: 400 }
      );
    }

    if (!Array.isArray(sources) || sources.length === 0) {
      return NextResponse.json(
        { success: false, error: "At least one source is required" },
        { status: 400 }
      );
    }

    // Validate sources
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      if (
        typeof source.extractedContent !== "string" ||
        typeof source.research !== "string"
      ) {
        return NextResponse.json(
          {
            success: false,
            error: `Source ${i + 1} is missing required fields`,
          },
          { status: 400 }
        );
      }
    }

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        {
          success: false,
          error: "AI service is not configured",
        },
        { status: 500 }
      );
    }

    // For single source, use simpler chat
    if (sources.length === 1) {
      const source = sources[0];
      const sourceLevel = source.sourceLevel || "FULL";

      // Use the single-source guardrails (similar to the main chat endpoint)
      const systemPrompt = sourceLevel === "LIMITED"
        ? `You are a research assistant for a URL Research Agent.

IMPORTANT GROUNDING RULE:
The source information is LIMITED to official metadata and description.

Answer ONLY using the provided metadata and description. Do not use general knowledge to invent information. If the information cannot be found, state: "${UNAVAILABLE_MESSAGE}".

Source URL: ${source.sourceUrl || "Not provided"}
Extracted Source Metadata & Description:
${source.extractedContent}

Generated Research Report:
${source.research}`
        : `You are a research assistant for a URL Research Agent.

CRITICAL GROUNDING GUARDRAIL:
You must answer ONLY from the provided source content. Do not use general knowledge. Do not invent information. If the source doesn't contain enough information, clearly state: "${UNAVAILABLE_MESSAGE}".

Source URL: ${source.sourceUrl || "Not provided"}
Extracted source content:
${source.extractedContent}

Generated research report:
${source.research}`;

      const safeHistory = Array.isArray(history)
        ? history
            .filter(
              (message) =>
                (message?.role === "user" || message?.role === "assistant") &&
                typeof message?.content === "string"
            )
            .slice(-10)
        : [];

      const completion = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          ...safeHistory,
          {
            role: "user",
            content: question.trim(),
          },
        ],
        model: "openai/gpt-oss-20b",
        reasoning_effort: "low",
        temperature: 0.2,
        max_tokens: 500,
      });

      const answer = completion.choices[0]?.message?.content?.trim();

      return NextResponse.json({
        success: true,
        answer: answer || UNAVAILABLE_MESSAGE,
      });
    }

    // For multiple sources
    const comparison = compareMultipleSources(
      sources.map(s => ({
        title: s.title || "Unnamed Source",
        research: s.research,
      }))
    );

    const comparisonText = formatComparisonForDisplay(comparison);
    const sourceContext = buildMultiSourceContext(
      sources.map(s => ({
        title: s.title || "Unnamed Source",
        extractedContent: s.extractedContent,
        research: s.research,
      }))
    );

    const safeHistory = Array.isArray(history)
      ? history
          .filter(
            (message) =>
              (message?.role === "user" || message?.role === "assistant") &&
              typeof message?.content === "string"
          )
          .slice(-10)
      : [];

    const systemPrompt = createMultiSourceSystemPrompt(
      sources.map(s => ({
        title: s.title || "Unnamed Source",
        extractedContent: s.extractedContent,
        research: s.research,
      })),
      comparisonText
    ) + sourceContext;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        ...safeHistory,
        {
          role: "user",
          content: question.trim(),
        },
      ],
      model: "openai/gpt-oss-20b",
      reasoning_effort: "low",
      temperature: 0.2,
      max_tokens: 800,
    });

    const answer = completion.choices[0]?.message?.content?.trim();

    return NextResponse.json({
      success: true,
      answer: answer || UNAVAILABLE_MESSAGE,
      sources: sources.length,
    });
  } catch (error) {
    console.error("Multi-source chat error:", error);

    return NextResponse.json(
      { success: false, error: "Failed to get an answer from the research agent" },
      { status: 500 }
    );
  }
}
