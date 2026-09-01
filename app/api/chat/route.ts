import { NextResponse } from "next/server";
import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const unavailableResponse =
  "I couldn't find this information in the analyzed source.";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      question,
      extractedContent,
      research,
      sourceUrl,
      sourceType = "Website",
      sourceLevel,
      history = [],
    } = body;

    if (
      typeof question !== "string" ||
      !question.trim() ||
      typeof extractedContent !== "string" ||
      typeof research !== "string"
    ) {
      return NextResponse.json(
        { success: false, error: "Question and analyzed source are required" },
        { status: 400 }
      );
    }

    const cleanExtracted = extractedContent.trim();
    const resolvedLevel = sourceLevel || (cleanExtracted.length === 0 ? "NONE" : cleanExtracted.startsWith("Video Title:") ? "LIMITED" : "FULL");

    if (resolvedLevel === "AUTH_REQUIRED") {
      return NextResponse.json({
        success: true,
        answer: "This video is private and requires authorization from its owner.",
      });
    }

    // AI ASSISTANT NONE CONTENT GUARDRAIL
    if (resolvedLevel === "NONE" || !cleanExtracted || cleanExtracted.length === 0) {
      return NextResponse.json({
        success: true,
        answer:
          "I could not retrieve sufficient source content from this video to answer questions about it reliably.",
      });
    }

    const safeHistory = Array.isArray(history)
      ? history
          .filter(
            (message) =>
              (message?.role === "user" || message?.role === "assistant") &&
              typeof message?.content === "string"
          )
          .slice(-10)
      : [];

    const systemPrompt = resolvedLevel === "LIMITED"
      ? `You are the research assistant for a URL Research Agent.

IMPORTANT GROUNDING RULE:
The source information for this YouTube video is LIMITED to the official video title, description, and metadata because a full transcript was unavailable.

Answer the user's question ONLY using the provided official metadata and description below. Do not use general knowledge to invent information about the video or claim to know spoken transcript audio. If the information cannot be found in the description or metadata, state: "${unavailableResponse}".

Keep answers concise and clear.

Source URL: ${sourceUrl || "Not provided"}
Source Type: ${sourceType}

Extracted Source Metadata & Description:
${extractedContent}

Generated Research Report:
${research}`
      : `You are the research assistant for a URL Research Agent.

CRITICAL GROUNDING GUARDRAIL:
You must answer ONLY from the provided source transcript content and research report below. Do not use general knowledge to fill missing information. Do not invent key findings, summaries, action items, facts, or answers. If the source content does not contain enough information to answer the question, clearly state: "${unavailableResponse}".

Keep answers concise and clear.

Source URL: ${sourceUrl || "Not provided"}
Source Type: ${sourceType}

Extracted source content:
${extractedContent}

Generated research report:
${research}`;

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
      answer: answer || unavailableResponse,
    });
  } catch (error) {
    console.error("Chat error:", error);

    return NextResponse.json(
      { success: false, error: "Failed to get an answer from the research agent" },
      { status: 500 }
    );
  }
}
