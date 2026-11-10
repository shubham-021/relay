export interface Account {
  id: number;
  torbox_email: string;
  torbox_password: string; // AES-256-GCM encrypted
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: number | null; // unix timestamp (seconds)
  last_synced_at: string | null;
  last_updated_at: string | null;
  created_at: string;
}

export interface UserAccount {
  user_id: number;
  account_id: number;
  is_active: number;
  created_at: string;
}

// Session data stored in encrypted iron-session cookie
export interface SessionData {
  userId?: number;           // Application user ID
  playerProtocol: string;    // default: "vlc"
}

// TorBox account response for client-side display
export interface TorBoxAccount {
  id: number;
  torbox_email: string;
  is_active: boolean;
  last_synced_at: string | null;
  last_updated_at: string | null;
}

// File item returned by GET /api/files (from DB join)
export interface FileItem {
  id: number;
  account_id: number;
  torrent_id: number;
  file_id: number;
  remote_path: string;     // files[].name from TorBox API (e.g. "Movie Folder/Movie.mkv")
  filename: string;        // basename extracted from remote_path
  short_name: string | null;
  size: number;
  sizeFormatted: string;
  mime_type: string;
  tmdb_id: number | null;
  raw_title: string | null;
  raw_year: string | null;
  synced_at: string;
  // Joined media fields
  media_title: string | null;
  media_year: string | null;
  media_poster_url: string | null;
  media_type: "movie" | "tv" | null;
}

// Breadcrumb segment
export interface BreadcrumbItem {
  name: string;
  path: string;
}

// Player configuration
export interface PlayerConfig {
  id: string;
  name: string;
  urlTemplate: string;
  platforms: string[];
}

// API response types
export interface FilesResponse {
  items: FileItem[];
  currentPath: string;
  breadcrumbs: BreadcrumbItem[];
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
}

// CDN link request/response (replaces create-token and direct-url)
export interface CdnLinkRequest {
  torrent_id: number;
  file_id: number;
  account_id: number;
}

export interface CdnLinkResponse {
  success: boolean;
  url: string;
  playToken: string;   // short-lived HMAC token for resume progress reporting
}

export interface ContinueWatchingItem {
  account_id: number;
  torrent_id: number;
  file_id: number;
  title: string;
  filename: string;
  media_type: "movie" | "tv" | "other";
  show_title: string | null;
  season_number: number | null;
  episode_number: number | null;
  episode_title: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  year: string | null;
  position_seconds: number;
  duration_seconds: number | null;
  percent: number;              // 0-100, computed server-side
  last_updated: string;
  up_next: boolean;             // true = TV "next episode" card (no progress)
}

export interface ApiError {
  error: string;
}

// Account management
export interface AddAccountRequest {
  torbox_email: string;
  torbox_password: string;
}

export interface AddAccountResponse {
  success: boolean;
  account?: TorBoxAccount;
  error?: string;
}

export interface SyncRequest {
  account_id: number;
}

export interface SyncResponse {
  success: boolean;
  files_synced?: number;
  error?: string;
}