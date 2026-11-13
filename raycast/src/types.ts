export interface ExtensionPreferences {
  serverUrl: string;
  playerPath?: string;
  playerArgs?: string;
  resumePlayback?: boolean;
}

export interface PlayerConfig {
  playerPath: string;
  playerArgs: string;
  resumePlayback: boolean;
}

export interface PlayableTarget {
  account_id: number;
  torrent_id: number;
  file_id: number;
  title: string;
}

export interface MovieItem {
  id: number;
  account_id: number;
  torrent_id: number;
  file_id: number;
  remote_path: string;
  filename: string;
  short_name: string;
  size: number;
  sizeFormatted: string;
  mime_type: string;
  tmdb_id: number | null;
  title: string;
  year: number | null;
  poster_url: string | null;
  backdrop_url: string | null;
  overview: string | null;
  synced_at: string;
  percent: number;
  completed: boolean;
}

export interface TvShowSummary {
  show_title: string;
  tmdb_id: number | null;
  poster_url: string | null;
  backdrop_url: string | null;
  overview: string | null;
  season_count: number;
  episode_count: number;
  start_year: number | null;
}

export interface TvEpisode {
  id: number;
  account_id: number;
  torrent_id: number;
  file_id: number;
  remote_path: string;
  filename: string;
  short_name: string;
  size: number;
  sizeFormatted: string;
  mime_type: string;
  season_number: number;
  episode_number: number | null;
  episode_end_number: number | null;
  episode_title: string;
  episode_overview: string | null;
  still_url: string | null;
  torrent_name: string;
  percent: number;
  completed: boolean;
}

export interface TvSeason {
  seasonNumber: number;
  episodes: TvEpisode[];
}

export interface TvShowDetailResponse {
  show: {
    showTitle: string;
    posterUrl: string | null;
    backdropUrl: string | null;
    overview: string | null;
    tmdbId: number | null;
  };
  seasons: TvSeason[];
}

export interface OtherFileItem {
  id: number;
  account_id: number;
  torrent_id: number;
  file_id: number;
  remote_path: string;
  filename: string;
  short_name: string;
  size: number;
  sizeFormatted: string;
  mime_type: string;
  percent: number;
  completed: boolean;
  has_thumbnail: boolean;
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
  year: number | null;
  position_seconds: number;
  duration_seconds: number | null;
  percent: number;
  last_updated: string;
  up_next: boolean;
}

export interface TorBoxAccount {
  id: number;
  torbox_email: string;
  is_active: number | boolean;
  last_synced_at?: string | null;
  last_updated_at?: string | null;
}

export interface CdnLinkResponse {
  success: boolean;
  url: string;
  playToken: string;
}

export interface ProgressResponse {
  position: number;
  duration: number | null;
  completed: boolean;
}
