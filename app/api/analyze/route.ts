import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

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