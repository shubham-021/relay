import { Cache } from "@raycast/api";
import { clearAuthTokens, getAccessToken } from "./oauth";
import { getServerUrl } from "./preferences";
import type {
  CdnLinkResponse,
  ContinueWatchingItem,
  MovieItem,
  OtherFileItem,
  PlayableTarget,
  ProgressResponse,
  TorBoxAccount,
  TvShowDetailResponse,
  TvShowSummary,
} from "./types";

const cache = new Cache();

interface CachedEntry<T> {
  etag?: string;
  data: T;
}

function getScopedCacheKey(key: string): string {
  return `${getServerUrl()}::${key}`;
}

export function getCachedData<T>(key: string): T | undefined {
  const raw = cache.get(getScopedCacheKey(key));
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as CachedEntry<T>;
    return parsed.data;
  } catch {
    return undefined;
  }
}

/**
 * Like getCachedData but guarantees the result is an array.
 * Protects against stale cache entries that stored a wrapper object
 * (e.g. `{ items: [...] }`) instead of the extracted array.
 */
export function getCachedArray<T>(key: string): T[] {
  const data = getCachedData<T[]>(key);
  return Array.isArray(data) ? data : [];
}

export function clearLibraryCache(): void {
  cache.clear();
}

async function authorizedFetch(
  path: string,
  init: RequestInit = {},
  retryOn401 = true,
): Promise<Response> {
  const token = await getAccessToken();
  const baseUrl = getServerUrl();

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });

  if (res.status === 401 && retryOn401) {
    await clearAuthTokens();
    const freshToken = await getAccessToken(true);
    const retryHeaders = new Headers(init.headers);
    retryHeaders.set("Authorization", `Bearer ${freshToken}`);
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: retryHeaders,
    });
  }

  return res;
}

async function parseErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    return body.error || body.message || `${fallback} (${res.status})`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authorizedFetch(path, init);
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res, "Request failed"));
  }
  return (await res.json()) as T;
}

async function fetchWithETag<TRaw, TOut = TRaw>(
  cacheKey: string,
  path: string,
  extract?: (raw: TRaw) => TOut,
): Promise<TOut> {
  const scopedKey = getScopedCacheKey(cacheKey);
  let cachedEtag: string | undefined;
  let cachedData: TOut | undefined;

  const raw = cache.get(scopedKey);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as CachedEntry<TOut>;
      cachedEtag = parsed.etag;
      cachedData = parsed.data;
    } catch {
      // ignore corrupt cache
    }
  }

  const headers = new Headers();
  if (cachedEtag) {
    headers.set("If-None-Match", cachedEtag);
  }

  const res = await authorizedFetch(path, { headers });

  if (res.status === 304 && cachedData !== undefined) {
    // If an extract function exists, the cached data might be from before
    // the extract migration (i.e. it's the raw wrapper object, not the
    // extracted value). Detect this and re-extract + re-cache.
    if (extract && !Array.isArray(cachedData) && typeof cachedData === "object" && cachedData !== null) {
      try {
        const reExtracted = extract(cachedData as unknown as TRaw);
        cache.set(
          scopedKey,
          JSON.stringify({ etag: cachedEtag, data: reExtracted } satisfies CachedEntry<TOut>),
        );
        return reExtracted;
      } catch {
        // Fall through to fetch fresh data below
      }
    } else {
      return cachedData;
    }
  }

  if (!res.ok) {
    throw new Error(await parseErrorMessage(res, "Failed to load library"));
  }

  const rawData = (await res.json()) as TRaw;
  const extracted = extract ? extract(rawData) : (rawData as unknown as TOut);
  const etag = res.headers.get("etag") ?? res.headers.get("Etag") ?? undefined;
  cache.set(
    scopedKey,
    JSON.stringify({ etag, data: extracted } satisfies CachedEntry<TOut>),
  );
  return extracted;
}

export async function getMovies(): Promise<MovieItem[]> {
  return fetchWithETag<{ items: MovieItem[] }, MovieItem[]>(
    "movies",
    "/api/library/movies",
    (res) => res.items,
  );
}

export async function getShows(): Promise<TvShowSummary[]> {
  return fetchWithETag<{ shows: TvShowSummary[] }, TvShowSummary[]>(
    "shows",
    "/api/library/tv",
    (res) => res.shows,
  );
}

export async function getShowDetails(
  showTitle: string,
): Promise<TvShowDetailResponse> {
  const encoded = encodeURIComponent(showTitle);
  return fetchWithETag<TvShowDetailResponse>(
    `show:${showTitle}`,
    `/api/library/tv/${encoded}`,
  );
}

export async function getOtherFiles(): Promise<OtherFileItem[]> {
  return fetchWithETag<{ items: OtherFileItem[] }, OtherFileItem[]>(
    "other",
    "/api/library/other",
    (res) => res.items,
  );
}

export async function getContinueWatching(): Promise<ContinueWatchingItem[]> {
  const res = await fetchJson<{ items: ContinueWatchingItem[] }>(
    "/api/library/continue-watching",
  );
  cache.set(
    getScopedCacheKey("continue-watching"),
    JSON.stringify({ data: res.items } satisfies CachedEntry<
      ContinueWatchingItem[]
    >),
  );
  return res.items;
}

export async function fetchCdnLink(
  target: PlayableTarget,
): Promise<CdnLinkResponse> {
  return fetchJson<CdnLinkResponse>("/api/cdn-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      account_id: target.account_id,
      torrent_id: target.torrent_id,
      file_id: target.file_id,
    }),
  });
}

export async function fetchProgress(
  target: PlayableTarget,
): Promise<ProgressResponse | null> {
  try {
    const query = new URLSearchParams({
      account_id: String(target.account_id),
      torrent_id: String(target.torrent_id),
      file_id: String(target.file_id),
    });
    return await fetchJson<ProgressResponse>(
      `/api/progress?${query.toString()}`,
    );
  } catch {
    return null;
  }
}

export async function markAsWatched(target: PlayableTarget): Promise<void> {
  await fetchJson<{ ok: boolean }>("/api/library/continue-watching/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      account_id: target.account_id,
      torrent_id: target.torrent_id,
      file_id: target.file_id,
    }),
  });
}

export async function getAccounts(): Promise<TorBoxAccount[]> {
  const res = await fetchJson<{ accounts: TorBoxAccount[] }>("/api/accounts");
  return res.accounts;
}

export async function syncAllAccounts(): Promise<number> {
  const accounts = await getAccounts();
  let totalSynced = 0;
  for (const account of accounts) {
    const res = await fetchJson<{ success: boolean; files_synced?: number }>(
      "/api/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: account.id }),
      },
    );
    totalSynced += res.files_synced ?? 0;
  }
  clearLibraryCache();
  return totalSynced;
}
