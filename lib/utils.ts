import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  ARCHIVE_EXTENSIONS,
  SUBTITLE_EXTENSIONS,
  IMAGE_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
} from "./constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Determine file type from filename extension
export function getFileType(
  filename: string
): "video" | "audio" | "archive" | "subtitle" | "image" | "document" | "other" {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (ARCHIVE_EXTENSIONS.has(ext)) return "archive";
  if (SUBTITLE_EXTENSIONS.has(ext)) return "subtitle";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
  return "other";
}

// Get MIME type from filename
export function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const mimeMap: Record<string, string> = {
    // Video
    mp4: "video/mp4",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    mov: "video/quicktime",
    webm: "video/webm",
    ts: "video/mp2t",
    flv: "video/x-flv",
    wmv: "video/x-ms-wmv",
    m4v: "video/x-m4v",
    mpg: "video/mpeg",
    mpeg: "video/mpeg",
    m2ts: "video/mp2t",
    vob: "video/x-ms-vob",
    "3gp": "video/3gpp",
    ogv: "video/ogg",
    // Audio
    mp3: "audio/mpeg",
    flac: "audio/flac",
    aac: "audio/aac",
    ogg: "audio/ogg",
    wav: "audio/wav",
    wma: "audio/x-ms-wma",
    m4a: "audio/mp4",
    opus: "audio/opus",
    // Archives
    zip: "application/zip",
    rar: "application/x-rar-compressed",
    "7z": "application/x-7z-compressed",
    tar: "application/x-tar",
    gz: "application/gzip",
    // Subtitles
    srt: "text/plain",
    vtt: "text/vtt",
    ass: "text/plain",
    ssa: "text/plain",
    sub: "text/plain",
    // Images
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    // Documents
    pdf: "application/pdf",
    txt: "text/plain",
  };
  return mimeMap[ext] || "application/octet-stream";
}

// Format bytes to human-readable string
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

// Get file extension from filename
export function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() || "";
}

// Parse filename to extract title and year
// Matches patterns like: "Movie.Title.2019.1080p.BluRay.x264"
export function parseFilename(filename: string) {
  let title = filename;
  let year = "";

  // Remove extension
  title = title.replace(/\.[^/.]+$/, "");

  // Match Title and Year (e.g. Joker.2019.2160p...)
  // This regex looks for something ending with a year (19xx or 20xx)
  const match = title.match(/^(.*?)[. _-](\b(?:19|20)\d{2}\b)/);

  if (match) {
    title = match[1];
    year = match[2];
  } else {
    // If no year found, strip common release tags anyway
    title = title.replace(/(1080p|720p|2160p|4k|bluray|web-dl|hevc|x264|x265|remux).*/i, "");
  }

  // Replace dots and underscores with spaces
  title = title.replace(/[\._]/g, " ").trim();

  return { title, year };
}

// Build breadcrumbs from a path string
export function buildBreadcrumbs(
  path: string
): { name: string; path: string }[] {
  const segments = path.split("/").filter(Boolean);
  const breadcrumbs = [{ name: "Home", path: "/" }];

  let currentPath = "";
  for (const segment of segments) {
    currentPath += "/" + segment;
    breadcrumbs.push({
      name: decodeURIComponent(segment),
      path: currentPath,
    });
  }

  return breadcrumbs;
}

export interface SafeJsonResponse<T = Record<string, any>> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

/**
 * Normalizes error messages into clean, concise descriptions suitable for toasts.
 * Strips technical noise, HTML tags, and provides friendly summaries.
 */
export function cleanErrorMessage(msg: unknown): string {
  if (!msg) return "An unexpected error occurred";
  let str =
    typeof msg === "string"
      ? msg
      : (msg as { message?: string })?.message || String(msg);

  // Strip HTML tags
  str = str.replace(/<[^>]*>/g, "").trim();

  // Strip "Error: " prefixes
  str = str.replace(/^(Error:\s*)+/i, "");

  // Normalize specific Torbox and network errors
  if (/database_error/i.test(str)) {
    return "Torrent not found or removed on TorBox";
  }
  if (/json parse|unexpected token|syntaxerror/i.test(str)) {
    return "Invalid response from server";
  }
  if (/failed to fetch|network error|econnrefused/i.test(str)) {
    return "Network connection failed";
  }

  // Shorten if overly long (keep <= 120 chars for toast readability)
  if (str.length > 120) {
    str = str.slice(0, 117) + "...";
  }

  return str;
}

/**
 * Safely parses a fetch Response as JSON without ever throwing a SyntaxError.
 * Handles HTML error pages (e.g. Cloudflare / Nginx 502), empty bodies, and plain text.
 * Guarantees that neither .json() nor .text() exceptions break caller flows.
 */
export async function safeParseJson<T = Record<string, any>>(
  res: Response,
  fallbackMessage = "Request failed"
): Promise<SafeJsonResponse<T>> {
  const status = res.status;
  const contentType = res.headers.get("content-type") || "";

  let rawText = "";
  try {
    rawText = await res.text();
  } catch {
    return {
      ok: false,
      status,
      data: null,
      error: `${fallbackMessage} (${status})`,
    };
  }

  const trimmed = rawText.trim();

  // Handle empty body
  if (!trimmed) {
    return {
      ok: res.ok,
      status,
      data: null,
      error: res.ok ? null : `${fallbackMessage} (${status})`,
    };
  }

  // Try parsing JSON if content-type indicates JSON or if it looks like JSON
  if (contentType.includes("application/json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as T;
      if (!res.ok) {
        const parsedRecord = parsed as Record<string, unknown> | null;
        const details = parsedRecord?.details;
        const errorDetail =
          parsedRecord?.error ||
          parsedRecord?.detail ||
          parsedRecord?.message ||
          (Array.isArray(details) ? details.join("; ") : null) ||
          `${fallbackMessage} (${status})`;
        return { ok: false, status, data: parsed, error: cleanErrorMessage(String(errorDetail)) };
      }
      return { ok: true, status, data: parsed, error: null };
    } catch {
      // Body failed JSON.parse despite header/appearance
    }
  }

  // Handle non-JSON response (e.g. HTML error page or plain text)
  if (!res.ok) {
    const isHtml = contentType.includes("text/html") || trimmed.includes("<html") || trimmed.includes("<!DOCTYPE");
    let errorMsg = `${fallbackMessage} (${status})`;

    if (isHtml) {
      const titleMatch = trimmed.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch?.[1]?.trim()) {
        errorMsg = `${titleMatch[1].trim()} (${status})`;
      } else {
        errorMsg = `Server error (${status})`;
      }
    } else if (trimmed.length < 150) {
      errorMsg = trimmed;
    }

    return { ok: false, status, data: null, error: cleanErrorMessage(errorMsg) };
  }

  return { ok: true, status, data: null, error: null };
}

