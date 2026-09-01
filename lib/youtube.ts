import { YoutubeTranscript } from "youtube-transcript";
import ytdl from "@distube/ytdl-core";

const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARACTERS = 120000;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function isYouTubeUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();

    return (
      hostname === "youtube.com" ||
      hostname === "www.youtube.com" ||
      hostname === "m.youtube.com" ||
      hostname === "youtu.be"
    );
  } catch {
    return false;
  }
}

export function extractYouTubeVideoId(
  value: string
): string | null {
  try {
    const parsedUrl = new URL(value);
    const hostname = parsedUrl.hostname.toLowerCase();

    if (hostname === "youtu.be") {
      const videoId =
        parsedUrl.pathname
          .slice(1)
          .split("/")[0] || "";

      return VIDEO_ID_PATTERN.test(videoId)
        ? videoId
        : null;
    }

    if (
      hostname === "youtube.com" ||
      hostname === "www.youtube.com" ||
      hostname === "m.youtube.com"
    ) {
      let videoId: string | null = null;

      if (parsedUrl.pathname === "/watch") {
        videoId = parsedUrl.searchParams.get("v");
      } else if (
        parsedUrl.pathname.startsWith("/shorts/") ||
        parsedUrl.pathname.startsWith("/embed/")
      ) {
        videoId =
          parsedUrl.pathname.split("/")[2] ||
          null;
      }

      return videoId &&
        VIDEO_ID_PATTERN.test(videoId)
        ? videoId
        : null;
    }

    return null;
  } catch {
    return null;
  }
}

export function cleanTranscriptText(rawText: string): string {
  if (!rawText) return "";
  return rawText
    .replace(/\[\s*(Music|Applause|Laughter|Silence|Noise|Audio|♪+)\s*\]/gi, " ")
    .replace(/[\u266A\u266B\u266C\u266D\u266E\u266F]+/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 4000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

export async function fetchYouTubeTranscript(videoId: string): Promise<string> {
  console.log(`YouTube Step 4: Starting multi-stage transcript extraction for ${videoId}`);
  const errors: string[] = [];

  // Stage 1: YoutubeTranscript library calls with language preferences
  const langPreferences = ["en", "en-US", "en-GB", undefined];
  for (const lang of langPreferences) {
    try {
      console.log(`YouTube Extraction Method 1: YoutubeTranscript (lang=${lang || "default"})`);
      const p1 = lang
        ? YoutubeTranscript.fetchTranscript(videoId, { lang })
        : YoutubeTranscript.fetchTranscript(videoId);
      const p2 = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("YoutubeTranscript library timeout (4s)")), 4000)
      );

      const entries = await Promise.race([p1, p2]);
      const combined = entries.map((e) => e.text).join(" ");
      const cleaned = cleanTranscriptText(combined);

      if (cleaned && cleaned.length >= 20) {
        if (cleaned.length > MAX_TRANSCRIPT_CHARACTERS) {
          throw new Error("TRANSCRIPT_TOO_LARGE");
        }
        console.log(
          `YouTube Step 5: Transcript extraction SUCCESS via YoutubeTranscript (lang=${
            lang || "default"
          }) for ${videoId}. Length: ${cleaned.length}`
        );
        return cleaned;
      }
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "TRANSCRIPT_TOO_LARGE") throw err;
      errors.push(`YoutubeTranscript(lang=${lang}): ${msg}`);
    }
  }

  // Stage 2: Watch page HTML scraping for captionTracks in ytInitialPlayerResponse
  try {
    console.log(`YouTube Extraction Method 2: Watch page captionTracks scraper for ${videoId}`);
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const res = await fetchWithTimeout(
      watchUrl,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
          Cookie: "CONSENT=YES+cb; SOCS=CAESEwgDEgk1Nzg3Njg3NjgGIAE",
        },
      },
      4500
    );

    if (res.ok) {
      const html = await res.text();

      if (html.includes("This video is private") || html.includes('"isPrivate":true')) {
        throw new Error("PRIVATE_VIDEO");
      }
      if (html.includes("Video unavailable") || html.includes('"status":"UNPLAYABLE"')) {
        throw new Error("VIDEO_UNAVAILABLE");
      }

      const captionMatch = html.match(/"captionTracks":\s*(\[.*?\])/);
      if (captionMatch) {
        const tracks = JSON.parse(captionMatch[1]);
        console.log(`Found ${tracks.length} caption tracks in watch HTML for ${videoId}`);

        const track =
          tracks.find((t: any) => t.languageCode === "en" && !t.kind) ||
          tracks.find((t: any) => t.languageCode?.startsWith("en")) ||
          tracks[0];

        if (track && track.baseUrl) {
          const trackRes = await fetchWithTimeout(
            track.baseUrl,
            {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                Referer: watchUrl,
              },
            },
            4000
          );

          if (trackRes.ok) {
            const xml = await trackRes.text();
            const matches = Array.from(xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g));
            const lines = matches.map((m) => m[1]);
            const combined = lines.join(" ");
            const cleaned = cleanTranscriptText(combined);

            if (cleaned && cleaned.length >= 20) {
              if (cleaned.length > MAX_TRANSCRIPT_CHARACTERS) {
                throw new Error("TRANSCRIPT_TOO_LARGE");
              }
              console.log(
                `YouTube Step 5: Transcript extraction SUCCESS via Watch Page Scraper for ${videoId}. Length: ${cleaned.length}`
              );
              return cleaned;
            }
          }
        }
      }
    }
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "PRIVATE_VIDEO" || msg === "VIDEO_UNAVAILABLE" || msg === "TRANSCRIPT_TOO_LARGE") {
      throw err;
    }
    errors.push(`WatchPageScraper: ${msg}`);
  }

  // Stage 3: Embed page HTML scraper
  try {
    console.log(`YouTube Extraction Method 3: Embed page captionTracks scraper for ${videoId}`);
    const embedUrl = `https://www.youtube.com/embed/${videoId}`;
    const res = await fetchWithTimeout(
      embedUrl,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
      4000
    );

    if (res.ok) {
      const html = await res.text();
      const captionMatch = html.match(/"captionTracks":\s*(\[.*?\])/);
      if (captionMatch) {
        const tracks = JSON.parse(captionMatch[1]);
        const track =
          tracks.find((t: any) => t.languageCode?.startsWith("en")) || tracks[0];

        if (track && track.baseUrl) {
          const trackRes = await fetchWithTimeout(
            track.baseUrl,
            {
              headers: { Referer: embedUrl },
            },
            4000
          );
          if (trackRes.ok) {
            const xml = await trackRes.text();
            const matches = Array.from(xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g));
            const lines = matches.map((m) => m[1]);
            const combined = lines.join(" ");
            const cleaned = cleanTranscriptText(combined);

            if (cleaned && cleaned.length >= 20) {
              if (cleaned.length > MAX_TRANSCRIPT_CHARACTERS) {
                throw new Error("TRANSCRIPT_TOO_LARGE");
              }
              console.log(
                `YouTube Step 5: Transcript extraction SUCCESS via Embed Scraper for ${videoId}. Length: ${cleaned.length}`
              );
              return cleaned;
            }
          }
        }
      }
    }
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "TRANSCRIPT_TOO_LARGE") throw err;
    errors.push(`EmbedPageScraper: ${msg}`);
  }

  // Stage 4: Direct TimedText API endpoints
  const ttLangs = ["en", "en-US", "en-GB", "a.en"];
  for (const lang of ttLangs) {
    try {
      console.log(`YouTube Extraction Method 4: TimedText API (lang=${lang}) for ${videoId}`);
      const apiUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}`;
      const res = await fetchWithTimeout(
        apiUrl,
        {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        },
        3000
      );
      if (res.ok) {
        const xml = await res.text();
        if (xml && xml.includes("<text")) {
          const matches = Array.from(xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g));
          const lines = matches.map((m) => m[1]);
          const combined = lines.join(" ");
          const cleaned = cleanTranscriptText(combined);

          if (cleaned && cleaned.length >= 20) {
            if (cleaned.length > MAX_TRANSCRIPT_CHARACTERS) {
              throw new Error("TRANSCRIPT_TOO_LARGE");
            }
            console.log(
              `YouTube Step 5: Transcript extraction SUCCESS via TimedText API (lang=${lang}) for ${videoId}. Length: ${cleaned.length}`
            );
            return cleaned;
          }
        }
      }
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "TRANSCRIPT_TOO_LARGE") throw err;
      errors.push(`TimedTextAPI(lang=${lang}): ${msg}`);
    }
  }

  // Stage 5: ytdl-core player response captions
  try {
    console.log(`YouTube Extraction Method 5: ytdl-core info check for ${videoId}`);
    const p1 = ytdl.getBasicInfo(videoId);
    const p2 = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("ytdl-core timeout (4s)")), 4000)
    );
    const info = await Promise.race([p1, p2]);
    const tracks =
      info.player_response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (tracks && tracks.length > 0) {
      const track =
        tracks.find((t: any) => t.languageCode?.startsWith("en")) || tracks[0];
      if (track && track.baseUrl) {
        const trackRes = await fetchWithTimeout(track.baseUrl, {}, 4000);
        if (trackRes.ok) {
          const xml = await trackRes.text();
          const matches = Array.from(xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g));
          const lines = matches.map((m) => m[1]);
          const combined = lines.join(" ");
          const cleaned = cleanTranscriptText(combined);

          if (cleaned && cleaned.length >= 20) {
            if (cleaned.length > MAX_TRANSCRIPT_CHARACTERS) {
              throw new Error("TRANSCRIPT_TOO_LARGE");
            }
            console.log(
              `YouTube Step 5: Transcript extraction SUCCESS via ytdl-core for ${videoId}. Length: ${cleaned.length}`
            );
            return cleaned;
          }
        }
      }
    }
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "TRANSCRIPT_TOO_LARGE") throw err;
    errors.push(`ytdl-core: ${msg}`);
  }

  // All methods exhausted
  console.error(
    `YouTube Step 5 FAILED: All transcript extraction methods failed for videoId=${videoId}. Logged internal errors:`,
    errors
  );
  throw new Error("NO_PUBLIC_TRANSCRIPT");
}

export async function downloadYouTubeAudio(videoId: string): Promise<Buffer> {
  const audioStream = ytdl(`https://www.youtube.com/watch?v=${videoId}`, {
    filter: "audioonly",
    quality: "lowestaudio",
  });

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  return new Promise((resolve, reject) => {
    audioStream.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_AUDIO_BYTES) {
        audioStream.destroy(
          new Error("YouTube audio is larger than the 24 MB limit.")
        );
        return;
      }
      chunks.push(chunk);
    });

    audioStream.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    audioStream.on("error", reject);
  });
}

export interface YouTubeVideoMetadata {
  title: string;
  description: string;
  channelTitle: string;
  publishedAt: string;
  thumbnails?: Record<string, any>;
  tags?: string[];
}

export async function fetchYouTubeMetadata(
  videoId: string,
  url: string
): Promise<YouTubeVideoMetadata> {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (apiKey) {
    try {
      console.log(`YouTube API v3: Fetching video details for videoId=${videoId}`);
      const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${encodeURIComponent(
        videoId
      )}&key=${encodeURIComponent(apiKey)}`;

      const res = await fetchWithTimeout(apiUrl, {}, 4000);
      if (res.ok) {
        const data = await res.json();
        const item = data?.items?.[0];
        if (item?.snippet) {
          const snippet = item.snippet;
          console.log(`YouTube API v3: Metadata retrieved successfully for ${videoId}`);
          return {
            title: snippet.title?.trim() || "YouTube Video",
            description: snippet.description?.trim() || "",
            channelTitle: snippet.channelTitle?.trim() || "",
            publishedAt: snippet.publishedAt ? new Date(snippet.publishedAt).toLocaleDateString() : "",
            thumbnails: snippet.thumbnails,
            tags: Array.isArray(snippet.tags) ? snippet.tags : [],
          };
        }
      } else {
        console.warn(`YouTube API v3 request returned HTTP ${res.status}`);
      }
    } catch (err) {
      console.error("YouTube API v3 request failed, using metadata fallback:", err);
    }
  }

  // Fallback to oEmbed + watch page HTML scraper for metadata
  console.log(`YouTube Metadata Fallback: Scraping metadata for videoId=${videoId}`);
  let title = "YouTube Video";
  let description = "";
  let channelTitle = "";

  try {
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    );
    if (oembedRes.ok) {
      const oembed = await oembedRes.json();
      if (oembed.title) title = oembed.title.trim();
      if (oembed.author_name) channelTitle = oembed.author_name.trim();
    }
  } catch {
    // Ignore
  }

  try {
    const watchRes = await fetchWithTimeout(
      `https://www.youtube.com/watch?v=${videoId}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
      },
      3500
    );
    if (watchRes.ok) {
      const html = await watchRes.text();
      if (title === "YouTube Video") {
        const tMatch =
          html.match(/<meta\s+name="title"\s+content="(.*?)"/i) ||
          html.match(/<meta\s+property="og:title"\s+content="(.*?)"/i);
        if (tMatch && tMatch[1]) {
          title = tMatch[1].replace(/ - YouTube$/i, "").trim();
        }
      }

      const descMatch =
        html.match(/<meta\s+name="description"\s+content="(.*?)"/i) ||
        html.match(/<meta\s+property="og:description"\s+content="(.*?)"/i);
      if (descMatch && descMatch[1]) {
        description = descMatch[1]
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&")
          .trim();
      }

      if (!channelTitle) {
        const chanMatch = html.match(/<link\s+itemprop="name"\s+content="(.*?)"/i);
        if (chanMatch && chanMatch[1]) channelTitle = chanMatch[1].trim();
      }
    }
  } catch {
    // Ignore
  }

  return {
    title,
    description,
    channelTitle,
    publishedAt: "",
  };
}

export async function fetchYouTubeTitle(url: string): Promise<string> {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    );

    if (response.ok) {
      const data = await response.json();
      if (typeof data.title === "string" && data.title.trim()) {
        return data.title.trim();
      }
    }
  } catch {
    // Fallback if oEmbed is unavailable
  }

  try {
    const videoId = extractYouTubeVideoId(url);
    if (videoId) {
      const pageRes = await fetchWithTimeout(
        `https://www.youtube.com/watch?v=${videoId}`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          },
        },
        3000
      );
      if (pageRes.ok) {
        const html = await pageRes.text();
        const titleMatch =
          html.match(/<meta\s+name="title"\s+content="(.*?)"/i) ||
          html.match(/<meta\s+property="og:title"\s+content="(.*?)"/i) ||
          html.match(/<title>(.*?)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
          const cleanTitle = titleMatch[1]
            .replace(/ - YouTube$/i, "")
            .replace(/&amp;/g, "&")
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .trim();
          if (cleanTitle) return cleanTitle;
        }
      }
    }
  } catch {
    // Stable fallback
  }

  return "YouTube Video";
}

export async function checkYouTubePrivateVideo(videoId: string): Promise<boolean> {
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const res = await fetchWithTimeout(
      watchUrl,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
      },
      3000
    );
    if (res.ok) {
      const html = await res.text();
      if (
        html.includes("This video is private") ||
        html.includes('"isPrivate":true') ||
        html.includes("Private video") ||
        html.includes("Requires authorization")
      ) {
        return true;
      }
    }
  } catch {
    // Ignore
  }
  return false;
}