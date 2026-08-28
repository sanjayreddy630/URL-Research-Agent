import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import Groq from "groq-sdk";
import { chunkText } from "../../../lib/chunk-text";
import {
  extractYouTubeVideoId,
  fetchYouTubeTitle,
  fetchYouTubeTranscript,
  isYouTubeUrl,
} from "../../../lib/youtube";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

async function analyzeYouTube(url: string) {
  const videoId = extractYouTubeVideoId(url);

  if (!videoId) {
    return NextResponse.json(
      { success: false, error: "Invalid YouTube video URL" },
      { status: 400 }
    );
  }

  try {
    const [title, transcript] = await Promise.all([
      fetchYouTubeTitle(url),
      fetchYouTubeTranscript(videoId),
    ]);
    const chunks = chunkText(transcript);
    const chunkSummaries: string[] = [];

    for (const chunk of chunks) {
      const completion = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content:
              "Summarize only the provided video transcript excerpt in 2 concise sentences. Do not add outside information.",
          },
          { role: "user", content: chunk },
        ],
        model: "openai/gpt-oss-20b",
        reasoning_effort: "low",
        temperature: 0.2,
        max_tokens: 180,
      });
      const summary = completion.choices[0]?.message?.content?.trim();
      if (summary) chunkSummaries.push(summary);
    }

    const sourceForReport = chunkSummaries.join("\n").slice(0, 14000);
    let report = "";

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const completion = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `You are a professional YouTube research agent. Use ONLY the transcript evidence provided below.

Create a concise report. The WHAT IT IS ABOUT section must be approximately 6-7 lines, not a long essay. Do not invent facts.

Return EXACTLY these Markdown headings:

### 1. 📋 Basic Information
Include the video title, topic, and transcript status.

### 2. 🔍 Key Findings
List the most important supported points.

### 3. 💡 Important Insights
Give useful conclusions based only on the transcript.

### 4. ⚠️ Things to Consider / Precautions
List limitations, cautions, or claims that should be checked.

### 5. ✅ Recommended Actions
List practical actions, steps, or tools explicitly supported by the transcript.

### 6. 🔎 Source Verification
State that the report is grounded in the available transcript and that no independent fact-checking was performed.

Transcript evidence:
${sourceForReport}`,
          },
          {
            role: "user",
            content: `Video URL: ${url}\nVideo title: ${title}\nTranscript status: Public transcript extracted successfully.`,
          },
        ],
        model: "openai/gpt-oss-20b",
        reasoning_effort: "low",
        temperature: 0.2,
        max_tokens: 900,
      });
      report = completion.choices[0]?.message?.content?.trim() || "";

      const verification = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content:
              "Check whether the proposed report is grounded only in the provided transcript evidence, stays on topic, and has transcript-supported action items. Reply with PASS if it is grounded; otherwise reply FAIL.",
          },
          {
            role: "user",
            content: `Transcript evidence:\n${sourceForReport}\n\nProposed report:\n${report}`,
          },
        ],
        model: "openai/gpt-oss-20b",
        reasoning_effort: "low",
        temperature: 0,
        max_tokens: 20,
      });
      const verificationResult = verification.choices[0]?.message?.content
        ?.trim()
        .toUpperCase();

      if (verificationResult?.includes("PASS") || attempt === 1) break;
    }

    if (!report) {
      throw new Error("Unable to generate a YouTube research report");
    }

    return NextResponse.json({
      success: true,
      url,
      title,
      sourceType: "YouTube Video",
      pipeline: "youtube",
      transcript,
      transcriptStatus: "Public transcript extracted successfully",
      extractedContent: transcript,
      contentSize: transcript.length,
      research: report,
    });
  } catch (error) {
    console.error("YouTube analysis error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to analyze YouTube video";
    const isTranscriptError = /transcript|caption/i.test(message);

    return NextResponse.json(
      {
        success: false,
        error: isTranscriptError
          ? "This video has no transcript that the app can access. On YouTube, open the video menu and check that 'Show transcript' is available, then try again. Videos without public captions cannot be analyzed yet."
          : "Failed to analyze YouTube video",
      },
      { status: isTranscriptError ? 400 : 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json(
        {
          success: false,
          error: "URL is required",
        },
        { status: 400 }
      );
    }

    if (isYouTubeUrl(url)) {
      return analyzeYouTube(url);
    }

    // Fetch website content
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: "Unable to fetch the URL",
        },
        { status: 400 }
      );
    }

    const html = await response.text();

    const $ = cheerio.load(html);
    $("script, style, noscript, svg, template").remove();

    const title = $("title").first().text().replace(/\s+/g, " ").trim() ||
      new URL(url).hostname;

    const mainContent = $("main").text().trim();
    const rawContent = mainContent.length >= 20
      ? mainContent
      : $("body").text().trim();
    const content = rawContent.replace(/\s+/g, " ").trim().slice(0, 12000);

    // Check whether content was extracted
    if (!content || content.length < 20) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to extract meaningful content from this URL",
        },
        { status: 400 }
      );
    }

    // Generate AI research report
    const completion =
      await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `
You are a professional URL Research Agent.

Analyze ONLY the extracted source content provided by the user.

Your goal is to transform long and difficult website content into a clear, useful, easy-to-read research report.

IMPORTANT RULES:

1. Use ONLY information available in the extracted source content.
2. Do NOT invent facts or make unsupported claims.
3. If information is not available in the source, do not add it.
4. Avoid repeating unnecessary content.
5. Make the response easy for a normal user to understand.
6. Focus on practical and important information.
7. Do not mention information that cannot be supported by the source.
8. Keep the report concise but useful.

Return the response EXACTLY in the following format:

### 1. 📋 Basic Information

Quick information about the source.

- What is this website/article about?
- Main topic
- Important details

### 2. 🔍 Key Findings

The most important information extracted from the source.

### 3. 💡 Important Insights

Useful conclusions based only on the source content.

### 4. ⚠️ Things to Consider / Precautions

Important limitations, warnings, or things the user should check.

### 5. ✅ Recommended Actions

Clear practical next steps for the user.

### 6. 🔎 Source Verification

Explain that the answer is grounded in the extracted content.
            `,
          },
          {
            role: "user",
            content: `Source URL: ${url}

Source title: ${title}

Extracted content:

${content}`,
          },
        ],

        model: "openai/gpt-oss-20b",
        reasoning_effort: "low",
        temperature: 0.3,
        max_tokens: 1200,
      });

    const aiResponse =
      completion.choices[0]?.message?.content ||
      "Unable to generate a response.";

    // Return everything needed by the frontend
    return NextResponse.json({
      success: true,

      url,

      title,

      sourceType: "Website",

      extractedContent: content,

      contentSize: content.length,

      research: aiResponse,
    });
  } catch (error) {
    console.error("Analysis error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to analyze URL",
      },
      {
        status: 500,
      }
    );
  }
}