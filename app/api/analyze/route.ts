import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import Groq from "groq-sdk";
import type { ChatCompletionCreateParamsNonStreaming } from "groq-sdk/resources/chat/completions";
import { chunkText } from "../../../lib/chunk-text";
import {
  extractYouTubeVideoId,
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
      console.error("YouTube Step 3 FAILED: Video ID extraction error");
      console.error("EXACT ERROR:", error);
      if (error instanceof Error) {
        console.error(error.message);
        console.error(error.stack);
      }
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

    console.log("YouTube Step 3: Video ID extracted successfully", { videoId });

    // ============ GROQ API KEY VALIDATION ============
    if (!process.env.GROQ_API_KEY) {
      console.error("YouTube analysis error: GROQ_API_KEY is missing");
      return NextResponse.json(
        {
          success: false,
          stage: "environment",
          error:
            "The AI service is not configured correctly. Add a valid GROQ_API_KEY to the server environment and redeploy.",
        },
        { status: 500 }
      );
    }

    // ============ STEP 4: PRIMARY TRANSCRIPT EXTRACTION ============
    console.log("YouTube Step 4: Attempting transcript extraction", { videoId });
    let transcript: string = "";
    let transcriptStatus: string = "";

    try {
      console.log(`Fetching transcript for video ID: ${videoId}`);
      transcript = await fetchYouTubeTranscript(videoId);
      transcriptStatus = "Public transcript extracted successfully";
      console.log("YouTube Step 5: Transcript extraction result: SUCCESS", {
        videoId,
        transcriptLength: transcript.length,
      });
    } catch (transcriptError) {
      console.error("YouTube Step 5: Transcript extraction result: FAILED", { videoId });
      console.error("EXACT ERROR:", transcriptError);
      if (transcriptError instanceof Error) {
        console.error("Error message:", transcriptError.message);
        console.error("Error stack:", transcriptError.stack);
      }

      // No public transcript available - attempt fallback analysis based on accessible metadata
      console.log(`YouTube Step 6: Transcript extraction failed for video ${videoId} - executing fallback metadata analysis`);
      
      const errorResp = getYouTubeErrorResponse(transcriptError, videoId);
      const restrictionReason = errorResp.error;

      let title = "YouTube Video";
      try {
        title = await fetchYouTubeTitle(url).catch(() => "YouTube Video");
      } catch (titleErr) {
        console.error("YouTube fallback title extraction failed:", titleErr);
      }

      let fallbackReport = "";
      if (process.env.GROQ_API_KEY) {
        try {
          const completion = await createChatCompletion({
            messages: [
              {
                role: "system",
                content: `You are a professional YouTube research agent.

IMPORTANT: The full transcript for this YouTube video COULD NOT BE ACCESSED due to access restrictions or unavailable captions (${restrictionReason}).

DO NOT invent, fabricate, or hallucinate video audio or transcript content.

Generate a clear, transparent, 6-section Markdown report based strictly on the accessible video metadata provided.

Return EXACTLY these Markdown headings:

### 1. 📋 Basic Information
- Video Title: ${title}
- Video URL: ${url}
- Status Notice: Full video transcript could NOT be retrieved (${restrictionReason}).

### 2. 🔍 Key Findings
- Note that detailed key findings from the video audio/transcript are unavailable because captions are disabled or restricted.
- Summarize what can be identified from the public video title and URL structure.

### 3. 💡 Important Insights
- Provide general context on the topic implied by the video title (${title}).
- Emphasize that specific claims or spoken points in the video cannot be verified without transcript access.

### 4. ⚠️ Things to Consider / Precautions
- Highlight that automated analysis could not verify spoken content or video claims.
- Caution the user that restricted or private videos cannot be transcribed by external AI tools.

### 5. ✅ Recommended Actions
- Recommend watching the video directly on YouTube with audio or manual subtitles enabled.
- Check if captions or transcripts become available in another language.

### 6. 🔎 Source Verification
- State explicitly: "Full video transcript was NOT accessible. This report is based solely on accessible YouTube metadata (Video Title and URL)."`,
              },
              {
                role: "user",
                content: `Video URL: ${url}\nVideo Title: ${title}\nRestriction Reason: ${restrictionReason}`,
              },
            ],
            model: "openai/gpt-oss-20b",
            reasoning_effort: "low",
            temperature: 0.2,
            max_tokens: 900,
          });

          fallbackReport = completion.choices[0]?.message?.content?.trim() || "";
        } catch (groqErr) {
          console.error("YouTube fallback Groq generation failed:", groqErr);
        }
      }

      if (!fallbackReport) {
        fallbackReport = `### 1. 📋 Basic Information
- **Video Title:** ${title}
- **Video URL:** ${url}
- **Status Notice:** Full video transcript could NOT be retrieved (${restrictionReason}).

### 2. 🔍 Key Findings
- Detailed spoken content and transcript findings could not be extracted due to access restrictions.
- Accessible metadata identifies the video title as "${title}".

### 3. 💡 Important Insights
- The video topic relates to "${title}".
- Spoken claims, demonstrations, or detailed explanations require manual video viewing.

### 4. ⚠️ Things to Consider / Precautions
- Do not assume unverified transcript content exists.
- Private, unlisted, or caption-disabled videos restrict automated content extraction.

### 5. ✅ Recommended Actions
- Open the video directly on YouTube: ${url}
- Enable YouTube audio or manual captions in the video player settings.

### 6. 🔎 Source Verification
- **Verification Notice:** Full video transcript was NOT accessible. This report is based solely on accessible YouTube metadata (Video Title & URL).`;
      }

      return NextResponse.json({
        success: true,
        url,
        title,
        sourceType: "YouTube Video",
        pipeline: "youtube",
        transcript: "",
        transcriptStatus: `Transcript Unavailable (${restrictionReason})`,
        isRestricted: true,
        extractedContent: `[Transcript Unavailable - ${restrictionReason}]\nVideo Title: ${title}\nVideo URL: ${url}`,
        contentSize: 0,
        research: fallbackReport,
      });
    }

    if (!transcript.trim()) {
      console.error("YouTube Step 5 FAILED: Empty transcript returned");
      return NextResponse.json(
        {
          success: false,
          stage: "transcript validation",
          error: "Empty transcript returned from YouTube.",
        },
        { status: 400 }
      );
    }

    if (transcript.length > 120000) {
      console.error("YouTube Step 5 FAILED: Transcript too large", {
        length: transcript.length,
      });
      return NextResponse.json(
        {
          success: false,
          stage: "transcript validation",
          error: "This YouTube transcript is too large to analyze. Try a shorter video.",
        },
        { status: 413 }
      );
    }

    // ============ STEP 7: TRANSCRIPT CHUNKING & PROCESSING ============
    console.log("YouTube Step 7: Processing transcript");
    let title = "YouTube Video";
    let chunks: string[] = [];

    try {
      const titlePromise = fetchYouTubeTitle(url).catch(() => "YouTube Video");
      title = await titlePromise;
    } catch (titleError) {
      console.error("YouTube title extraction failed, using default", titleError);
    }

    try {
      chunks = chunkText(transcript);
    } catch (chunkError) {
      console.error("YouTube Step 7 FAILED: Transcript chunking error");
      console.error("EXACT ERROR:", chunkError);
      if (chunkError instanceof Error) {
        console.error(chunkError.message);
        console.error(chunkError.stack);
      }
      return NextResponse.json(
        {
          success: false,
          stage: "transcript chunking",
          error: "Transcript processing failed.",
        },
        { status: 500 }
      );
    }

    if (!chunks.length) {
      console.error("YouTube Step 7 FAILED: No chunks produced");
      return NextResponse.json(
        {
          success: false,
          stage: "transcript chunking",
          error: "Transcript processing produced no usable chunks.",
        },
        { status: 500 }
      );
    }

    console.log("YouTube Step 7: Processing transcript SUCCESS", {
      title,
      transcriptLength: transcript.length,
      chunkCount: chunks.length,
    });

    const sourceForReport = chunks.join("\n").slice(0, 14000);

    // ============ STEP 8: GROQ SUMMARY GENERATION ============
    console.log("YouTube Step 8: Calling Groq");
    let report = "";

    try {
      let generationAttempt = 0;
      for (generationAttempt = 0; generationAttempt < 2; generationAttempt += 1) {
        try {
          const completion = await createChatCompletion({
            messages: [
              {
                role: "system",
                content: `You are a professional YouTube research agent. Use ONLY the transcript evidence provided below.

Create a concise report. The initial summary must be approximately 6-7 lines, not a long essay. Do not invent facts.

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
          if (report) break;
        } catch (singleAttemptError) {
          console.error(
            `YouTube Step 8: Groq report generation attempt ${generationAttempt + 1} failed`,
            singleAttemptError
          );
          if (generationAttempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }
    } catch (groqError) {
      console.error("YouTube Step 8 FAILED: Groq summary generation error");
      console.error("EXACT ERROR:", groqError);
      if (groqError instanceof Error) {
        console.error(groqError.message);
        console.error(groqError.stack);
      }
      return NextResponse.json(
        {
          success: false,
          stage: "Groq summary generation",
          error: "AI service could not generate a summary. Please try again.",
        },
        { status: 500 }
      );
    }

    if (!report) {
      console.error("YouTube Step 8 FAILED: No report generated");
      return NextResponse.json(
        {
          success: false,
          stage: "Groq summary generation",
          error: "Unable to generate a YouTube research report.",
        },
        { status: 500 }
      );
    }

    console.log("YouTube Step 8: Calling Groq SUCCESS", { reportLength: report.length });

    // ============ STEP 9: VERIFICATION/REFLECTION ============
    console.log("YouTube Step 9: Verification");

    try {
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

      console.log("YouTube Step 9: Verification result", { result: verificationResult });

      if (!verificationResult?.includes("PASS")) {
        console.warn("YouTube Step 9: Verification failed, regenerating report");
        // Try once more with a fresh attempt
        try {
          const retryCompletion = await createChatCompletion({
            messages: [
              {
                role: "system",
                content: `You are a professional YouTube research agent. Use ONLY the transcript evidence provided below.

Create a concise, factual report grounded in the transcript. Do not invent information. Return the same 6 sections as requested.

Transcript evidence:
${sourceForReport}`,
              },
              {
                role: "user",
                content: `Video URL: ${url}\nVideo title: ${title}\nTranscript status: ${transcriptStatus}. Ensure all claims are directly supported by the transcript.`,
              },
            ],
            model: "openai/gpt-oss-20b",
            reasoning_effort: "low",
            temperature: 0.1,
            max_tokens: 900,
          });

          const retryReport = retryCompletion.choices[0]?.message?.content?.trim() || report;
          if (retryReport) {
            report = retryReport;
          }
        } catch (retryError) {
          console.warn("YouTube Step 9: Verification retry failed, using original report", retryError);
        }
      }
    } catch (verificationError) {
      console.warn("YouTube Step 9: Verification check failed, proceeding with report", verificationError);
    }

    // ============ STEP 10: RETURNING RESULT ============
    console.log("YouTube Step 10: Returning result");

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
    console.error("YouTube analysis error: Unexpected error in main handler");
    console.error("EXACT ERROR:", error);
    if (error instanceof Error) {
      console.error(error.message);
      console.error(error.stack);
    }

    return NextResponse.json(
      {
        success: false,
        stage: "unknown",
        error: "An unexpected error occurred. Check the server logs for details.",
      },
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