import {
  TORBOX_ENDPOINTS,
  getTbSbAnonKey,
  TOKEN_REFRESH_BUFFER_S,
} from "./torbox-config";
import { decrypt, encrypt } from "./crypto";
import {
  getAccountById,
  updateAccountTokens,
} from "./db";

// Types

export interface TorBoxAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number;
  refresh_token: string;
  user: {
    id: string;
    email: string;
    [key: string]: unknown;
  };
}

export interface TorBoxFile {
  id: number;
  md5: string | null;
  hash: string;
  name: string;
  size: number;
  zipped: boolean;
  s3_path: string;
  infected: boolean;
  mimetype: string;
  short_name: string;
  absolute_path: string;
  opensubtitles_hash: string;
}

export interface TorBoxTorrent {
  id: number;
  hash: string;
  name: string;
  size: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  download_state: string;
  progress: number;
  files: TorBoxFile[];
  [key: string]: unknown;
}

export interface TorBoxListResponse {
  success: boolean;
  error: string | null;
  detail: string;
  data: TorBoxTorrent[];
}

export interface TorBoxCdnResponse {
  success: boolean;
  error: string | null;
  detail: string;
  data: string; // CDN URL
}

// Authentication 

// Authenticate with TorBox using email and password.
export async function authenticateTorBox(
  email: string,
  password: string,
  signal?: AbortSignal
): Promise<TorBoxAuthResponse> {
  const anonKey = getTbSbAnonKey();

  const res = await fetch(TORBOX_ENDPOINTS.AUTH_LOGIN, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
    signal
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      (body as { error_description?: string }).error_description ||
      (body as { msg?: string }).msg ||
      `Authentication failed (${res.status})`;
    throw new Error(message);
  }

  return res.json();
}

// Refresh an expired access token using a refresh token.
export async function refreshTorBoxToken(
  refreshToken: string,
  signal?: AbortSignal
): Promise<TorBoxAuthResponse> {
  const anonKey = getTbSbAnonKey();

  const res = await fetch(TORBOX_ENDPOINTS.AUTH_REFRESH, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      (body as { error_description?: string }).error_description ||
      `Token refresh failed (${res.status})`;
    throw new Error(message);
  }

  return res.json();
}

// Token Management 

/**
 * Get a valid access token for the given account.
 *
 * Strategy:
 *   1. Read stored token from DB
 *   2. If token is still valid (with buffer) → return it
 *   3. If expired → try refresh token
 *   4. If refresh fails → re-authenticate with stored credentials
 *   5. Update DB with new tokens in all cases
 */
export async function getValidAccessToken(accountId: number, signal?: AbortSignal): Promise<string> {
  const account = getAccountById(accountId);
  if (!account) {
    throw new Error("Account not found");
  }

  const now = Math.floor(Date.now() / 1000);

  // Check if current token is still valid (with buffer)
  if (
    account.access_token &&
    account.token_expires_at &&
    now + TOKEN_REFRESH_BUFFER_S < account.token_expires_at
  ) {
    return account.access_token;
  }

  // Token expired or about to expire — try refresh
  if (account.refresh_token) {
    try {
      const refreshed = await refreshTorBoxToken(account.refresh_token, signal);
      updateAccountTokens(
        accountId,
        refreshed.access_token,
        refreshed.refresh_token,
        refreshed.expires_at
      );
      return refreshed.access_token;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      console.warn(
        `Token refresh failed for account ${accountId}, falling back to re-auth:`,
        e
      );
    }
  }

  // Refresh failed or no refresh token — re-authenticate
  let password: string;
  try {
    password = decrypt(account.torbox_password);
  } catch {
    throw new Error("Failed to decrypt stored credentials");
  }

  const authResult = await authenticateTorBox(account.torbox_email, password, signal);
  updateAccountTokens(
    accountId,
    authResult.access_token,
    authResult.refresh_token,
    authResult.expires_at
  );
  return authResult.access_token;
}

// Torrent Data 
export async function fetchTorrentList(
  accessToken: string,
  signal?: AbortSignal
): Promise<TorBoxTorrent[]> {
  const res = await fetch(TORBOX_ENDPOINTS.TORRENTS_MYLIST, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
    signal,
  });

  if (!res.ok) {
    let errorMsg = res.status === 429
      ? "TorBox rate limit reached. Please wait a moment."
      : `Failed to fetch torrent list (${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson?.detail) errorMsg = String(errJson.detail);
      else if (errJson?.error) errorMsg = String(errJson.error);
    } catch {
      // Response was not JSON
    }
    const err = new Error(errorMsg);
    (err as any).status = res.status;
    throw err;
  }

  let body: TorBoxListResponse;
  try {
    body = await res.json();
  } catch {
    throw new Error(`TorBox returned invalid response (${res.status})`);
  }

  if (!body.success) {
    throw new Error(body.error || "TorBox API returned unsuccessful response");
  }

  return body.data || [];
}

// CDN Link Generation
export async function requestCdnLink(
  torrentId: number,
  fileId: number,
  accessToken: string,
  signal?: AbortSignal
): Promise<string> {
  const url = new URL(TORBOX_ENDPOINTS.TORRENTS_REQUEST_DL);
  url.searchParams.set("torrent_id", String(torrentId));
  url.searchParams.set("file_id", String(fileId));
  url.searchParams.set("token", accessToken);

  const res = await fetch(url.toString(), {
    cache: "no-store",
    signal,
  });

  if (!res.ok) {
    let errorMsg = res.status === 429
      ? "TorBox rate limit reached. Please wait a moment."
      : `Failed to request CDN link (${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson?.error === "DATABASE_ERROR") {
        errorMsg = "Torrent not found or removed on TorBox";
      } else if (errJson?.detail) {
        errorMsg = String(errJson.detail);
      } else if (errJson?.error) {
        errorMsg = String(errJson.error);
      }
    } catch {
      // Response was not JSON
    }
    const err = new Error(errorMsg);
    (err as any).status = res.status;
    throw err;
  }

  let body: TorBoxCdnResponse;
  try {
    body = await res.json();
  } catch {
    throw new Error(`TorBox returned invalid response (${res.status})`);
  }

  if (!body.success || !body.data) {
    throw new Error(body.error || body.detail || "TorBox API returned no CDN URL");
  }

  return body.data;
}

// Torrent Cache Check

export interface CachedTorrentFile {
  id: number;
  name: string;
  size: number;
  opensubtitles_hash: string | null;
  short_name: string;
  mimetype: string;
}

export interface CachedTorrentInfo {
  name: string;
  size: number;
  hash: string;
  files: CachedTorrentFile[];
}

export interface CheckCachedResponse {
  success: boolean;
  error: string | null;
  detail: string;
  data: Record<string, CachedTorrentInfo>;
}

/** Check if a single torrent hash is cached on TorBox. */
export async function checkTorrentCached(
  hash: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<CheckCachedResponse> {
  const url = new URL(TORBOX_ENDPOINTS.TORRENTS_CHECK_CACHED);
  url.searchParams.set("hash", hash);
  url.searchParams.set("format", "object");
  url.searchParams.set("list_files", "true");

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
    signal,
  });

  if (!res.ok) {
    let errorMsg = res.status === 429
      ? "TorBox rate limit reached. Please wait a moment."
      : `Failed to check torrent cache (${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson?.detail) errorMsg = String(errJson.detail);
      else if (errJson?.error) errorMsg = String(errJson.error);
    } catch {
      // not JSON
    }
    const err = new Error(errorMsg);
    (err as any).status = res.status;
    throw err;
  }

  try {
    return await res.json();
  } catch {
    throw new Error(`TorBox returned invalid response (${res.status})`);
  }
}

/** Check if multiple torrent hashes are cached on TorBox (bulk). */
export async function checkTorrentsCachedBulk(
  hashes: string[],
  accessToken: string,
  signal?: AbortSignal
): Promise<CheckCachedResponse> {
  const url = new URL(TORBOX_ENDPOINTS.TORRENTS_CHECK_CACHED);
  url.searchParams.set("format", "object");
  url.searchParams.set("list_files", "true");

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ hashes }),
    signal,
  });

  if (!res.ok) {
    let errorMsg = res.status === 429
      ? "TorBox rate limit reached. Please wait a moment."
      : `Failed to check torrent cache (${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson?.detail) errorMsg = String(errJson.detail);
      else if (errJson?.error) errorMsg = String(errJson.error);
    } catch {
      // not JSON
    }
    const err = new Error(errorMsg);
    (err as any).status = res.status;
    throw err;
  }

  try {
    return await res.json();
  } catch {
    throw new Error(`TorBox returned invalid response (${res.status})`);
  }
}

// Torrent Creation

export interface CreateTorrentResponse {
  success: boolean;
  error: string | null;
  detail: string;
  data: {
    hash: string;
    torrent_id: number;
    auth_id: string;
  };
}

/** Add a torrent to TorBox account using a magnet link. */
export async function createTorrent(
  magnetLink: string,
  accessToken: string,
  addOnlyIfCached: boolean = true,
  signal?: AbortSignal
): Promise<CreateTorrentResponse> {
  const formData = new FormData();
  formData.append("magnet", magnetLink);
  if (addOnlyIfCached) {
    formData.append("add_only_if_cached", "true");
  }

  const res = await fetch(TORBOX_ENDPOINTS.TORRENTS_CREATE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
    signal,
  });

  if (!res.ok) {
    let errorMsg = res.status === 429
      ? "TorBox rate limit reached. Please wait a moment."
      : `Failed to create torrent (${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson?.detail) errorMsg = String(errJson.detail);
      else if (errJson?.error) errorMsg = String(errJson.error);
    } catch {
      // not JSON
    }
    const err = new Error(errorMsg);
    (err as any).status = res.status;
    throw err;
  }

  try {
    return await res.json();
  } catch {
    throw new Error(`TorBox returned invalid response (${res.status})`);
  }
}

// Torrent Deletion

export interface ControlTorrentResponse {
  success: boolean;
  error: string | null;
  detail: string;
  data: null;
}

/** Delete a torrent from TorBox account. */
export async function deleteTorrent(
  torrentId: number,
  accessToken: string,
  signal?: AbortSignal
): Promise<ControlTorrentResponse> {
  const res = await fetch(TORBOX_ENDPOINTS.TORRENTS_CONTROL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      torrent_id: torrentId,
      operation: "delete",
    }),
    signal,
  });

  if (!res.ok) {
    let errorMsg = res.status === 429
      ? "TorBox rate limit reached. Please wait a moment."
      : `Failed to delete torrent (${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson?.error === "DATABASE_ERROR") {
        errorMsg = "Torrent not found or already deleted on TorBox";
      } else if (errJson?.detail) {
        errorMsg = String(errJson.detail);
      } else if (errJson?.error) {
        errorMsg = String(errJson.error);
      }
    } catch {
      // Response was not JSON
    }
    const err = new Error(errorMsg);
    (err as any).status = res.status;
    throw err;
  }

  let body: ControlTorrentResponse;
  try {
    body = await res.json();
  } catch {
    throw new Error(`TorBox returned invalid response (${res.status})`);
  }

  if (body.success === false) {
    throw new Error(body.error || body.detail || "Failed to delete torrent on TorBox");
  }

  return body;
}
