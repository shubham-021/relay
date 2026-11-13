import {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  openExtensionPreferences,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getCachedArray,
  getContinueWatching,
  getMovies,
  getOtherFiles,
  getShows,
} from "./api";
import {
  PlayableActionPanel,
  RelayManagementActions,
} from "./components/MediaActions";
import { buildMovieAccessories, MoviesList } from "./components/MoviesList";
import {
  buildOtherFileAccessories,
  OtherFilesList,
} from "./components/OtherFilesList";
import { ShowEpisodesView } from "./components/ShowEpisodesView";
import { buildShowAccessories, ShowsList } from "./components/ShowsList";
import { getAccessToken } from "./oauth";
import type {
  ContinueWatchingItem,
  MovieItem,
  OtherFileItem,
  TvShowSummary,
} from "./types";

type CategoryFilter = "all" | "continue" | "movies" | "shows" | "other";

function matchesTokens(
  query: string,
  fields: Array<string | number | null | undefined>,
): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = fields
    .filter((f) => f !== null && f !== undefined)
    .map((f) => String(f).toLowerCase())
    .join(" ");
  return tokens.every((t) => haystack.includes(t));
}

function formatContinueSubtitle(item: ContinueWatchingItem): string {
  if (
    item.media_type === "tv" &&
    item.season_number != null &&
    item.episode_number != null
  ) {
    const s = String(item.season_number).padStart(2, "0");
    const e = String(item.episode_number).padStart(2, "0");
    const epPart = item.episode_title ? ` · ${item.episode_title}` : "";
    return `S${s}E${e}${epPart}`;
  }
  if (item.year) {
    return String(item.year);
  }
  return item.filename;
}

function formatContinueTitle(item: ContinueWatchingItem): string {
  if (item.media_type === "tv" && item.show_title) {
    return item.show_title;
  }
  return item.title;
}

export default function RelayCommand() {
  const { push } = useNavigation();

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [filter, setFilter] = useState<CategoryFilter>("all");

  const [continueWatching, setContinueWatching] = useState<
    ContinueWatchingItem[]
  >(() => getCachedArray<ContinueWatchingItem>("continue-watching"));
  const [movies, setMovies] = useState<MovieItem[]>(() =>
    getCachedArray<MovieItem>("movies"),
  );
  const [shows, setShows] = useState<TvShowSummary[]>(() =>
    getCachedArray<TvShowSummary>("shows"),
  );
  const [otherFiles, setOtherFiles] = useState<OtherFileItem[]>(() =>
    getCachedArray<OtherFileItem>("other"),
  );

  const loadLibrary = useCallback(async () => {
    setIsLoading(true);
    setAuthError(null);
    try {
      await getAccessToken();
      setIsAuthenticated(true);

      const [cwRes, moviesRes, showsRes, otherRes] = await Promise.allSettled([
        getContinueWatching(),
        getMovies(),
        getShows(),
        getOtherFiles(),
      ]);

      if (cwRes.status === "fulfilled")
        setContinueWatching(Array.isArray(cwRes.value) ? cwRes.value : []);
      if (moviesRes.status === "fulfilled")
        setMovies(Array.isArray(moviesRes.value) ? moviesRes.value : []);
      if (showsRes.status === "fulfilled")
        setShows(Array.isArray(showsRes.value) ? showsRes.value : []);
      if (otherRes.status === "fulfilled")
        setOtherFiles(Array.isArray(otherRes.value) ? otherRes.value : []);

      const firstError = [cwRes, moviesRes, showsRes, otherRes].find(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      if (firstError) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Partial library load error",
          message:
            firstError.reason instanceof Error
              ? firstError.reason.message
              : String(firstError.reason),
        });
      }
    } catch (err) {
      setIsAuthenticated(false);
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  // Auto-refresh Continue Watching every 5s while view is active so exit progress appears immediately
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(async () => {
      try {
        const cw = await getContinueWatching();
        setContinueWatching(Array.isArray(cw) ? cw : []);
      } catch {
        // ignore background poll errors
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const handleLoggedOut = useCallback(async () => {
    setIsAuthenticated(false);
    setContinueWatching([]);
    setMovies([]);
    setShows([]);
    setOtherFiles([]);
    await loadLibrary();
  }, [loadLibrary]);

  const trimmedQuery = searchText.trim();
  const isSearching = trimmedQuery.length > 0;

  const filteredContinue = useMemo(
    () =>
      (Array.isArray(continueWatching) ? continueWatching : []).filter((item) =>
        matchesTokens(trimmedQuery, [
          item.title,
          item.show_title,
          item.episode_title,
          item.filename,
          item.year,
        ]),
      ),
    [continueWatching, trimmedQuery],
  );

  const filteredMovies = useMemo(
    () =>
      (Array.isArray(movies) ? movies : []).filter((m) =>
        matchesTokens(trimmedQuery, [
          m.title,
          m.filename,
          m.short_name,
          m.year,
        ]),
      ),
    [movies, trimmedQuery],
  );

  const filteredShows = useMemo(
    () =>
      (Array.isArray(shows) ? shows : []).filter((s) =>
        matchesTokens(trimmedQuery, [s.show_title, s.start_year]),
      ),
    [shows, trimmedQuery],
  );

  const filteredOther = useMemo(
    () =>
      (Array.isArray(otherFiles) ? otherFiles : []).filter((f) =>
        matchesTokens(trimmedQuery, [
          f.short_name,
          f.filename,
          f.remote_path,
          f.mime_type,
        ]),
      ),
    [otherFiles, trimmedQuery],
  );

  if (!isAuthenticated && !isLoading) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Lock}
          title="Sign in to Relay"
          description={
            authError ??
            "Connect your Relay account via OAuth to browse and stream."
          }
          actions={
            <ActionPanel>
              <Action
                title="Sign in with Relay"
                icon={Icon.Key}
                onAction={loadLibrary}
              />
              <Action
                title="Open Extension Preferences"
                icon={Icon.Gear}
                onAction={openExtensionPreferences}
              />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  const showBrowseHub = filter === "all" && !isSearching;

  return (
    <List
      isLoading={isLoading}
      filtering={false}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search movies, shows, or other files..."
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter Library"
          value={filter}
          onChange={(val) => setFilter(val as CategoryFilter)}
        >
          <List.Dropdown.Item title="All" value="all" />
          <List.Dropdown.Item title="Continue Watching" value="continue" />
          <List.Dropdown.Item
            title={`Movies (${movies.length})`}
            value="movies"
          />
          <List.Dropdown.Item title={`Shows (${shows.length})`} value="shows" />
          <List.Dropdown.Item
            title={`Other (${otherFiles.length})`}
            value="other"
          />
        </List.Dropdown>
      }
    >
      {showBrowseHub ? (
        <>
          <List.Section title="Browse Library">
            <List.Item
              title="Movies"
              subtitle="Search and play movies from your TorBox library"
              icon={Icon.FilmStrip}
              accessories={[{ text: `${movies.length}` }]}
              actions={
                <ActionPanel>
                  <Action
                    title="Browse Movies"
                    icon={Icon.ArrowRight}
                    onAction={() =>
                      push(<MoviesList onLoggedOut={handleLoggedOut} />)
                    }
                  />
                  <RelayManagementActions
                    onRefresh={loadLibrary}
                    onLoggedOut={handleLoggedOut}
                  />
                </ActionPanel>
              }
            />
            <List.Item
              title="Shows"
              subtitle="Pick a TV show, season, and episode"
              icon={Icon.Monitor}
              accessories={[{ text: `${shows.length}` }]}
              actions={
                <ActionPanel>
                  <Action
                    title="Browse Shows"
                    icon={Icon.ArrowRight}
                    onAction={() =>
                      push(<ShowsList onLoggedOut={handleLoggedOut} />)
                    }
                  />
                  <RelayManagementActions
                    onRefresh={loadLibrary}
                    onLoggedOut={handleLoggedOut}
                  />
                </ActionPanel>
              }
            />
            <List.Item
              title="Other"
              subtitle="Browse uncategorized and miscellaneous files"
              icon={Icon.Document}
              accessories={[{ text: `${otherFiles.length}` }]}
              actions={
                <ActionPanel>
                  <Action
                    title="Browse Other Files"
                    icon={Icon.ArrowRight}
                    onAction={() =>
                      push(<OtherFilesList onLoggedOut={handleLoggedOut} />)
                    }
                  />
                  <RelayManagementActions
                    onRefresh={loadLibrary}
                    onLoggedOut={handleLoggedOut}
                  />
                </ActionPanel>
              }
            />
          </List.Section>

          {continueWatching.length > 0 && (
            <List.Section title="Continue Watching">
              {continueWatching.map((item) => {
                const displayTitle = formatContinueTitle(item);
                const subtitle = formatContinueSubtitle(item);
                const targetTitle =
                  item.media_type === "tv" && item.show_title
                    ? `${item.show_title} ${subtitle}`
                    : displayTitle;

                return (
                  <List.Item
                    key={`cw-${item.account_id}-${item.torrent_id}-${item.file_id}`}
                    title={displayTitle}
                    subtitle={subtitle}
                    icon={
                      item.poster_url ? { source: item.poster_url } : Icon.Play
                    }
                    accessories={[
                      item.up_next
                        ? { tag: { value: "Up Next", color: Color.Purple } }
                        : {
                            tag: {
                              value: `${item.percent}%`,
                              color: Color.Blue,
                            },
                          },
                    ]}
                    actions={
                      <PlayableActionPanel
                        target={{
                          account_id: item.account_id,
                          torrent_id: item.torrent_id,
                          file_id: item.file_id,
                          title: targetTitle,
                        }}
                        onRefresh={loadLibrary}
                        onLoggedOut={handleLoggedOut}
                      />
                    }
                  />
                );
              })}
            </List.Section>
          )}
        </>
      ) : (
        <>
          {(filter === "continue" ||
            (filter === "all" && filteredContinue.length > 0)) && (
            <List.Section title="Continue Watching">
              {filteredContinue.map((item) => {
                const displayTitle = formatContinueTitle(item);
                const subtitle = formatContinueSubtitle(item);
                const targetTitle =
                  item.media_type === "tv" && item.show_title
                    ? `${item.show_title} ${subtitle}`
                    : displayTitle;

                return (
                  <List.Item
                    key={`search-cw-${item.account_id}-${item.torrent_id}-${item.file_id}`}
                    title={displayTitle}
                    subtitle={subtitle}
                    icon={
                      item.poster_url ? { source: item.poster_url } : Icon.Play
                    }
                    accessories={[
                      item.up_next
                        ? { tag: { value: "Up Next", color: Color.Purple } }
                        : {
                            tag: {
                              value: `${item.percent}%`,
                              color: Color.Blue,
                            },
                          },
                    ]}
                    actions={
                      <PlayableActionPanel
                        target={{
                          account_id: item.account_id,
                          torrent_id: item.torrent_id,
                          file_id: item.file_id,
                          title: targetTitle,
                        }}
                        onRefresh={loadLibrary}
                        onLoggedOut={handleLoggedOut}
                      />
                    }
                  />
                );
              })}
            </List.Section>
          )}

          {(filter === "all" || filter === "movies") &&
            filteredMovies.length > 0 && (
              <List.Section
                title="Movies"
                subtitle={`${filteredMovies.length}`}
              >
                {filteredMovies.map((movie) => (
                  <List.Item
                    key={`m-${movie.account_id}-${movie.torrent_id}-${movie.file_id}`}
                    title={movie.title}
                    subtitle={movie.year ? String(movie.year) : movie.filename}
                    icon={
                      movie.poster_url
                        ? { source: movie.poster_url }
                        : Icon.FilmStrip
                    }
                    accessories={buildMovieAccessories(movie)}
                    actions={
                      <PlayableActionPanel
                        target={{
                          account_id: movie.account_id,
                          torrent_id: movie.torrent_id,
                          file_id: movie.file_id,
                          title: movie.title,
                        }}
                        completed={movie.completed}
                        onRefresh={loadLibrary}
                        onLoggedOut={handleLoggedOut}
                      />
                    }
                  />
                ))}
              </List.Section>
            )}

          {(filter === "all" || filter === "shows") &&
            filteredShows.length > 0 && (
              <List.Section title="Shows" subtitle={`${filteredShows.length}`}>
                {filteredShows.map((show) => (
                  <List.Item
                    key={`s-${show.show_title}`}
                    title={show.show_title}
                    subtitle={
                      show.start_year ? String(show.start_year) : undefined
                    }
                    icon={
                      show.poster_url
                        ? { source: show.poster_url }
                        : Icon.Monitor
                    }
                    accessories={buildShowAccessories(show)}
                    actions={
                      <ActionPanel>
                        <Action
                          title="Browse Episodes"
                          icon={Icon.List}
                          onAction={() =>
                            push(
                              <ShowEpisodesView
                                showTitle={show.show_title}
                                onLoggedOut={handleLoggedOut}
                              />,
                            )
                          }
                        />
                        <RelayManagementActions
                          onRefresh={loadLibrary}
                          onLoggedOut={handleLoggedOut}
                        />
                      </ActionPanel>
                    }
                  />
                ))}
              </List.Section>
            )}

          {(filter === "all" || filter === "other") &&
            filteredOther.length > 0 && (
              <List.Section
                title="Other Files"
                subtitle={`${filteredOther.length}`}
              >
                {filteredOther.map((file) => (
                  <List.Item
                    key={`o-${file.account_id}-${file.torrent_id}-${file.file_id}`}
                    title={file.short_name || file.filename}
                    subtitle={file.remote_path || file.mime_type}
                    icon={Icon.Document}
                    accessories={buildOtherFileAccessories(file)}
                    actions={
                      <PlayableActionPanel
                        target={{
                          account_id: file.account_id,
                          torrent_id: file.torrent_id,
                          file_id: file.file_id,
                          title: file.short_name || file.filename,
                        }}
                        completed={file.completed}
                        onRefresh={loadLibrary}
                        onLoggedOut={handleLoggedOut}
                      />
                    }
                  />
                ))}
              </List.Section>
            )}
        </>
      )}
    </List>
  );
}
