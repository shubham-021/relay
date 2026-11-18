"use client";

import { memo } from "react";
import { Tv, Layers, Film } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFileStore } from "@/lib/store";

interface TvShowItem {
  show_title: string;
  tmdb_id?: number;
  poster_url?: string;
  backdrop_url?: string;
  overview?: string;
  season_count: number;
  episode_count: number;
  start_year?: string;
}

interface TvShowsGridProps {
  shows: TvShowItem[];
  isLoading: boolean;
  searchQuery: string;
  onSelectShow: (showTitle: string) => void;
}

export const TvShowsGrid = memo(function TvShowsGrid({ shows, isLoading, searchQuery, onSelectShow }: TvShowsGridProps) {
  const { viewMode } = useFileStore();

  const filtered = shows.filter((s) =>
    s.show_title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className={viewMode === "list" ? "flex flex-col gap-3" : "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"}>
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className={viewMode === "list" ? "h-20 w-full rounded-xl" : "aspect-2/3 rounded-xl"} />
        ))}
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Tv size={48} className="text-muted-foreground/30 mb-2" />
        <p className="text-lg font-medium">No TV shows found</p>
        <p className="text-sm">Sync your account or adjust your search term.</p>
      </div>
    );
  }

  return (
    <div className={viewMode === "list" ? "flex flex-col gap-3" : "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"}>
      {filtered.map((show) => (
        viewMode === "list" ? (
          <div
            key={show.show_title}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSelectShow(show.show_title);
            }}
            onClick={() => onSelectShow(show.show_title)}
            className="navigable-card group flex flex-col sm:flex-row items-stretch sm:items-center gap-4 px-4 py-3 rounded-xl border border-border/40 bg-card/40 hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary focus:outline-none transition-all overflow-hidden relative cursor-pointer"
          >
            {/* Poster Thumbnail */}
            <div className="w-12 h-16 shrink-0 rounded bg-muted/30 overflow-hidden relative border border-border/50">
              {show.poster_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={show.poster_url} alt={show.show_title} className="object-cover w-full h-full" loading="lazy" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <Tv size={20} className="opacity-40" />
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <h3 className="text-sm font-bold tracking-tight text-foreground truncate group-hover:text-primary transition-colors">
                {show.show_title}
              </h3>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1">
                {show.start_year && <span>{show.start_year}</span>}
                {show.start_year && <span className="text-muted-foreground/50">•</span>}
                <span className="flex items-center gap-1"><Layers size={11} className="text-primary/70" /> {show.season_count} {show.season_count === 1 ? "Season" : "Seasons"}</span>
                <span className="text-muted-foreground/50">•</span>
                <span>{show.episode_count} {show.episode_count === 1 ? "Episode" : "Episodes"}</span>
              </div>
            </div>
          </div>
        ) : (
        <Card
          key={show.show_title}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSelectShow(show.show_title);
          }}
          onClick={() => onSelectShow(show.show_title)}
          className="navigable-card group relative cursor-pointer overflow-hidden rounded-xl border-0 bg-black/40 transition-all duration-300 hover:shadow-2xl hover:shadow-primary/20 focus:ring-4 focus:ring-primary focus:outline-none flex flex-col"
        >
          {/* Poster Container */}
          <div className="relative aspect-2/3 w-full overflow-hidden bg-muted/40">
            {show.poster_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={show.poster_url}
                alt={show.show_title}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-muted/50 to-muted/20 text-muted-foreground">
                <Tv size={40} className="opacity-40" />
              </div>
            )}

            {/* Badges */}
            <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
              {show.start_year && (
                <span className="rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-md border border-white/10">
                  {show.start_year}
                </span>
              )}
            </div>

            <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/80 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-md border border-white/10">
              <Layers size={11} className="text-primary" />
              <span>{show.season_count} {show.season_count === 1 ? "Season" : "Seasons"}</span>
            </div>
          </div>

          {/* Info */}
          <div className="p-3 flex flex-col flex-1 justify-between">
            <h3 className="text-sm font-display font-bold tracking-wide text-foreground line-clamp-1 group-hover:text-primary transition-colors">
              {show.show_title}
            </h3>
            <span className="text-[11px] text-muted-foreground mt-1">
              {show.episode_count} {show.episode_count === 1 ? "Episode" : "Episodes"}
            </span>
          </div>
        </Card>
        )
      ))}
    </div>
  );
});
