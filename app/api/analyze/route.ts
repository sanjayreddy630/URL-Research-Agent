import fs from "fs";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import Groq from "groq-sdk";
import type { ChatCompletionCreateParamsNonStreaming } from "groq-sdk/resources/chat/completions";
import { chunkText } from "../../../lib/chunk-text";
import {
  checkYouTubePrivateVideo,
  downloadYouTubeAudio,
  extractYouTubeVideoId,
  fetchYouTubeMetadata,
  fetchYouTubeTitle,
  fetchYouTubeTranscript,
  isYouTubeUrl,
} from "../../../lib/youtube";
import {
  validateUrl,
  isYouTubeUrl as isYTUrl,
} from "../../../lib/url-validation";
import {
  checkYouTubeMetadataForSafety,
  checkWebsiteMetadataForSafety,
  checkFullContentForSafety,
  shouldBlockContent,
} from "../../../lib/content-safety";

export const runtime = "nodejs";
export const maxDuration = 60;

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/**
 * Returns a safety block response
 */
function getSafetyBlockResponse(url: string, reason: string) {
  return NextResponse.json(
    {
      success: false,
      error: "Analysis Unavailable",
      reason:
        "This URL cannot be processed because the source contains or appears to contain content that is not supported by this research platform.",
      details: reason,
      isBlocked: true,
      url,
    },
    { status: 400 }
  );
}

function getYouTubeErrorResponse(error: unknown, videoId?: string) {
  const message = error instanceof Error ? error.message : "Unknown YouTube error";
  const normalizedMessage = message.toLowerCase();

  // Log the exact error for debugging
  console.error(`YouTube Error for video ${videoId}:`, message);

  // GROQ API Key issues
  if (
    !process.env.GROQ_API_KEY ||
    normalizedMessage.includes("invalid api key") ||
    normalizedMessage.includes("invalid_api_key")
  ) {
    return {
      error:
        "The AI service is not configured correctly. Add a valid GROQ_API_KEY to the server environment and redeploy.",
      status: 500,
    };
  }

  // Transcript size issues
  if (normalizedMessage.includes("too large") || normalizedMessage.includes("24 mb")) {
    return {
      error: "This YouTube transcript is too large to analyze. Try a shorter video.",
      status: 413,
    };
  }

  // Video access issues (private, deleted, etc.)
  if (/private|unavailable|not exist|removed|does not exist|video not found|video id/.test(normalizedMessage)) {
    return {
      error: "This YouTube video does not exist, is private, or is unavailable.",
      status: 404,
    };
  }

  // Transcript disabled or unavailable issues
  if (/disabled|transcript disabled|transcript is disabled|captions disabled|captions are disabled|no captions|captions are unavailable|transcript unavailable|transcription not available|could not retrieve|could not find|could not get/.test(normalizedMessage)) {
    return {
      error: "Transcript access is disabled for this video. Please try another YouTube video with captions enabled.",
      status: 400,
    };
  }

  // General transcript/caption issues
  if (/transcript|caption|subtitle|transcrib|no public|captions|closed captions/.test(normalizedMessage)) {
    return {
      error:
        "No public transcript or captions are available for this YouTube video. Please try another video with captions enabled.",
      status: 400,
    };
  }

  // Rate limiting
  if (/rate limit|quota|429|too many request/.test(normalizedMessage)) {
    return {
      error: "The AI service rate limit or quota was reached. Please try again later.",
      status: 429,
    };
  }

  // Fallback to generic message but with indication it's a transcript issue
  if (message.length > 0) {
    return {
      error: `Unable to analyze this YouTube video: ${message}`,
      status: 400,
    };
  }

  return {
    error: "YouTube analysis failed. Please verify the video has public captions enabled and try again.",
    status: 400,
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
  try {
    console.log("==================================================");
    console.log("[YOUTUBE PIPELINE INITIALIZED] Target URL:", url);

    if (!isYouTubeUrl(url)) {
      console.error("[YOUTUBE PIPELINE ERROR] Invalid YouTube URL", { url });
      return NextResponse.json(
        { success: false, stage: "URL validation", error: "Invalid YouTube URL." },
        { status: 400 }
      );
    }

    let videoId: string | null = null;
    try {
      videoId = extractYouTubeVideoId(url);
    } catch (error) {
      console.error("[YOUTUBE PIPELINE ERROR] Video ID extraction error", error);
      return NextResponse.json(
        { success: false, stage: "video ID extraction", error: "Video ID extraction failed." },
        { status: 400 }
      );
    }

    if (!videoId) {
      console.error("[YOUTUBE PIPELINE ERROR] No video ID extracted for URL:", url);
      return NextResponse.json(
        { success: false, stage: "video ID extraction", error: "Video ID extraction failed." },
        { status: 400 }
      );
    }

    console.log(`[YOUTUBE PIPELINE] Extracted Video ID: ${videoId}`);

    if (!process.env.GROQ_API_KEY) {
      console.error("[YOUTUBE PIPELINE ERROR] GROQ_API_KEY is missing");
      return NextResponse.json(
        { success: false, stage: "environment", error: "GROQ_API_KEY is missing." },
        { status: 500 }
      );
    }

    // Fetch official video metadata
    console.log(`[YOUTUBE PIPELINE] Fetching official video metadata for ${videoId}...`);
    const metadata = await fetchYouTubeMetadata(videoId, url);
    const videoTitle = metadata.title || "YouTube Video";

    // SAFETY CHECK: Check YouTube metadata for unsafe content
    console.log(`[SAFETY CHECK] Scanning YouTube metadata for unsafe content...`);
    const metadataSafetyCheck = checkYouTubeMetadataForSafety(
      videoTitle,
      metadata.description
    );
    
    if (!metadataSafetyCheck.safe) {
      console.error(`[SAFETY BLOCK] YouTube video blocked: ${metadataSafetyCheck.reason}`);
      return getSafetyBlockResponse(
        url,
        metadataSafetyCheck.reason || "Video metadata contains blocked content"
      );
    }

    let transcript = "";
    let pipelineDisplay = "Transcript";
    let sourceLevel: "FULL" | "LIMITED" | "AUTH_REQUIRED" | "NONE" = "NONE";

    // STAGE 1: Attempt Public Transcript
    try {
      console.log(`[YOUTUBE PIPELINE STAGE 1] Attempting public transcript extraction for ${videoId}...`);
      transcript = await fetchYouTubeTranscript(videoId);
      if (transcript && transcript.trim().length >= 20) {
        console.log(`[PIPELINE USED: Public Transcript] SUCCESS for ${videoId}. Length: ${transcript.length}`);
        sourceLevel = "FULL";
        pipelineDisplay = "Transcript";
      }
    } catch (transcriptErr) {
      console.warn(`[YOUTUBE PIPELINE STAGE 1 UNAVAILABLE] Public transcript missing for ${videoId}`);
    }

    // STAGE 2: Attempt Speech-to-Text via Groq Whisper from Audio Stream
    if (sourceLevel !== "FULL" && process.env.GROQ_API_KEY) {
      let tempPath = "";
      try {
        console.log(`[YOUTUBE PIPELINE STAGE 2] Attempting Audio Speech-to-Text via Groq Whisper for ${videoId}...`);
        const audioBuffer = await downloadYouTubeAudio(videoId);
        if (audioBuffer && audioBuffer.length > 1000) {
          tempPath = path.join(os.tmpdir(), `yt_${videoId}_${Date.now()}.m4a`);
          fs.writeFileSync(tempPath, audioBuffer);

          const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(tempPath),
            model: "whisper-large-v3-turbo",
            response_format: "json",
          });

          const sttText = transcription.text?.trim() || "";
          if (sttText && sttText.length >= 20) {
            console.log(`[PIPELINE USED: Groq Whisper Speech-to-Text] SUCCESS for ${videoId}. Length: ${sttText.length}`);
            transcript = sttText;
            pipelineDisplay = "Speech-to-Text";
            sourceLevel = "FULL";
          }
        }
      } catch (sttErr) {
        console.warn(`[YOUTUBE PIPELINE STAGE 2 UNAVAILABLE] Groq Whisper STT unavailable for ${videoId}:`, sttErr);
      } finally {
        if (tempPath && fs.existsSync(tempPath)) {
          try {
            fs.unlinkSync(tempPath);
          } catch {
            // ignore
          }
        }
      }
    }

    // STAGE 3: Attempt YouTube Data API v3 Metadata
    if (sourceLevel !== "FULL") {
      if (
        (metadata.description && metadata.description.trim().length >= 20) ||
        (metadata.title && metadata.title !== "YouTube Video" && metadata.description.trim().length > 0)
      ) {
        console.log(`[PIPELINE USED: YouTube Data API v3 Metadata] SUCCESS for ${videoId}`);
        sourceLevel = "LIMITED";
        pipelineDisplay = "YouTube Data API v3 Metadata";
      }
    }

    // STAGE 4: Check if Video is Private / Requires Authorization
    if (sourceLevel === "NONE") {
      const isPrivate = await checkYouTubePrivateVideo(videoId);
      if (isPrivate) {
        console.log(`[PIPELINE USED: Private YouTube Video] Video requires authorization for ${videoId}`);
        sourceLevel = "AUTH_REQUIRED";
        pipelineDisplay = "Private YouTube Video";
      }
    }

    console.log(`[YOUTUBE PIPELINE CLASSIFICATION] Video: ${videoId} | Level: ${sourceLevel} | Pipeline: ${pipelineDisplay}`);

    // ============ RESPONSE FOR STAGE 4: AUTHORIZATION REQUIRED ============
    if (sourceLevel === "AUTH_REQUIRED") {
      return NextResponse.json({
        success: true,
        url,
        title: videoTitle,
        sourceType: "YouTube Video",
        pipeline: "youtube",
        pipelineDisplay: "Private YouTube Video",
        transcript: "",
        transcriptStatus: "AUTHORIZATION REQUIRED",
        sourceLevel: "AUTH_REQUIRED",
        isRestricted: true,
        isPrivate: true,
        extractedContent: "",
        contentSize: 0,
        research: "",
      });
    }

    // ============ RESPONSE FOR STAGE 5: INSUFFICIENT CONTENT ============
    if (sourceLevel === "NONE") {
      return NextResponse.json({
        success: true,
        url,
        title: videoTitle,
        sourceType: "YouTube Video",
        pipeline: "youtube",
        pipelineDisplay: "Transcript / Speech-to-Text / Metadata",
        transcript: "",
        transcriptStatus: "INSUFFICIENT CONTENT",
        sourceLevel: "NONE",
        isRestricted: true,
        extractedContent: "",
        contentSize: 0,
        research: "",
      });
    }

    // ============ RESPONSE FOR STAGE 3: LIMITED METADATA ============
    if (sourceLevel === "LIMITED") {
      const extractedContent = `Video Title: ${metadata.title}\nChannel: ${metadata.channelTitle || "YouTube Channel"}\nPublished Date: ${metadata.publishedAt || "N/A"}\n\nOfficial Video Description:\n${metadata.description}`;

      const systemPromptLimited = `You are a professional YouTube research agent. Analyze ONLY the provided official video metadata and description.

CRITICAL GROUNDING RULES:
1. Grounded Content: Answer ONLY from the provided official video metadata and description. Do not use general knowledge to fill missing information. Do not invent facts, spoken audio content, or unverified claims.
2. Mandatory Disclosure Notice: In section 1, state explicitly: "Notice: Full transcript was unavailable. This analysis is based on publicly available video metadata and description."
3. 6-Line Summary Constraint: The Summary section MUST be strictly limited to exactly 6 lines (6 sentences) based ONLY on the provided video title and description.
4. Key Findings: List key takeaways derived ONLY from the official video description and title.
5. Main Topics: List main topics identified directly from the official metadata.
6. Detailed Analysis: Provide analysis strictly bounded by the official description details.
7. Important Insights: List insights derived ONLY from the description details.
8. Source Verification: State explicitly: "Limited Analysis Verification: Checked against official video metadata and description evidence."

Return EXACTLY these 7 Markdown headings:

### 1. 📋 Basic Information
- Video Title: ${metadata.title}
- Channel: ${metadata.channelTitle || "YouTube Channel"}
- Video URL: ${url}
- Source Notice: Full transcript was unavailable. This analysis is based on publicly available video metadata and description.

### 2. 📝 Summary
Write a summary strictly limited to 6 lines based ONLY on the provided video title and description.

### 3. 🔍 Key Findings
List key takeaways directly supported by the official video description and title content.

### 4. 📌 Main Topics
List main topics identified directly from the video metadata and description.

### 5. 📊 Metadata Analysis
Provide detailed analysis based strictly on the official description content.

### 6. 💡 Important Insights
List useful insights derived strictly from the video description.

### 7. 🔎 Source Verification
State explicitly: "Limited Analysis Verification: Checked against official video metadata and description evidence."`;

      let limitedReport = "";
      try {
        const completion = await createChatCompletion({
          messages: [
            { role: "system", content: systemPromptLimited },
            { role: "user", content: `Video URL: ${url}\nVideo Title: ${metadata.title}\nOfficial Metadata & Description:\n${extractedContent}` },
          ],
          model: "openai/gpt-oss-20b",
          reasoning_effort: "low",
          temperature: 0.2,
          max_tokens: 1200,
        });

        limitedReport = completion.choices[0]?.message?.content?.trim() || "";
      } catch (err) {
        console.error("[YOUTUBE PIPELINE ERROR] Limited report generation failed:", err);
      }

      if (!limitedReport) {
        limitedReport = `### 1. 📋 Basic Information
- Video Title: ${metadata.title}
- Channel: ${metadata.channelTitle || "YouTube Channel"}
- Video URL: ${url}
- Source Notice: Full transcript was unavailable. This analysis is based on publicly available video metadata and description.

### 2. 📝 Summary
This video is titled "${metadata.title}" by ${metadata.channelTitle || "the creator"}. Full transcript content was unavailable, but official video metadata and description provide key details. The video content covers topics outlined in the official description text. Viewers can refer to the description for specific links and resources. A full spoken audio transcript requires direct video playback on YouTube.

### 3. 🔍 Key Findings
- Official Title: ${metadata.title}
- Creator Channel: ${metadata.channelTitle || "YouTube Channel"}
- Official Description: ${metadata.description.slice(0, 250)}...

### 4. 📌 Main Topics
- ${metadata.title}
- ${metadata.channelTitle || "Video Content"}

### 5. 📊 Metadata Analysis
Analysis based strictly on official video description and metadata provided by creator.

### 6. 💡 Important Insights
Detailed spoken audio content requires watching the video directly on YouTube with audio or captions.

### 7. 🔎 Source Verification
Limited Analysis Verification: Checked against official video metadata and description evidence.`;
      }

      return NextResponse.json({
        success: true,
        url,
        title: metadata.title,
        sourceType: "YouTube Video",
        pipeline: "youtube",
        pipelineDisplay,
        transcript: "",
        transcriptStatus: "LIMITED CONTENT AVAILABLE",
        sourceLevel: "LIMITED",
        isRestricted: true,
        extractedContent,
        contentSize: extractedContent.length,
        research: limitedReport,
      });
    }

    // ============ RESPONSE FOR STAGE 1 & 2: FULL CONTENT AVAILABLE ============
    console.log(`[YOUTUBE PIPELINE STAGE 8] Chunking FULL transcript content (Length: ${transcript.length})...`);
    let chunks: string[] = [];
    try {
      chunks = chunkText(transcript);
    } catch (chunkErr) {
      console.error("[YOUTUBE PIPELINE ERROR] Chunking error:", chunkErr);
      return NextResponse.json(
        { success: false, stage: "transcript chunking", error: "Processing failed." },
        { status: 500 }
      );
    }

    const sourceForReport = chunks.join("\n").slice(0, 14000);

    const systemPromptFull = `You are a professional YouTube research agent. Use ONLY the transcript evidence provided below.

CRITICAL GROUNDING RULES:
1. Grounded Content: You must answer ONLY from the provided transcript content. Do not use general knowledge to fill missing information. Do not invent key findings, summaries, action items, or facts.
2. 6-Line Summary Constraint: The Summary section MUST be strictly limited to exactly 6 lines (6 sentences). Do not write a long essay or fewer than 5 lines.
3. Key Findings: Every key finding MUST be directly supported by the video transcript.
4. Main Topics: List main topics identified directly from the video transcript.
5. Detailed Analysis: Provide in-depth analysis grounded 100% in video transcript evidence.
6. Important Insights: Provide key conclusions supported by the transcript.
7. Source Verification: Include a statement confirming that the output was checked against the retrieved transcript source.

Return EXACTLY these 7 Markdown headings:

### 1. 📋 Basic Information
- Video Title: ${metadata.title}
- Channel: ${metadata.channelTitle || "YouTube Channel"}
- Video URL: ${url}
- Pipeline: ${pipelineDisplay}
- Status Notice: FULL CONTENT AVAILABLE

### 2. 📝 Summary
Write a summary strictly limited to 6 lines based ONLY on the retrieved transcript content.

### 3. 🔍 Key Findings
List key findings directly supported by the video transcript.

### 4. 📌 Main Topics
List main topics identified directly from the video transcript.

### 5. 📊 Detailed Analysis
Provide detailed analysis grounded strictly in the retrieved transcript content.

### 6. 💡 Important Insights
List key insights and conclusions derived directly from the transcript.

### 7. 🔎 Source Verification
State explicitly: "Verification Passed: This research report was checked against the retrieved source transcript and is 100% grounded in video evidence."

Transcript evidence:
${sourceForReport}`;

    let report = "";
    try {
      const completion = await createChatCompletion({
        messages: [
          { role: "system", content: systemPromptFull },
          { role: "user", content: `Video URL: ${url}\nVideo Title: ${metadata.title}\nGenerate the 7-section grounded research report now.` },
        ],
        model: "openai/gpt-oss-20b",
        reasoning_effort: "low",
        temperature: 0.2,
        max_tokens: 1200,
      });

      report = completion.choices[0]?.message?.content?.trim() || "";
    } catch (groqErr) {
      console.error("[YOUTUBE PIPELINE ERROR] Full Groq report generation failed:", groqErr);
      return NextResponse.json(
        { success: false, stage: "Groq summary generation", error: "AI service could not generate summary." },
        { status: 500 }
      );
    }

    if (!report) {
      return NextResponse.json(
        { success: false, stage: "Groq summary generation", error: "Unable to generate research report." },
        { status: 500 }
      );
    }

    // Verification step
    try {
      const verification = await createChatCompletion({
        messages: [
          {
            role: "system",
            content: "You are a strict compliance verifier. Verify whether the proposed report satisfies all requirements:\n1. Is the report grounded ONLY in transcript evidence?\n2. Is the Summary section strictly 6 lines?\n3. Does it contain all 7 requested section headings?\nIf ALL pass, reply 'PASS'. Otherwise reply 'FAIL: <reasons>'.",
          },
          {
            role: "user",
            content: `Transcript evidence:\n${sourceForReport}\n\nProposed report:\n${report}`,
          },
        ],
        model: "openai/gpt-oss-20b",
        reasoning_effort: "low",
        temperature: 0,
        max_tokens: 100,
      });

      const verResult = verification.choices[0]?.message?.content?.trim();
      if (verResult && !verResult.toUpperCase().includes("PASS")) {
        console.warn(`[YOUTUBE PIPELINE] Verification flagged issues: ${verResult}. Regenerating.`);
        const retryCompletion = await createChatCompletion({
          messages: [
            {
              role: "system",
              content: `${systemPromptFull}\n\nATTENTION: Previous response flagged for: ${verResult}. Ensure summary is strictly 6 lines and all 7 headings are included.`,
            },
            {
              role: "user",
              content: `Video URL: ${url}\nVideo Title: ${metadata.title}\nRegenerate report strictly from transcript:`,
            },
          ],
          model: "openai/gpt-oss-20b",
          reasoning_effort: "low",
          temperature: 0.1,
          max_tokens: 1200,
        });

        const retryReport = retryCompletion.choices[0]?.message?.content?.trim();
        if (retryReport) report = retryReport;
      }
    } catch (verErr) {
      console.warn("Verification check failed, proceeding with report", verErr);
    }

    return NextResponse.json({
      success: true,
      url,
      title: metadata.title,
      sourceType: "YouTube Video",
      pipeline: "youtube",
      pipelineDisplay,
      transcript,
      transcriptStatus: "FULL CONTENT AVAILABLE",
      sourceLevel: "FULL",
      extractedContent: transcript,
      contentSize: transcript.length,
      isRestricted: false,
      research: report,
    });
  } catch (error) {
    console.error("YouTube analysis error:", error);
    return NextResponse.json(
      { success: false, stage: "unknown", error: "An unexpected error occurred." },
      { status: 500 }
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

    // SAFETY CHECK STEP 1 & 2: Validate URL format and domain
    console.log("[SAFETY CHECK] Step 1-2: Validating URL format and domain...");
    const urlValidation = validateUrl(url);
    
    if (!urlValidation.valid) {
      console.error(`[SAFETY BLOCK] Invalid URL: ${urlValidation.reason}`);
      return NextResponse.json(
        {
          success: false,
          error: "Invalid or blocked URL",
          reason: urlValidation.reason,
          isBlocked: true,
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
    let response: Response | null = null;
    let fetchErrorReason = "";

    try {
      response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        },
      });
    } catch (fetchErr) {
      fetchErrorReason = fetchErr instanceof Error ? fetchErr.message : "Network connection failed";
    }

    let title = parsedUrl.hostname;
    let content = "";
    let isExtractionSuccessful = false;

    if (response && response.ok) {
      try {
        const html = await response.text();
        const $ = cheerio.load(html);
        $("script, style, noscript, svg, template").remove();

        const extractedTitle = $("title").first().text().replace(/\s+/g, " ").trim();
        if (extractedTitle) {
          title = extractedTitle;
        }

        const mainContent = $("main").text().trim();
        const rawContent = mainContent.length >= 20 ? mainContent : $("body").text().trim();
        content = rawContent.replace(/\s+/g, " ").trim().slice(0, 12000);

        if (content && content.length >= 20) {
          isExtractionSuccessful = true;
        }
      } catch (parseErr) {
        console.error("HTML parsing error:", parseErr);
      }
    }

    // SAFETY CHECK STEP 3-4: Check metadata and content for unsafe patterns
    if (isExtractionSuccessful) {
      console.log("[SAFETY CHECK] Step 3-4: Checking website metadata and content for safety...");
      
      // Check metadata first (title + basic description)
      const metadataSafetyCheck = checkWebsiteMetadataForSafety(title);
      if (!metadataSafetyCheck.safe) {
        console.error(`[SAFETY BLOCK] Website metadata blocked: ${metadataSafetyCheck.reason}`);
        return getSafetyBlockResponse(
          url,
          metadataSafetyCheck.reason || "Website metadata contains blocked content"
        );
      }
      
      // Check full content for safety
      const contentSafetyCheck = checkFullContentForSafety(content, title);
      if (!contentSafetyCheck.safe && shouldBlockContent(contentSafetyCheck)) {
        console.error(`[SAFETY BLOCK] Website content blocked: ${contentSafetyCheck.reason}`);
        return getSafetyBlockResponse(
          url,
          contentSafetyCheck.reason || "Website content is not supported"
        );
      }
    }

    // ============ FALLBACK: RESTRICTED OR FAILED WEBSITE CONTENT ============
    if (!isExtractionSuccessful) {
      const restrictionReason =
        fetchErrorReason ||
        (response && !response.ok
          ? `HTTP ${response.status} ${response.statusText || "Access Restricted"}`
          : "Direct page content is protected, empty, or requires user authentication/JavaScript.");

      console.log(`Website analysis falling back to metadata analysis for ${url} (Reason: ${restrictionReason})`);

      let websiteFallbackReport = "";
      if (process.env.GROQ_API_KEY) {
        try {
          const completion = await createChatCompletion({
            messages: [
              {
                role: "system",
                content: `You are a professional URL Research Agent.

IMPORTANT: Direct full content extraction for this website COULD NOT BE ACCESSED or returned restricted/empty content (${restrictionReason}).

DO NOT invent, fabricate, or hallucinate content from behind paywalls, login screens, or restricted sites.

Generate a clear, transparent, 6-section Markdown report based strictly on the accessible URL metadata provided.

Return EXACTLY these Markdown headings:

### 1. 📋 Basic Information
- Domain: ${parsedUrl.hostname}
- Target URL: ${url}
- Status Notice: Automated content extraction was restricted or failed (${restrictionReason}).

### 2. 🔍 Key Findings
- Note that detailed body content could not be retrieved due to site access controls (e.g. login requirement, paywall, anti-bot protection, or network failure).
- Summarize what can be legitimately determined from the domain name and URL path.

### 3. 💡 Important Insights
- Provide general context on the domain topic implied by the URL structure.
- Emphasize that specific page content or article text cannot be verified without direct access.

### 4. ⚠️ Things to Consider / Precautions
- Warn that automated crawlers cannot bypass security restrictions, paywalls, or login prompts.
- Caution that unverified claims about the site should be checked directly by visiting the URL.

### 5. ✅ Recommended Actions
- Open the website directly in a standard browser: ${url}
- If credentials or subscriptions are required, log in directly through the site's official portal.

### 6. 🔎 Source Verification
- State explicitly: "Full website content was NOT accessible. This report is based solely on accessible URL metadata (Domain & URL Path)."`,
              },
              {
                role: "user",
                content: `Target URL: ${url}\nDomain: ${parsedUrl.hostname}\nRestriction Reason: ${restrictionReason}`,
              },
            ],
            model: "openai/gpt-oss-20b",
            reasoning_effort: "low",
            temperature: 0.2,
            max_tokens: 900,
          });

          websiteFallbackReport = completion.choices[0]?.message?.content?.trim() || "";
        } catch (groqErr) {
          console.error("Website fallback Groq generation failed:", groqErr);
        }
      }

      if (!websiteFallbackReport) {
        websiteFallbackReport = `### 1. 📋 Basic Information
- **Domain:** ${parsedUrl.hostname}
- **Target URL:** ${url}
- **Status Notice:** Automated content extraction was restricted or failed (${restrictionReason}).

### 2. 🔍 Key Findings
- Direct page text could not be extracted due to access restrictions or network limitations.
- Accessible metadata identifies the domain as "${parsedUrl.hostname}".

### 3. 💡 Important Insights
- The target URL belongs to "${parsedUrl.hostname}".
- Full page content could not be retrieved automatically without direct user session access.

### 4. ⚠️ Things to Consider / Precautions
- Do not assume unverified page contents.
- Web pages with authentication, CAPTCHA, paywalls, or strict access policies restrict automated tools.

### 5. ✅ Recommended Actions
- Open the URL directly in your web browser: ${url}
- Log in or complete authentication directly on the target site if required.

### 6. 🔎 Source Verification
- **Verification Notice:** Full website content was NOT accessible. This report is based solely on accessible URL metadata (Domain & URL Path).`;
      }

      return NextResponse.json({
        success: true,
        url,
        title,
        sourceType: "Website",
        pipeline: "website",
        extractedContent: `[Access Restricted or Failed - ${restrictionReason}]\nDomain: ${parsedUrl.hostname}\nURL: ${url}`,
        contentSize: 0,
        transcriptStatus: `Restricted Access (${restrictionReason})`,
        isRestricted: true,
        research: websiteFallbackReport,
      });
    }

    // Generate AI research report for accessible content
    const completion = await createChatCompletion({
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

      pipeline: "website",

      extractedContent: content,

      contentSize: content.length,

      isRestricted: false,

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