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

export async function fetchYouTubeTranscript(
  videoId: string
): Promise<string> {
  console.log(
    `YouTube Step 4: Attempting transcript extraction for ${videoId}`
  );

  try {
    const transcript =
      await YoutubeTranscript.fetchTranscript(
        videoId
      );

    const text = transcript
      .map((entry) => entry.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      throw new Error(
        "NO_PUBLIC_TRANSCRIPT"
      );
    }

    if (
      text.length >
      MAX_TRANSCRIPT_CHARACTERS
    ) {
      throw new Error(
        "TRANSCRIPT_TOO_LARGE"
      );
    }

    console.log(
      `YouTube Step 5: Transcript extraction successful for ${videoId}`
    );

    return text;
  } catch (error) {
    const errorMsg =
      error instanceof Error
        ? error.message
        : String(error);

    const normalized =
      errorMsg.toLowerCase();

    console.error(
      `YouTube Step 5: Transcript extraction FAILED for ${videoId}:`,
      errorMsg
    );

    /*
     * Definitive cases:
     * Do NOT retry because a retry will not
     * make captions appear.
     */

    if (
      normalized.includes("disabled") ||
      normalized.includes("transcript is disabled") ||
      normalized.includes("captions are disabled") ||
      normalized.includes("subtitles are disabled")
    ) {
      throw new Error(
        "NO_PUBLIC_TRANSCRIPT"
      );
    }

    if (
      normalized.includes("no transcript") ||
      normalized.includes("not available") ||
      normalized.includes("unavailable") ||
      normalized.includes("could not retrieve transcript") ||
      normalized.includes("transcriptlist")
    ) {
      throw new Error(
        "NO_PUBLIC_TRANSCRIPT"
      );
    }

    if (
      normalized.includes("private") ||
      normalized.includes("video is private")
    ) {
      throw new Error(
        "PRIVATE_VIDEO"
      );
    }

    if (
      normalized.includes("video not found") ||
      normalized.includes("video unavailable") ||
      normalized.includes("removed")
    ) {
      throw new Error(
        "VIDEO_UNAVAILABLE"
      );
    }

    if (
      normalized.includes("captcha") ||
      normalized.includes("sign in") ||
      normalized.includes("login")
    ) {
      throw new Error(
        "YOUTUBE_ACCESS_RESTRICTED"
      );
    }

    /*
     * Preserve the explicit size error.
     */
    if (
      error instanceof Error &&
      error.message ===
        "TRANSCRIPT_TOO_LARGE"
    ) {
      throw error;
    }

    /*
     * Unknown transcript errors:
     * Return a safe public-facing category.
     */
    throw new Error(
      "NO_PUBLIC_TRANSCRIPT"
    );
  }
}

export async function downloadYouTubeAudio(
  videoId: string
): Promise<Buffer> {
  const audioStream = ytdl(
    `https://www.youtube.com/watch?v=${videoId}`,
    {
      filter: "audioonly",
      quality: "lowestaudio",
    }
  );

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  return new Promise(
    (resolve, reject) => {
      audioStream.on(
        "data",
        (chunk: Buffer) => {
          totalBytes += chunk.length;

          if (
            totalBytes >
            MAX_AUDIO_BYTES
          ) {
            audioStream.destroy(
              new Error(
                "YouTube audio is larger than the 24 MB limit."
              )
            );

            return;
          }

          chunks.push(chunk);
        }
      );

      audioStream.on(
        "end",
        () => {
          resolve(
            Buffer.concat(chunks)
          );
        }
      );

      audioStream.on(
        "error",
        reject
      );
    }
  );
}

export async function fetchYouTubeTitle(
  url: string
): Promise<string> {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        url
      )}&format=json`
    );

    if (response.ok) {
      const data =
        await response.json();

      if (
        typeof data.title ===
          "string" &&
        data.title.trim()
      ) {
        return data.title.trim();
      }
    }
  } catch {
    // Stable fallback if title metadata is unavailable.
  }

  return "YouTube Video";
}