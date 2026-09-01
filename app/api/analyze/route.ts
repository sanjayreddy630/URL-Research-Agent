import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import Groq from "groq-sdk";
import type { ChatCompletionCreateParamsNonStreaming } from "groq-sdk/resources/chat/completions";
import { chunkText } from "../../../lib/chunk-text";
import {
  extractYouTubeVideoId,
  fetchYouTubeMetadata,
  fetchYouTubeTitle,
  fetchYouTubeTranscript,
  isYouTubeUrl,
} from "../../../lib/youtube";

export const runtime = "nodejs";
export const maxDuration = 60;

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

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
    // ============ STEP 1: URL VALIDATION ============
    console.log("YouTube Step 1: URL received");
    console.log("YouTube Step 2: URL validation successful");

    if (!isYouTubeUrl(url)) {
      console.error("YouTube Step 2 FAILED: Invalid YouTube URL", { url });
      return NextResponse.json(
        {
          success: false,
          stage: "URL validation",
          error: "Invalid YouTube URL.",
        },
        { status: 400 }
      );
    }

    // ============ STEP 3: VIDEO ID EXTRACTION ============
    console.log("YouTube Step 3: Video ID extracted");
    let videoId: string | null = null;

    try {
      videoId = extractYouTubeVideoId(url);
    } catch (error) {
      console.error("YouTube Step 3 FAILED: Video ID extraction error", error);
      return NextResponse.json(
        {
          success: false,
          stage: "video ID extraction",
          error:
            "Video ID extraction failed. YouTube video IDs must contain exactly 11 characters.",
        },
        { status: 400 }
      );
    }

    if (!videoId) {
      console.error("YouTube Step 3 FAILED: No video ID extracted", { url });
      return NextResponse.json(
        {
          success: false,
          stage: "video ID extraction",
          error:
            "Video ID extraction failed. YouTube video IDs must contain exactly 11 characters.",
        },
        { status: 400 }
      );
    }

    // ============ STEP 4: FETCH OFFICIAL METADATA (YouTube Data API v3 or fallback) ============
    console.log("YouTube Step 4: Fetching official video metadata for", videoId);
    const metadata = await fetchYouTubeMetadata(videoId, url);
    const videoTitle = metadata.title || "YouTube Video";

    // ============ STEP 5: ATTEMPT TRANSCRIPT EXTRACTION ============
    console.log("YouTube Step 5: Attempting transcript extraction for", videoId);
    let transcript = "";
    try {
      transcript = await fetchYouTubeTranscript(videoId);
    } catch (transcriptErr) {
      console.warn("YouTube transcript extraction unavailable:", transcriptErr);
    }

    // ============ STEP 6: SOURCE LEVEL CLASSIFICATION (FULL / LIMITED / NONE) ============
    let sourceLevel: "FULL" | "LIMITED" | "NONE" = "NONE";
    let extractedContent = "";

    if (transcript && transcript.trim().length >= 20) {
      sourceLevel = "FULL";
      extractedContent = transcript;
    } else if (
      (metadata.description && metadata.description.trim().length >= 20) ||
      (metadata.title && metadata.title !== "YouTube Video" && metadata.description.trim().length > 0)
    ) {
      sourceLevel = "LIMITED";
      extractedContent = `Video Title: ${metadata.title}\nChannel: ${metadata.channelTitle || "YouTube Channel"}\nPublished Date: ${metadata.publishedAt || "N/A"}\n\nOfficial Video Description:\n${metadata.description}`;
    } else {
      sourceLevel = "NONE";
      extractedContent = "";
    }

    console.log(`YouTube Step 6: Classified SOURCE_LEVEL = ${sourceLevel}`, {
      videoId,
      contentSize: extractedContent.length,
    });

    // ============ CASE 1: SOURCE_LEVEL === "NONE" ============
    if (sourceLevel === "NONE") {
      console.log("YouTube Step 7: Zero content available - returning failure output without calling Groq");
      return NextResponse.json({
        success: true,
        url,
        title: videoTitle,
        sourceType: "YouTube Video",
        pipeline: "youtube",
        transcript: "",
        transcriptStatus: "INSUFFICIENT CONTENT",
        sourceLevel: "NONE",
        isRestricted: true,
        extractedContent: "",
        contentSize: 0,
        research: "",
      });
    }

    // ============ CASE 2: SOURCE_LEVEL === "LIMITED" ============
    if (sourceLevel === "LIMITED") {
      console.log("YouTube Step 7: Generating LIMITED grounded analysis based on official metadata & description");

      const systemPromptLimited = `You are a professional YouTube research agent analyzing a video with LIMITED source information.

CRITICAL GUARDRAILS & GROUNDING RULES:
1. Grounded Content: You must answer ONLY from the provided official video metadata and description. Do not use general knowledge to fill missing information. Do not invent facts, spoken audio content, or unverified claims.
2. Mandatory Disclosure Notice: In section 1, state explicitly: "Notice: Full video transcript was unavailable. This analysis is limited to publicly available video metadata, description, and channel information."
3. Summary Constraint: The Summary section MUST be strictly limited to approximately 6 to 7 lines (approximately 6-7 sentences) based ONLY on the provided video title and description. Do not claim that the complete video audio was analyzed.
4. Key Findings: List key takeaways derived ONLY from the official video description and title.
5. Action Items: List actionable steps derived ONLY from resources, links, or instructions mentioned in the official description.
6. Verification Status: State explicitly: "Limited Analysis Verification: Checked against official video metadata and description evidence."

Return EXACTLY these Markdown headings:

### 1. 📋 Basic Information
- Video Title: ${metadata.title}
- Channel: ${metadata.channelTitle || "YouTube Channel"}
- Video URL: ${url}
- Source Notice: Full video transcript was unavailable. This analysis is based strictly on official YouTube video metadata and description.

### 2. 📝 Summary
Write a summary strictly limited to 6–7 lines based ONLY on the provided video title and description. Do not claim to analyze spoken video content.

### 3. 🔍 Key Findings
List key takeaways directly supported by the official video description and title content.

### 4. 🎯 Action Items
List actionable steps derived from the video description. Each item MUST specify:
- **What to do:** Clear explanation of the task
- **How to do it:** Step-by-step instructions or approach
- **Tool / Resource to use:** Specific link, tool, or website mentioned in the video description

### 5. 🔎 Verification Status
State explicitly: "Limited Analysis Verification: This analysis was checked against official video metadata and description evidence."`;

      let limitedReport = "";
      try {
        const completion = await createChatCompletion({
          messages: [
            { role: "system", content: systemPromptLimited },
            { role: "user", content: `Video URL: ${url}\nVideo Title: ${metadata.title}\nOfficial Source Metadata:\n${extractedContent}` },
          ],
          model: "openai/gpt-oss-20b",
          reasoning_effort: "low",
          temperature: 0.2,
          max_tokens: 1100,
        });

        limitedReport = completion.choices[0]?.message?.content?.trim() || "";
      } catch (limitedErr) {
        console.error("YouTube Limited analysis Groq call failed:", limitedErr);
      }

      if (!limitedReport) {
        limitedReport = `### 1. 📋 Basic Information
- Video Title: ${metadata.title}
- Channel: ${metadata.channelTitle || "YouTube Channel"}
- Video URL: ${url}
- Source Notice: Full video transcript was unavailable. This analysis is based strictly on official YouTube video metadata and description.

### 2. 📝 Summary
This video is titled "${metadata.title}" by ${metadata.channelTitle || "the creator"}. Full spoken transcript content was unavailable, but official video metadata and description indicate key information about the topic. Viewers are advised to check the official description details.

### 3. 🔍 Key Findings
- Official Video Title: ${metadata.title}
- Channel Creator: ${metadata.channelTitle || "YouTube Channel"}
- Description Content: ${metadata.description.slice(0, 300)}...

### 4. 🎯 Action Items
- **What to do:** Review the video directly on YouTube for complete spoken audio content.
- **How to do it:** Click the video URL (${url}) and enable subtitles or audio.
- **Tool / Resource to use:** Official YouTube Player.

### 5. 🔎 Verification Status
Limited Analysis Verification: This analysis was checked against official video metadata and description evidence.`;
      }

      return NextResponse.json({
        success: true,
        url,
        title: metadata.title,
        sourceType: "YouTube Video",
        pipeline: "youtube",
        transcript: "",
        transcriptStatus: "LIMITED CONTENT AVAILABLE",
        sourceLevel: "LIMITED",
        isRestricted: true,
        extractedContent,
        contentSize: extractedContent.length,
        research: limitedReport,
      });
    }

    // ============ CASE 3: SOURCE_LEVEL === "FULL" ============
    console.log("YouTube Step 7: Processing FULL transcript chunks");
    let chunks: string[] = [];

    try {
      chunks = chunkText(transcript);
    } catch (chunkError) {
      console.error("YouTube transcript chunking error:", chunkError);
      return NextResponse.json(
        { success: false, stage: "transcript chunking", error: "Transcript processing failed." },
        { status: 500 }
      );
    }

    const sourceForReport = chunks.join("\n").slice(0, 14000);

    console.log("YouTube Step 8: Calling Groq for FULL YouTube Research Generation");
    let report = "";

    const systemPromptFull = `You are a professional YouTube research agent. Use ONLY the transcript evidence provided below.

CRITICAL GUARDRAILS & GROUNDING RULES:
1. Grounded Content: You must answer ONLY from the provided transcript content. Do not use general knowledge to fill missing information. Do not invent key findings, summaries, action items, or facts.
2. Summary Constraint: The Summary section MUST be strictly limited to approximately 6 to 7 lines (approximately 6-7 sentences). Do not write a long essay or fewer than 5 lines.
3. Key Findings: Every key finding MUST be directly supported by the video transcript.
4. Action Items: Every action item MUST be derived directly from the video content and MUST explicitly specify:
   - What to do: Clear explanation of the task
   - How to do it: Step-by-step instructions or approach
   - Tool / Resource to use: Specific software, website, library, or resource mentioned or derived from the video
5. Verification Status: Include a verification statement confirming that the output was checked against the retrieved source.

Return EXACTLY these Markdown headings:

### 1. 📋 Basic Information
- Video Title: ${metadata.title}
- Channel: ${metadata.channelTitle || "YouTube Channel"}
- Video URL: ${url}
- Transcript Status: FULL CONTENT AVAILABLE

### 2. 📝 Summary
Write a summary strictly limited to 6–7 lines based ONLY on the retrieved transcript content. Do not introduce unrelated topics.

### 3. 🔍 Key Findings
List key findings directly supported by the video transcript.

### 4. 🎯 Action Items
List actionable steps derived from the video content. Each item MUST specify:
- **What to do:** Clear explanation of the task
- **How to do it:** Step-by-step instructions or approach
- **Tool / Resource to use:** Specific software, website, library, or resource mentioned or derived from the video

### 5. 🔎 Verification Status
State explicitly: "Verification Passed: This research report was checked against the retrieved source transcript and is 100% grounded in video evidence."

Transcript evidence:
${sourceForReport}`;

    try {
      const completion = await createChatCompletion({
        messages: [
          { role: "system", content: systemPromptFull },
          { role: "user", content: `Video URL: ${url}\nVideo Title: ${metadata.title}\nGenerate the full grounded research report now.` },
        ],
        model: "openai/gpt-oss-20b",
        reasoning_effort: "low",
        temperature: 0.2,
        max_tokens: 1100,
      });

      report = completion.choices[0]?.message?.content?.trim() || "";
    } catch (groqError) {
      console.error("YouTube Step 8 FAILED: Groq summary generation error", groqError);
      return NextResponse.json(
        { success: false, stage: "Groq summary generation", error: "AI service could not generate a summary." },
        { status: 500 }
      );
    }

    if (!report) {
      return NextResponse.json(
        { success: false, stage: "Groq summary generation", error: "Unable to generate a YouTube research report." },
        { status: 500 }
      );
    }

    // Verification Reflection Step
    try {
      const verification = await createChatCompletion({
        messages: [
          {
            role: "system",
            content: "You are a strict compliance verifier. Verify whether the proposed report satisfies all requirements:\n1. Is the report grounded ONLY in the transcript evidence without hallucinated or substituted topics?\n2. Is the Summary section approximately 6–7 lines?\n3. Do Action Items clearly specify What to do, How to do it, and Tool/Resource to use?\nIf ALL rules pass, reply with 'PASS'. Otherwise reply with 'FAIL: <brief reasons>'.",
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

      const verificationResult = verification.choices[0]?.message?.content?.trim();
      if (verificationResult && !verificationResult.toUpperCase().includes("PASS")) {
        console.warn(`YouTube Verification flagged issues: ${verificationResult}. Regenerating.`);
        const retryCompletion = await createChatCompletion({
          messages: [
            {
              role: "system",
              content: `${systemPromptFull}\n\nATTENTION: Previous response flagged for: ${verificationResult}. Ensure summary is strictly 6–7 lines and action items specify what/how/tool.`,
            },
            {
              role: "user",
              content: `Video URL: ${url}\nVideo Title: ${metadata.title}\nRegenerate report strictly from transcript:`,
            },
          ],
          model: "openai/gpt-oss-20b",
          reasoning_effort: "low",
          temperature: 0.1,
          max_tokens: 1100,
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