/**
 * lib/parser.ts
 * Ported from torbox-organizer for DoMa Web.
 * Parses media filenames into Movie, TV, or Other metadata without filesystem or API dependencies.
 *
 * Hardening (see LIB_FIX_PLAN.md Phase 2):
 * - Bracket groups `(…)`/`[…]`/`{…}` are extracted first. A bare 4-digit year
 *   (e.g. "(2021)") is kept as a year hint; anything else (e.g. "[Cunnysseur]") is discarded.
 * - Blacklist tokens (quality/source/codec/audio/release-meta/release-groups) are stripped
 *   from the title before it is used as a TMDB query.
 * - Region markers (US/UK/…) are NOT stripped blindly — they are extracted into `region`
 *   and used as a ranking hint downstream, because "The Office US" and "The Office UK"
 *   are different shows.
 */

export const SEASON_EPISODE_RE = /S(\d{1,2})E(\d{1,3})((?:[-._]?E\d{1,3})*)/i;
export const EXTRA_EPISODE_RE = /E(\d{1,3})/gi;
export const X_FORMAT_RE = /(?<![A-Za-z0-9])(\d{1,2})x(\d{2,3})(?![A-Za-z0-9])/;
export const SEASON_ONLY_RE = /(?<![A-Za-z0-9])S(\d{1,2})(?!\d)(?!E)/i;
export const EPISODE_ONLY_RE = /(?<![A-Za-z0-9])E(\d{1,3})(?![A-Za-z0-9])/i;
export const YEAR_RE = /\b(19\d{2}|20\d{2})\b/g;

export interface ParsedMedia {
  mediaType: "movie" | "tv" | "other";
  title: string;
  year?: string;
  /** Region marker parsed from the filename (e.g. "us" for "The.Office.US.S02E01"). */
  region?: string;
  season?: number;
  episodes?: number[];
  extension: string;
  originalFilename: string;
}

/** Bare 4-digit year: "2021" — but not a quality tag like "1080p". */
const BARE_YEAR_RE = /^(19\d{2}|20\d{2})$/;
const BRACKET_RE = /[\(\[\{]([^\)\]\}]*)[\)\]\}]/g;

/** Region markers that appear at the end of show titles (kept as hints, not stripped blindly). */
const REGION_TOKENS = new Set([
  "us", "uk", "au", "nz", "ca", "fr", "de", "jp", "kr", "es", "it", "br", "se", "nl", "mx", "in",
]);

/** Multi-word release phrases to collapse before token-level blacklisting. */
const BLACKLIST_PHRASES: RegExp[] = [
  /directors?[\s._-]*cut/gi,
  /dual[\s._-]*audio/gi,
  /extended[\s._-]*cut/gi,
  /remastered[\s._-]*(edition|cut)?/gi,
  /dolby[\s._-]*(vision|atmos)/gi,
  /dts[\s._-]*hd[\s._-]*ma/gi,
  /dts[\s._-]*hd/gi,
  /ddp?[\s._-]*5\.1/gi,
  /ddp?[\s._-]*7\.1/gi,
  // Codec spellings with separators: "H.264", "x-265", "h 264" (bare h264/x265 are token-blacklisted)
  /\b[hx][\s._-]*26[45]\b/gi,
  /\bavc\b|\bav1\b|\bhevc\b/gi,
];

/** Single tokens that must never reach a TMDB query. Matched case-insensitively. */
const BLACKLIST_TOKENS = new Set([
  // Quality / resolution
  "2160p", "1080p", "1080i", "720p", "576p", "480p", "360p", "4k", "uhd", "sdr", "hd",
  // Source
  "bluray", "blu", "ray", "bd", "brrip", "bdrip", "web", "webdl", "webrip", "webdlrip", "hdrip",
  "dvdrip", "dvd", "hdtv", "pdvd", "remux", "bdremux", "rip",
  // Codec / dynamic range
  "hevc", "h264", "h265", "x264", "x265", "avc", "av1", "10bit", "8bit", "hi10p", "hi10",
  "dv", "hdr", "hdr10", "hdr10plus", "dolby", "vision", "atmos",
  // Audio
  "truehd", "ddp", "dd", "ddplus", "ac3", "eac3", "aac", "flac", "dts", "ma", "lpcm",
  "5.1", "7.1", "2.0", "1.0", "2ch", "6ch", "8ch", "dual", "audio",
  // Release meta
  "repack", "proper", "extended", "remastered", "uncut", "complete", "final", "internal",
  "fixed", "hybrid", "upscale", "upscaled", "multi", "subs", "subbed", "dubbed", "dub",
  "fanres", "sample", "proof", "obfuscated", "rarbg", "nogrp", "shento", "framestor",
  "decibel", "spacehd13", "chg", "eliit", "beyondhd", "tbn", "ryuuga", "subsplease",
  "horriblesubs", "erai", "judas", "ember", "coalgirls", "commie", "cunnysseur", "kuchikirukia",
  // Misc noise (note: single letters like 'x' or 'h' must NOT be blacklisted here,
  // as they break titles like 'Malcolm X', 'Fast X', 'X-Men', etc.)
  "hevcv",
]);

function isBlacklistedToken(token: string): boolean {
  const t = token.toLowerCase().replace(/^[^a-z0-9.]+|[^a-z0-9.+]+$/gi, "");
  if (!t) return true;
  if (BLACKLIST_TOKENS.has(t)) return true;
  // Any resolution-style token (e.g. 1440p) and common audio channel patterns
  if (/^\d{3,4}p$/.test(t)) return true;
  if (/^[2-8]\.\d$/.test(t)) return true;
  // Version tag: v2, v3, v4, etc.
  if (/^v\d+$/i.test(t)) return true;
  // Release-group style trailing token (e.g. "-RARBG")
  if (/^[a-z0-9]{2,}$/i.test(t) && /^(yify|esub|hdts|tc|cam|scr)$/.test(t)) return true;
  return false;
}

/**
 * Extract bracket groups from a filename base.
 * - A group whose content is a bare 4-digit year (19xx/20xx, not a quality tag) is
 *   returned as `bracketYear` and its character index in `cleaned` as `bracketYearIndex`.
 * - All other groups ("[Cunnysseur]", "(V2)", "(CAM)", "[Multi-Subs]", …) are discarded.
 */
export function extractBrackets(base: string): {
  cleaned: string;
  bracketYear?: string;
  bracketYearIndex?: number;
} {
  let bracketYear: string | undefined;
  let bracketYearIndex: number | undefined;

  let cleaned = "";
  let lastIndex = 0;
  BRACKET_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = BRACKET_RE.exec(base)) !== null) {
    cleaned += base.slice(lastIndex, match.index);
    const inner = match[1].trim();
    if (BARE_YEAR_RE.test(inner) && !/\d+p/i.test(inner)) {
      bracketYear = inner;
      bracketYearIndex = cleaned.length;
    }
    cleaned += " ";
    lastIndex = match.index + match[0].length;
  }
  cleaned += base.slice(lastIndex);

  return { cleaned, bracketYear, bracketYearIndex };
}

/** Split a title slice into tokens, dropping blacklisted ones. */
function stripBlacklistedTokens(raw: string): string[] {
  // Collapse known multi-word phrases first
  let cleaned = raw;
  for (const phraseRe of BLACKLIST_PHRASES) {
    phraseRe.lastIndex = 0;
    cleaned = cleaned.replace(phraseRe, " ");
  }

  const tokens = cleaned.split(/[\s._\-]+/).filter(Boolean);
  const kept: string[] = [];
  for (const token of tokens) {
    if (!isBlacklistedToken(token)) kept.push(token);
  }
  return kept;
}

/**
 * Pull a trailing region marker ("The Office US" → region "us") out of the token list.
 * Only strips when at least one title token remains afterwards, so a movie actually
 * named "Us" is untouched.
 */
function extractRegion(tokens: string[]): { tokens: string[]; region?: string } {
  if (tokens.length <= 1) return { tokens };
  const last = tokens[tokens.length - 1].toLowerCase();
  if (REGION_TOKENS.has(last)) {
    return { tokens: tokens.slice(0, -1), region: last };
  }
  return { tokens };
}

function joinTokens(tokens: string[]): string {
  return tokens.join(" ").replace(/\s+/g, " ").trim();
}

export function cleanTitle(raw: string): string {
  // Strip common release tags if present before cleaning
  let cleaned = raw
    .replace(/(1080p|720p|2160p|4k|bluray|bdrip|brrip|web-dl|webrip|hevc|x264|x265|remux|bdremux|h264|h265|hdr|ddp5\.1|aac|hi10p?).*/i, "")
    .replace(/\bv\d+\b/gi, "")
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-]+|[\s\-]+$/g, "")
    .trim();

  return cleaned;
}

interface Detection {
  season: number;
  episodes: number[];
  matchIndex: number;
}

/**
 * Episode markers in word form: "Episode 3", "Ep 3", "Ep.03", "E 4".
 * (SxxEyy numeric form is handled separately — this is for spelled-out releases
 * like "Rome (2005) Season 1 Episode 01".)
 */
const WORD_EPISODE_RE = /(?:^|[\s._-])(?:E(?:pisode|p)?)[\s._-]*(\d{1,3})(?!\d)/gi;
/** Continuation of an episode list: "Episode 03-04", "Episode 03 E04", "Episode 03x04". */
const WORD_EPISODE_TAIL_RE = /[-._\s]*?(?:[-._]|\bE\b|x)[\s._-]*(\d{1,3})(?!\d)/gi;

/**
 * Scan a string for word-form episode numbers ("Episode 3", "Ep 5", "E 4"),
 * including list continuations ("Episode 03-04" → [3, 4], "Episode 1 Episode 2" → [1, 2]).
 * Returns the numbers in order, or null when none are present.
 */
function scanWordEpisodes(text: string): number[] | null {
  WORD_EPISODE_RE.lastIndex = 0;
  const episodes: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = WORD_EPISODE_RE.exec(text)) !== null) {
    episodes.push(parseInt(m[1], 10));
    // Collect contiguous list continuations right after this number
    // ("Episode 03-04", "Episode 03 E04", "Episode 03x04"), but stop at the next
    // "Episode" word itself (it starts a new scanWordEpisodes match naturally).
    const rest = text.slice(m.index + m[0].length);
    WORD_EPISODE_TAIL_RE.lastIndex = 0;
    let t: RegExpExecArray | null;
    while ((t = WORD_EPISODE_TAIL_RE.exec(rest)) !== null) {
      // Only accept tails that immediately follow (no other words in between)
      const between = rest.slice(0, t.index);
      if (/^[-._\s]*$/.test(between) || /^[-._\s]*E[-._\s]*$/i.test(between) || /^[-._\s]*x[-._\s]*$/i.test(between)) {
        episodes.push(parseInt(t[1], 10));
      } else {
        break;
      }
    }
  }
  return episodes.length > 0 ? episodes : null;
}

/**
 * Season marker in word form: "Season 1", "S1", "Season.03".
 */
const WORD_SEASON_RE = /(?:^|[\s._-])(?:Season|S)[\s._-]*(\d{1,2})(?!\d)/i;

/**
 * Ordinal season marker: "1st Season", "2nd Season", "3rd Season", "4th Season", "2nd Series".
 */
const ORDINAL_SEASON_RE = /(?:^|[\s._-])(\d{1,2})(?:st|nd|rd|th)[\s._-]+(?:Season|Series)\b/i;

/**
 * Anime-style standalone episode marker: " - 01", " - 01v2", " - 108", " - 05-06".
 * Must not be a 4-digit release year (1900..2099) and must not be followed by letters (e.g. 1080p).
 */
const DASH_EPISODE_RE = /(?:^|[\s._])-\s*(\d{1,4})(?:v\d+)?(?:\s*[-~]\s*(\d{1,4})(?:v\d+)?)?(?![a-zA-Z\d])/;

function scanDashEpisodes(text: string): number[] | null {
  const m = DASH_EPISODE_RE.exec(text);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  if (num >= 1900 && num <= 2099) return null; // Year, not an episode
  const eps = [num];
  if (m[2]) {
    const endNum = parseInt(m[2], 10);
    if (!(endNum >= 1900 && endNum <= 2099)) {
      eps.push(endNum);
    }
  }
  return eps;
}

/**
 * Word-form detection for spelled-out releases:
 *   "Rome (2005) Season 1 Episode 01", "Show.Season.03.Episode.6",
 *   "Show Episode 4 Season 2", "Rome Season 1" (season pack).
 * Truncated title = text before the FIRST marker found.
 */
function detectWordFormSeasonEpisode(base: string): Detection | null {
  const ordMatch = ORDINAL_SEASON_RE.exec(base);
  const wordSeasonMatch = WORD_SEASON_RE.exec(base);
  const seasonMatch =
    ordMatch && (!wordSeasonMatch || ordMatch.index <= wordSeasonMatch.index)
      ? ordMatch
      : wordSeasonMatch;
  WORD_EPISODE_RE.lastIndex = 0;
  const episodeMatch = WORD_EPISODE_RE.exec(base);

  if (seasonMatch) {
    const season = parseInt(seasonMatch[1], 10);
    const afterSeason = base.slice(seasonMatch.index + seasonMatch[0].length);
    // Episodes normally follow the season ("Season 1 Episode 01", "Season 3 - 01");
    // when none do, check for a leading episode marker ("Show Episode 4 Season 2").
    const episodes =
      scanWordEpisodes(afterSeason) ??
      scanDashEpisodes(afterSeason) ??
      scanWordEpisodes(base.slice(0, seasonMatch.index)) ??
      [];
    const matchIndex =
      episodeMatch && episodeMatch.index < seasonMatch.index
        ? episodeMatch.index
        : seasonMatch.index;
    return { season, episodes, matchIndex };
  }

  if (episodeMatch) {
    // Reversed order: "Show Episode 4 Season 2" — episode marker first.
    const afterEpisode = base.slice(episodeMatch.index + episodeMatch[0].length);
    const seasonAfter = WORD_SEASON_RE.exec(afterEpisode);
    if (seasonAfter) {
      const season = parseInt(seasonAfter[1], 10);
      const afterSeason = afterEpisode.slice(seasonAfter.index + seasonAfter[0].length);
      // Keep scanning: "Episode 4 Season 2 Episode 5" style tails still count.
      const extra = scanWordEpisodes(afterSeason) ?? [];
      return {
        season,
        episodes: [parseInt(episodeMatch[1], 10), ...extra],
        matchIndex: episodeMatch.index,
      };
    }
    // Episode-only word form ("Show Episode 4.mkv") → assume season 1,
    // mirroring the numeric EPISODE_ONLY_RE behavior.
    return {
      season: 1,
      episodes: [parseInt(episodeMatch[1], 10)],
      matchIndex: episodeMatch.index,
    };
  }

  return null;
}

function detectSeasonEpisode(base: string): Detection | null {
  // Word form first: "Season 1 Episode 01", "Episode 4 Season 2", "Rome Season 1"
  const wordForm = detectWordFormSeasonEpisode(base);
  if (wordForm) return wordForm;

  // S01E01, S01E01E02, S01E01-E02
  const seMatch = SEASON_EPISODE_RE.exec(base);
  if (seMatch) {
    const season = parseInt(seMatch[1], 10);
    const episodes = [parseInt(seMatch[2], 10)];
    const tail = seMatch[3] ?? "";

    EXTRA_EPISODE_RE.lastIndex = 0;
    let extra: RegExpExecArray | null;
    while ((extra = EXTRA_EPISODE_RE.exec(tail)) !== null) {
      episodes.push(parseInt(extra[1], 10));
    }

    return { season, episodes, matchIndex: seMatch.index };
  }

  // 1x01 / 01x01
  const xMatch = X_FORMAT_RE.exec(base);
  if (xMatch) {
    return {
      season: parseInt(xMatch[1], 10),
      episodes: [parseInt(xMatch[2], 10)],
      matchIndex: xMatch.index,
    };
  }

  // Season-only pack or season followed by dash episode: e.g. "Show.S02.Complete" or "Show S2 - 01"
  const sMatch = SEASON_ONLY_RE.exec(base);
  if (sMatch) {
    const season = parseInt(sMatch[1], 10);
    const afterS = base.slice(sMatch.index + sMatch[0].length);
    const dashEps = scanDashEpisodes(afterS);
    return {
      season,
      episodes: dashEps ?? [],
      matchIndex: sMatch.index,
    };
  }

  // Episode-only marker, e.g. "Show.E01.mkv" or "The.Blue.Planet.E01.The.Blue.Planet.1080p.BluRay.Remux.mkv"
  // Assumes season 1 when only an episode number is present without a season prefix.
  const epMatch = EPISODE_ONLY_RE.exec(base);
  if (epMatch) {
    return {
      season: 1,
      episodes: [parseInt(epMatch[1], 10)],
      matchIndex: epMatch.index,
    };
  }

  // Standalone anime-style dash episode marker, e.g. "Sousou no Frieren - 01", "One Piece - 1085"
  const dashMatch = DASH_EPISODE_RE.exec(base);
  if (dashMatch && dashMatch.index > 0) {
    const num = parseInt(dashMatch[1], 10);
    if (!(num >= 1900 && num <= 2099)) {
      const episodes = [num];
      if (dashMatch[2]) {
        const endNum = parseInt(dashMatch[2], 10);
        if (!(endNum >= 1900 && endNum <= 2099)) {
          episodes.push(endNum);
        }
      }
      return {
        season: 1,
        episodes,
        matchIndex: dashMatch.index,
      };
    }
  }

  return null;
}

export function parseMediaFilename(filename: string): ParsedMedia {
  const lastDot = filename.lastIndexOf(".");
  const extension = lastDot !== -1 ? filename.slice(lastDot + 1).toLowerCase() : "";
  const base = lastDot !== -1 ? filename.slice(0, lastDot) : filename;

  // 1. Extract bracket groups: "(2021)" kept as year hint, "[Cunnysseur]" discarded.
  const { cleaned: baseNoBrackets, bracketYear, bracketYearIndex } = extractBrackets(base);

  // 2. TV detection runs on the bracket-cleaned base.
  const detection = detectSeasonEpisode(baseNoBrackets);

  if (detection) {
    const rawTitle = baseNoBrackets.slice(0, detection.matchIndex);
    const keptTokens = stripBlacklistedTokens(rawTitle);
    const { tokens, region } = extractRegion(keptTokens);
    const title = joinTokens(tokens) || cleanTitle(rawTitle) || "Unknown Show";

    return {
      mediaType: "tv",
      title,
      // TV releases often carry the (first-air) year in brackets: "Rome (2005) Season 1 ..."
      ...(bracketYear ? { year: bracketYear } : {}),
      ...(region ? { region } : {}),
      season: detection.season,
      episodes: detection.episodes,
      extension,
      originalFilename: filename,
    };
  }

  // 3. Movie path: find year markers on the bracket-cleaned base.
  let yearMatches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  YEAR_RE.lastIndex = 0;
  while ((match = YEAR_RE.exec(baseNoBrackets)) !== null) {
    yearMatches.push(match);
  }

  // Filter out year matches at the very beginning of the string (index 0)
  // to avoid truncating titles that start with a year (e.g. 2001 A Space Odyssey)
  yearMatches = yearMatches.filter((m) => m.index > 0);

  // Take the LAST year match found before extension/quality tags.
  // Compare bare year vs bracket year: release years canonically follow the title,
  // so take whichever year appeared latest in the filename.
  const lastBareYear = yearMatches.length > 0 ? yearMatches[yearMatches.length - 1] : null;
  const hasBracketYear = bracketYear && bracketYearIndex !== undefined && bracketYearIndex > 0;

  let year: string | undefined;
  let titleCutIndex: number | undefined;

  if (lastBareYear && hasBracketYear) {
    if (lastBareYear.index > bracketYearIndex) {
      year = lastBareYear[1];
      titleCutIndex = lastBareYear.index;
    } else {
      year = bracketYear;
      titleCutIndex = bracketYearIndex;
    }
  } else if (lastBareYear) {
    year = lastBareYear[1];
    titleCutIndex = lastBareYear.index;
  } else if (hasBracketYear) {
    year = bracketYear;
    titleCutIndex = bracketYearIndex;
  }

  const titleSource = titleCutIndex !== undefined ? baseNoBrackets.slice(0, titleCutIndex) : baseNoBrackets;
  const keptTokens = stripBlacklistedTokens(titleSource);
  const { tokens, region } = extractRegion(keptTokens);
  const title = joinTokens(tokens) || cleanTitle(titleSource) || "Unknown Media";

  return {
    mediaType: year ? "movie" : "other",
    title,
    year,
    ...(region ? { region } : {}),
    extension,
    originalFilename: filename,
  };
}
