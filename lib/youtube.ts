import { YoutubeTranscript } from "youtube-transcript";
import ytdl from "@distube/ytdl-core";

const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

export function isYouTubeUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "youtube.com" ||
      hostname === "www.youtube.com" ||
      hostname === "youtu.be";
  } catch {
    return false;
  }
}

export function extractYouTubeVideoId(value: string): string | null {
  try {
    const parsedUrl = new URL(value);
    const hostname = parsedUrl.hostname.toLowerCase();

    if (hostname === "youtu.be") {
      return parsedUrl.pathname.slice(1).split("/")[0] || null;
    }

    if (hostname === "youtube.com" || hostname === "www.youtube.com") {
      if (parsedUrl.pathname === "/watch") {
        return parsedUrl.searchParams.get("v");
      }

      if (parsedUrl.pathname.startsWith("/shorts/") || parsedUrl.pathname.startsWith("/embed/")) {
        return parsedUrl.pathname.split("/")[2] || null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export async function fetchYouTubeTranscript(videoId: string): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoId);
      const text = transcript
        .map((entry) => entry.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      if (!text) {
        throw new Error("No public transcript is available for this video.");
      }

      return text;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to fetch the YouTube transcript.");
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
        audioStream.destroy(new Error("YouTube audio is larger than the 24 MB limit."));
        return;
      }
      chunks.push(chunk);
    });
    audioStream.on("end", () => resolve(Buffer.concat(chunks)));
    audioStream.on("error", reject);
  });
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
    // Use a stable fallback when title metadata is unavailable.
  }

  return "YouTube Video";
}
