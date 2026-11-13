import { Color, Icon, List, showToast, Toast } from "@raycast/api";
import { useCallback, useEffect, useState } from "react";
import { getCachedArray, getMovies } from "../api";
import type { MovieItem } from "../types";
import { PlayableActionPanel } from "./MediaActions";

interface MoviesListProps {
  onLoggedOut?: () => void | Promise<void>;
}

export function buildMovieAccessories(movie: MovieItem): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [];
  if (movie.completed) {
    accessories.push({
      tag: { value: "Watched", color: Color.Green },
      icon: Icon.CheckCircle,
    });
  } else if (movie.percent > 0) {
    accessories.push({
      tag: { value: `${movie.percent}%`, color: Color.Blue },
    });
  }
  accessories.push({ text: movie.sizeFormatted });
  return accessories;
}

export function MoviesList({ onLoggedOut }: MoviesListProps) {
  const [movies, setMovies] = useState<MovieItem[]>(() =>
    getCachedArray<MovieItem>("movies"),
  );
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const items = await getMovies();
      setMovies(Array.isArray(items) ? items : []);
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to load movies",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <List
      isLoading={isLoading}
      navigationTitle="Movies"
      searchBarPlaceholder="Search movies..."
    >
      {(Array.isArray(movies) ? movies : []).map((movie) => (
        <List.Item
          key={`${movie.account_id}-${movie.torrent_id}-${movie.file_id}`}
          title={movie.title}
          subtitle={movie.year ? String(movie.year) : movie.filename}
          icon={
            movie.poster_url ? { source: movie.poster_url } : Icon.FilmStrip
          }
          keywords={[
            movie.filename,
            movie.short_name,
            movie.year ? String(movie.year) : "",
          ].filter(Boolean)}
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
              onRefresh={load}
              onLoggedOut={onLoggedOut}
            />
          }
        />
      ))}
    </List>
  );
}
