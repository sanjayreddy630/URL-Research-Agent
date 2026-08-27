import { YoutubeTranscript } from "youtube-transcript";

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
