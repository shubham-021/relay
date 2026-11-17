/**
 * lib/tmdb.ts
 * TMDB search + result ranking (LIB_FIX_PLAN.md Phase 3).
 *
 * Why this exists:
 * - The old sync code took `results[0]` from TMDB relevance ordering, which matched
 *   "Enemy.2013" to "Enemy Empire" (TMDB id 344656) instead of "Enemy" (id 522815/181886).
 * - TMDB requests were never retried and `res.ok` was never checked, so transient failures
 *   silently demoted files to media_type "other" (items "disappeared" from the library).
 *
 * Guarantees:
 * - HTTP 429/5xx and network errors are retried with backoff (Retry-After honored).
 * - Results are ranked: exact normalized title match wins, then scored fuzzy match with a
 *   strict threshold. A year from the filename is a strong signal ("Enemy Empire" passed the
 *   old year *filter* because of its 2013-12-27 release date — we now score the candidate's
 *   actual release year instead of trusting the filter).
 * - Distinguishes { match } / { no-match } / { error } so callers never demote known-type
 *   files to "other" because of an API hiccup.
 */

export interface TmdbMatch {
  id: number;
  title: string;
  originalTitle?: string;
  alternativeTitles?: string[];
  year: string;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  mediaType: "movie" | "tv";
  popularity: number;
  originCountry?: string[];
}

export type TmdbSearchOutcome =
  | { status: "match"; result: TmdbMatch }
  | { status: "no-match" }
  | { status: "error" };

// The key is read lazily in tmdbGet (NOT captured at module scope): Next.js inlines
// process.env at build time for module-level constants, so a module-scope capture can
// end up undefined depending on when the module is evaluated.
function tmdbApiKey(): string | undefined {
  return process.env.TMDB_API_KEY;
}

// ── HTTP layer ──────────────────────────────────────────────────────────────────

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

/**
 * GET a TMDB endpoint. Retries 429/5xx and network errors (3 attempts total).
 * Throws on abort and on exhausted retries; returns null for definitive 4xx failures
 * (invalid key, bad request) so callers can treat it as an API-level error.
 */
async function tmdbGet(
  path: string,
  params: Record<string, string | undefined>,
  signal?: AbortSignal
): Promise<any | null> {
  const apiKey = tmdbApiKey();
  if (!apiKey) return null;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

      const url = new URL(`https://api.themoviedb.org/3/${path}`);
      url.searchParams.set("api_key", apiKey);
      for (const [key, value] of Object.entries(params)) {
        if (value) url.searchParams.set(key, value);
      }

      const res = await fetch(url, { signal });

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number.parseFloat(res.headers.get("retry-after") || "") || 1 + attempt;
        await sleep(retryAfter * 1000, signal);
        continue;
      }

      if (!res.ok) {
        // 4xx: definitive failure (bad key, bad params) — no point retrying.
        return null;
      }

      return await res.json();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      lastError = e;
      await sleep(500 * (attempt + 1), signal);
    }
  }
  throw lastError ?? new Error(`TMDB request failed: ${path}`);
}

// ── Title normalization + scoring ───────────────────────────────────────────────

export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(the|a|an)\s+/, "")
    .trim();
}

function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (!len1 || !len2) return 0;

  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
  const s1Matched = new Array<boolean>(len1).fill(false);
  const s2Matched = new Array<boolean>(len2).fill(false);
  let matches = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow, len2 - 1);
    for (let j = start; j <= end; j++) {
      if (s2Matched[j] || s1[i] !== s2[j]) continue;
      s1Matched[i] = true;
      s2Matched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matched[i]) continue;
    while (!s2Matched[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  const jaro =
    (matches / len1 + matches / len2 + (matches - transpositions) / matches) / 3;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, len1, len2); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Title similarity: Jaro-Winkler penalized by length ratio, so a short parsed title
 * ("enemy") does not score high against a long superset title ("enemy empire").
 * An exact normalized match scores 1.
 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
  return jaroWinkler(na, nb) * Math.pow(ratio, 0.5);
}

/**
 * Generate title variants:
 * 1. Full title
 * 2. Movie format suffix stripped (e.g. ": The Movie", " - The Movie", " The Movie", "(The Movie)")
 * 3. Parenthesized tags stripped (e.g. "(US)", "(2020)")
 * 4. Subtitles stripped (portions before ":", ";", or spaced dashes " - ", " – ", " — ")
 * 5. Hyphenated/bracketed subtitles stripped (e.g. "Demon Slayer -Kimetsu no Yaiba- The Movie")
 */
export function getTitleVariants(title: string): string[] {
  const variants = new Set<string>();
  if (!title) return [];
  variants.add(title);

  // Strip ": The Movie", " - The Movie", " The Movie", " (The Movie)", etc.
  const noMovie = title.replace(/[:\s–—-]+(?:the\s+)?movie\b/gi, "").trim();
  if (noMovie && noMovie !== title) variants.add(noMovie);

  // Strip parenthesized tags like (US), (UK), (TV), (2020)
  const noParens = title.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  if (noParens && noParens !== title) variants.add(noParens);

  // Strip subtitle after colon, semicolon, or spaced dash
  const parts = title.split(/\s*[:;]\s*|\s+[-–—]\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    variants.add(parts[0]);
    let cumulative = parts[0];
    for (let i = 1; i < parts.length - 1; i++) {
      cumulative += " " + parts[i];
      variants.add(cumulative);
    }
  }

  // Strip hyphenated/bracketed subtitles (e.g. "Demon Slayer -Kimetsu no Yaiba- The Movie" -> "Demon Slayer The Movie")
  const noEnclosed = title.replace(/\s*[-~][^-~]+[-~]\s*/g, " ").replace(/\s+/g, " ").trim();
  if (noEnclosed && noEnclosed !== title) {
    variants.add(noEnclosed);
    const noEnclosedNoMovie = noEnclosed.replace(/[:\s–—-]+(?:the\s+)?movie\b/gi, "").trim();
    if (noEnclosedNoMovie && noEnclosedNoMovie !== noEnclosed) variants.add(noEnclosedNoMovie);
  }

  return [...variants];
}

/**
 * Check if a parsed title matches a candidate/stored title, allowing for base title
 * variants, ": The Movie" suffixes, and subtitle delimiters.
 */
export function isTitleMatch(
  parsedTitle: string,
  candidateTitle: string,
  alternativeTitles?: string[]
): boolean {
  if (!parsedTitle || !candidateTitle) return false;
  const pNorm = normalizeTitle(parsedTitle);
  const cNorm = normalizeTitle(candidateTitle);
  if (pNorm === cNorm) return true;

  if (alternativeTitles && alternativeTitles.length > 0) {
    for (const alt of alternativeTitles) {
      if (normalizeTitle(alt) === pNorm) return true;
    }
  }

  const pVariants = getTitleVariants(parsedTitle).map(normalizeTitle);
  const cVariants = getTitleVariants(candidateTitle).map(normalizeTitle);

  for (const cv of cVariants) {
    if (cv === pNorm || pVariants.includes(cv)) return true;
  }
  for (const pv of pVariants) {
    if (pv === cNorm || cVariants.includes(pv)) return true;
  }

  if (alternativeTitles && alternativeTitles.length > 0) {
    for (const alt of alternativeTitles) {
      for (const v of getTitleVariants(alt).map(normalizeTitle)) {
        if (v === pNorm || pVariants.includes(v)) return true;
      }
    }
  }

  return titleSimilarity(parsedTitle, candidateTitle) >= 0.9;
}

export type TitleMatchQuality = "FULL_EXACT" | "ALT_EXACT" | "MOVIE_SUFFIX" | "BASE_EXACT" | "FUZZY";

export function matchTitleQuality(
  parsedTitle: string,
  cand: TmdbMatch
): { quality: TitleMatchQuality; sim: number } {
  const parsedNorm = normalizeTitle(parsedTitle);
  const parsedVariants = getTitleVariants(parsedTitle).map(normalizeTitle);

  const candTitles = [cand.title];
  if (cand.originalTitle && cand.originalTitle !== cand.title) {
    candTitles.push(cand.originalTitle);
  }

  // 1. Full exact match on title or originalTitle
  for (const ct of candTitles) {
    if (normalizeTitle(ct) === parsedNorm) {
      return { quality: "FULL_EXACT", sim: 1.0 };
    }
  }

  // 2. Alternative titles exact match (e.g. Romaji/aliases: "Bakemono no Ko" -> "The Boy and the Beast")
  if (cand.alternativeTitles && cand.alternativeTitles.length > 0) {
    for (const alt of cand.alternativeTitles) {
      const altNorm = normalizeTitle(alt);
      if (altNorm === parsedNorm) {
        return { quality: "ALT_EXACT", sim: 1.0 };
      }
      for (const v of getTitleVariants(alt).map(normalizeTitle)) {
        if (v === parsedNorm || parsedVariants.includes(v)) {
          return { quality: "ALT_EXACT", sim: 0.98 };
        }
      }
    }
  }

  // 3. Movie format suffix stripped match (e.g. "A Silent Voice: The Movie" -> "A Silent Voice")
  for (const ct of candTitles) {
    const noMovie = ct.replace(/[:\s–—-]+(?:the\s+)?movie\b/gi, "").trim();
    if (noMovie && noMovie !== ct && normalizeTitle(noMovie) === parsedNorm) {
      return { quality: "MOVIE_SUFFIX", sim: 0.98 };
    }
  }

  // 4. Base title / subtitle variant match (e.g. "Kubikiri Cycle - Aoiro Savant..." -> "Kubikiri Cycle")
  for (const ct of candTitles) {
    const variants = getTitleVariants(ct).map(normalizeTitle);
    for (const v of variants) {
      if (v === parsedNorm || parsedVariants.includes(v)) {
        return { quality: "BASE_EXACT", sim: 0.95 };
      }
    }
  }

  // 5. Fuzzy fallback using titleSimilarity across titles and variants
  let maxSim = 0;
  for (const ct of candTitles) {
    const sim = titleSimilarity(parsedTitle, ct);
    if (sim > maxSim) maxSim = sim;
    for (const v of getTitleVariants(ct)) {
      const vSim = titleSimilarity(parsedTitle, v);
      if (vSim > maxSim) maxSim = vSim;
    }
  }

  return { quality: "FUZZY", sim: maxSim };
}

const FUZZY_TITLE_FLOOR = 0.6;
const ACCEPT_THRESHOLD = 0.8;

/** Filename region tokens → TMDB origin_country codes ("uk" is "GB" on TMDB). */
const REGION_CODES: Record<string, string[]> = {
  UK: ["UK", "GB"],
};

function regionMatches(region: string | undefined, cand: TmdbMatch): boolean {
  if (!region) return false;
  const codes = REGION_CODES[region.toUpperCase()] ?? [region.toUpperCase()];
  return codes.some((c) => cand.originCountry?.includes(c));
}

interface ScoreOptions {
  title: string;
  year?: string;
  region?: string;
  mediaType: "movie" | "tv";
}

function scoreCandidate(
  cand: TmdbMatch,
  opts: ScoreOptions
): { score: number; quality: TitleMatchQuality; sim: number } {
  const { quality, sim } = matchTitleQuality(opts.title, cand);
  if (sim < FUZZY_TITLE_FLOOR) return { score: 0, quality, sim };

  const regionBonus = regionMatches(opts.region, cand) ? 0.1 : 0;

  // When year was NOT provided in query:
  // Title similarity is the primary measure; do not penalize TV shows / media with unknown year!
  if (!opts.year) {
    const score = Math.min(1.0, sim + regionBonus);
    return { score, quality, sim };
  }

  // When year WAS provided in query:
  let yearScore = 0.5; // neutral when candidate year is unknown
  if (cand.year) {
    const diff = Math.abs(Number(cand.year) - Number(opts.year));
    if (diff === 0) {
      yearScore = 1.0;
    } else if (diff === 1) {
      yearScore = 0.5;
    } else {
      yearScore = 0.0;
    }
  }

  const score = sim * 0.7 + yearScore * 0.3 + regionBonus;
  return { score, quality, sim };
}

/**
 * Pick the best candidate from the pool.
 * Evaluates candidates based on title match quality (full exact, movie format suffix,
 * base title/subtitle variants, or fuzzy), year proximity, region, and popularity.
 */
export function pickBestCandidate(
  candidates: TmdbMatch[],
  opts: ScoreOptions
): TmdbMatch | null {
  if (candidates.length === 0) return null;

  const scored = candidates
    .map((cand) => ({ cand, ...scoreCandidate(cand, opts) }))
    .filter((item) => item.score >= ACCEPT_THRESHOLD);

  if (scored.length === 0) return null;

  scored.sort((a, b) => {
    // 1. If opts.year is specified, exact year matches with valid title matches outrank wrong-year candidates
    if (opts.year && a.cand.year && b.cand.year) {
      const aYearExact = a.cand.year === opts.year;
      const bYearExact = b.cand.year === opts.year;
      if (aYearExact !== bYearExact) {
        const aIsTitleMatch = a.quality === "FULL_EXACT" || a.quality === "ALT_EXACT" || a.quality === "MOVIE_SUFFIX" || a.quality === "BASE_EXACT";
        const bIsTitleMatch = b.quality === "FULL_EXACT" || b.quality === "ALT_EXACT" || b.quality === "MOVIE_SUFFIX" || b.quality === "BASE_EXACT";
        if (aYearExact && aIsTitleMatch) return -1;
        if (bYearExact && bIsTitleMatch) return 1;
      }
    }

    // 2. Score difference (if significant)
    if (Math.abs(b.score - a.score) >= 0.03) {
      return b.score - a.score;
    }

    // 3. Year proximity
    if (opts.year && a.cand.year && b.cand.year) {
      const diffA = Math.abs(Number(a.cand.year) - Number(opts.year));
      const diffB = Math.abs(Number(b.cand.year) - Number(opts.year));
      if (diffA !== diffB) return diffA - diffB;
    }

    // 4. Region match bonus
    const regA = regionMatches(opts.region, a.cand) ? 1 : 0;
    const regB = regionMatches(opts.region, b.cand) ? 1 : 0;
    if (regA !== regB) return regB - regA;

    // 5. Popularity tie-break
    return (b.cand.popularity ?? 0) - (a.cand.popularity ?? 0);
  });

  return scored[0]?.cand ?? null;
}

// ── Search ──────────────────────────────────────────────────────────────────────

interface RawSearchItem {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  popularity?: number;
  origin_country?: string[];
}

function toMatch(item: RawSearchItem, mediaType: "movie" | "tv"): TmdbMatch | null {
  const title = item.title || item.name;
  const originalTitle = item.original_title || item.original_name;
  const date = item.release_date || item.first_air_date || "";
  if (!title || item.id == null) return null;
  return {
    id: item.id,
    title,
    ...(originalTitle && originalTitle !== title ? { originalTitle } : {}),
    year: date ? date.slice(0, 4) : "",
    overview: item.overview ?? null,
    posterPath: item.poster_path ?? null,
    backdropPath: item.backdrop_path ?? null,
    mediaType,
    popularity: item.popularity ?? 0,
    originCountry: item.origin_country,
  };
}

/**
 * Run a search and merge candidates from the year-filtered and unfiltered queries.
 * The old cascade ("first non-empty wins") let a mediocre year-filtered match beat a
 * perfect unfiltered one; merging the pool and scoring once fixes that.
 */
async function collectCandidates(
  path: "search/movie" | "search/tv",
  query: string,
  year: string | undefined,
  yearParam: "primary_release_year" | "first_air_date_year",
  signal?: AbortSignal
): Promise<TmdbMatch[] | null> {
  const mediaType = path === "search/movie" ? "movie" : "tv";

  if (year) {
    const [filtered, unfiltered] = await Promise.all([
      tmdbGet(path, { query, [yearParam]: year, include_adult: "false" }, signal),
      tmdbGet(path, { query, include_adult: "false" }, signal),
    ]);
    if (filtered === null && unfiltered === null) return null; // API-level failure (4xx/no key)

    const byId = new Map<number, TmdbMatch>();
    for (const item of [...(filtered?.results ?? []), ...(unfiltered?.results ?? [])]) {
      const match = toMatch(item, mediaType);
      if (!match) continue;
      const existing = byId.get(match.id);
      // Prefer the copy whose release year matches the requested year
      if (!existing || (year && match.year === year && existing.year !== year)) {
        byId.set(match.id, match);
      }
    }
    return [...byId.values()];
  }

  const data = await tmdbGet(path, { query, include_adult: "false" }, signal);
  if (data === null) return null;
  return (data.results ?? [])
    .map((item: RawSearchItem) => toMatch(item, mediaType))
    .filter((m: TmdbMatch | null): m is TmdbMatch => m !== null);
}

const altTitlesCache = new Map<string, string[]>();

export async function fetchAlternativeTitles(
  id: number,
  mediaType: "movie" | "tv",
  signal?: AbortSignal
): Promise<string[]> {
  const cacheKey = `${mediaType}-${id}`;
  const cached = altTitlesCache.get(cacheKey);
  if (cached) return cached;

  const path = mediaType === "movie" ? `movie/${id}/alternative_titles` : `tv/${id}/alternative_titles`;
  const data = await tmdbGet(path, {}, signal);
  if (!data) return [];
  const list = data.titles || data.results || [];
  const titles = list.map((t: any) => t.title).filter(Boolean) as string[];
  altTitlesCache.set(cacheKey, titles);
  return titles;
}

export function getCachedAlternativeTitles(id: number, mediaType: "movie" | "tv"): string[] | undefined {
  return altTitlesCache.get(`${mediaType}-${id}`);
}

async function searchTmdb(
  path: "search/movie" | "search/tv",
  query: string,
  year: string | undefined,
  yearParam: "primary_release_year" | "first_air_date_year",
  region: string | undefined,
  opts: ScoreOptions,
  signal?: AbortSignal
): Promise<TmdbSearchOutcome> {
  try {
    const candidates = await collectCandidates(path, query, year, yearParam, signal);
    if (candidates === null) return { status: "error" };

    let best = pickBestCandidate(candidates, opts);
    if (best) return { status: "match", result: best };

    // Alternative titles check:
    // When candidates were returned by TMDB's search engine (which matches against aliases,
    // foreign titles, and romaji), but the primary title differs from the search query
    // (e.g. "Bakemono no Ko" -> "The Boy and the Beast", "Shingeki no Kyojin" -> "Attack on Titan"):
    if (candidates.length > 0) {
      const candidatesToCheck = [...candidates]
        .sort((a, b) => {
          const aYear = year && a.year === year ? 1 : 0;
          const bYear = year && b.year === year ? 1 : 0;
          if (aYear !== bYear) return bYear - aYear;
          return (b.popularity ?? 0) - (a.popularity ?? 0);
        })
        .slice(0, 5);

      let fetchedAny = false;
      for (const cand of candidatesToCheck) {
        if (!cand.alternativeTitles) {
          const alts = await fetchAlternativeTitles(cand.id, cand.mediaType, signal);
          if (alts && alts.length > 0) {
            cand.alternativeTitles = alts;
            fetchedAny = true;
          }
        }
      }

      if (fetchedAny) {
        best = pickBestCandidate(candidates, opts);
        if (best) return { status: "match", result: best };
      }
    }

    // Subtitle fallback: if query contains subtitle delimiters (e.g. "Title: Subtitle" or "Title - Subtitle"),
    // retry searching TMDB for the base title.
    const baseQuery = query.split(/\s*[:;]\s*|\s+[-–—]\s+/)[0]?.trim();
    if (baseQuery && baseQuery.length >= 2 && baseQuery !== query) {
      const baseCandidates = await collectCandidates(path, baseQuery, year, yearParam, signal);
      if (baseCandidates === null) return { status: "error" };
      const baseBest = pickBestCandidate(baseCandidates, opts);
      if (baseBest) return { status: "match", result: baseBest };
    }

    // Article fallback: if query begins with "The ", "A ", or "An ", retry without it.
    const noArticleQuery = query.replace(/^(the|a|an)\s+/i, "").trim();
    if (noArticleQuery && noArticleQuery.length >= 2 && noArticleQuery !== query && noArticleQuery !== baseQuery) {
      const articleCandidates = await collectCandidates(path, noArticleQuery, year, yearParam, signal);
      if (articleCandidates === null) return { status: "error" };
      const articleBest = pickBestCandidate(articleCandidates, opts);
      if (articleBest) return { status: "match", result: articleBest };
    }

    // Region fallback: the parser strips "US"/"UK" from the title to avoid mangling
    // real titles ("This Is Us"), but some entries are only findable with the region
    // word present. Retry once with the region appended, and score against the
    // augmented title so "This Is" + "US" exact-matches "This Is Us".
    if (region) {
      const retryTitle = `${query} ${region.toUpperCase()}`;
      const retryCandidates = await collectCandidates(
        path,
        retryTitle,
        undefined,
        yearParam,
        signal
      );
      if (retryCandidates === null) return { status: "error" };
      const retryBest = pickBestCandidate(retryCandidates, { ...opts, title: retryTitle });
      if (retryBest) return { status: "match", result: retryBest };
    }

    return { status: "no-match" };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    console.error(`TMDB ${path} search error:`, e);
    return { status: "error" };
  }
}

export function searchTmdbMovie(
  title: string,
  year?: string,
  region?: string,
  signal?: AbortSignal
): Promise<TmdbSearchOutcome> {
  return searchTmdb("search/movie", title, year, "primary_release_year", region, { title, year, region, mediaType: "movie" }, signal);
}

export function searchTmdbTv(
  title: string,
  year?: string,
  region?: string,
  signal?: AbortSignal
): Promise<TmdbSearchOutcome> {
  return searchTmdb("search/tv", title, year, "first_air_date_year", region, { title, year, region, mediaType: "tv" }, signal);
}

// Re-exported season fetch for reuse by scripts
export async function fetchSeasonEpisodes(
  showTmdbId: number,
  seasonNumber: number,
  signal?: AbortSignal
): Promise<Array<{ episodeNumber: number; episodeTitle: string; overview: string | null; stillUrl: string | null }>> {
  if (seasonNumber <= 0) return [];
  const data = await tmdbGet(`tv/${showTmdbId}/season/${seasonNumber}`, {}, signal);
  if (!data || !Array.isArray(data.episodes)) return [];
  return data.episodes.map((ep: any) => ({
    episodeNumber: ep.episode_number,
    episodeTitle: ep.name || `Episode ${ep.episode_number}`,
    overview: ep.overview || null,
    stillUrl: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : null,
  }));
}
