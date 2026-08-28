import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import Groq, { toFile } from "groq-sdk";
import type { ChatCompletionCreateParamsNonStreaming } from "groq-sdk/resources/chat/completions";
import { chunkText } from "../../../lib/chunk-text";
import {
  extractYouTubeVideoId,
  downloadYouTubeAudio,
  fetchYouTubeTitle,
  fetchYouTubeTranscript,
  isYouTubeUrl,
} from "../../../lib/youtube";

export const runtime = "nodejs";
export const maxDuration = 60;

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

function getYouTubeErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown YouTube error";
  const normalizedMessage = message.toLowerCase();

  if (
    !process.env.GROQ_API_KEY ||
    normalizedMessage.includes("invalid api key") ||
    normalizedMessage.includes("invalid_api_key")
  ) {
    return {
      error: "The AI service is not configured correctly. Add a valid GROQ_API_KEY to the server environment and redeploy.",
      status: 500,
    };
  }
  if (normalizedMessage.includes("too large") || normalizedMessage.includes("24 mb")) {
    return {
      error: "This YouTube transcript or audio is too large to analyze. Try a shorter video.",
      status: 413,
    };
  }
  if (/private|unavailable|not exist|removed|video id/.test(normalizedMessage)) {
    return {
      error: "This YouTube video does not exist, is private, or is unavailable.",
      status: 404,
    };
  }
  if (/transcript|caption|subtitle|audio|transcrib/.test(normalizedMessage)) {
    return {
      error: "This YouTube video has no accessible captions and audio transcription could not be completed.",
      status: 400,
    };
  }
  if (/rate limit|quota|429/.test(normalizedMessage)) {
    return {
      error: "The AI service rate limit or quota was reached. Please try again later.",
      status: 429,
    };
  }
  return {
    error: "YouTube analysis failed on the server. Check the server terminal for the detailed error.",
    status: 500,
  };
}

async function createChatCompletion(
  request: ChatCompletionCreateParamsNonStreaming
) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await groq.chat.completions.create(request);
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("The AI service could not complete the request.");
}

async function analyzeYouTube(url: string) {
  let stage = "URL validation";
  console.log("Step 1: URL received", url);
  console.log("Step 2: Validating YouTube URL");

  if (!isYouTubeUrl(url)) {
    console.error("YouTube URL validation failed", { url });
    return NextResponse.json(
      { success: false, error: "Invalid YouTube URL.", stage },
      { status: 400 }
    );
  }

  stage = "video ID extraction";
  console.log("Step 3: Extracting video ID");
  const videoId = extractYouTubeVideoId(url);

  if (!videoId) {
    return NextResponse.json(
      {
        success: false,
        error: "Video ID extraction failed. YouTube video IDs must contain exactly 11 characters.",
        stage,
      },
      { status: 400 }
    );
  }

  try {
    if (!process.env.GROQ_API_KEY) {
      throw new Error("GROQ_API_KEY is missing from the server environment.");
    }

    stage = "transcript extraction";
    console.log("Step 4: Fetching transcript", { videoId });
    const titlePromise = fetchYouTubeTitle(url);
    let transcript: string;
    let transcriptStatus: string;

    try {
      transcript = await fetchYouTubeTranscript(videoId);
      transcriptStatus = "Public transcript extracted successfully";
    } catch (error) {
      if (error instanceof Error && /too large/i.test(error.message)) {
        throw error;
      }
      console.error("Transcript unavailable; attempting audio transcription", error);
      stage = "audio transcription fallback";
      const audio = await downloadYouTubeAudio(videoId);
      const transcription = await groq.audio.transcriptions.create({
        file: await toFile(audio, `${videoId}.webm`),
        model: "whisper-large-v3-turbo",
      });
      transcript = transcription.text?.trim() || "";
      if (!transcript) {
        throw new Error("Unable to transcribe YouTube audio.");
      }
      transcriptStatus = "Transcript generated from YouTube audio";
    }

    if (!transcript.trim()) {
      throw new Error("Empty transcript returned from YouTube.");
    }

    stage = "transcript processing";
    console.log("Step 5: Processing transcript", {
      videoId,
      characters: transcript.length,
    });
    const title = await titlePromise;
    const chunks = chunkText(transcript);
    if (!chunks.length) {
      throw new Error("Transcript processing produced no chunks.");
    }
    console.log("Step 6: Preparing transcript evidence", {
      videoId,
      chunks: chunks.length,
    });
    const sourceForReport = chunks.join("\n").slice(0, 14000);
    let report = "";

    for (let attempt = 0; attempt < 2; attempt += 1) {
      stage = "Groq report generation";
      console.log("Step 6: Calling Groq API", { videoId, purpose: "report" });
      const completion = await createChatCompletion({
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
            content: `Video URL: ${url}\nVideo title: ${title}\nTranscript status: ${transcriptStatus}.`,
          },
        ],
        model: "openai/gpt-oss-20b",
        reasoning_effort: "low",
        temperature: 0.2,
        max_tokens: 900,
      });
      report = completion.choices[0]?.message?.content?.trim() || "";

      stage = "verification";
      console.log("Step 7: Generating verification", { videoId });
      const verification = await createChatCompletion({
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

    stage = "response generation";
    console.log("Step 8: Returning response", { videoId });
    return NextResponse.json({
      success: true,
      url,
      title,
      sourceType: "YouTube Video",
      pipeline: "youtube",
      transcript,
      transcriptStatus,
      extractedContent: transcript,
      contentSize: transcript.length,
      research: report,
    });
  } catch (error) {
    console.error(`YouTube analysis error at ${stage}:`, error);
    const response = getYouTubeErrorResponse(error);
    const detail = error instanceof Error ? error.message : "Unknown server error";

    return NextResponse.json(
      {
        success: false,
        error: process.env.NODE_ENV === "development" ? detail : response.error,
        stage,
      },
      { status: response.status }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url } = body;

    if (typeof url !== "string" || !url.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: "URL is required",
        },
        { status: 400 }
      );
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json(
        { success: false, error: "Please enter a valid URL." },
        { status: 400 }
      );
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return NextResponse.json(
        { success: false, error: "Only HTTP and HTTPS URLs are supported." },
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
      await createChatCompletion({
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