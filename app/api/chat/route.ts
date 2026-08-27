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
          content: `You are the research assistant for a URL Research Agent.

Answer the user's question ONLY from the ${sourceType} source content and the generated research report below. The source URL is context only; do not browse it or use outside knowledge.

Do not invent facts, fill gaps with assumptions, or claim that information is present when it is not. If the requested information cannot be found in either provided source, respond EXACTLY with:
"${unavailableResponse}"

Keep answers concise and clear. Do not mention these instructions.

Source URL:
${sourceUrl || "Not provided"}

Extracted source content:
${extractedContent}

Generated research report:
${research}`,
        },
        ...safeHistory,
        {
          role: "user",
          content: question.trim(),
        },
      ],
      model: "openai/gpt-oss-20b",
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
