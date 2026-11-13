import { Color, Icon, List, showToast, Toast } from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getCachedData, getShowDetails } from "../api";
import type { TvEpisode, TvShowDetailResponse } from "../types";
import { PlayableActionPanel } from "./MediaActions";

interface ShowEpisodesViewProps {
  showTitle: string;
  onLoggedOut?: () => void | Promise<void>;
}

function formatEpisodeCode(ep: TvEpisode): string {
  const s = String(ep.season_number ?? 1).padStart(2, "0");
  if (ep.episode_number == null) {
    return `S${s}`;
  }
  const e = String(ep.episode_number).padStart(2, "0");
  if (
    ep.episode_end_number != null &&
    ep.episode_end_number !== ep.episode_number
  ) {
    const end = String(ep.episode_end_number).padStart(2, "0");
    return `S${s}E${e}-E${end}`;
  }
  return `S${s}E${e}`;
}

function buildEpisodeAccessories(ep: TvEpisode): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [];
  if (ep.completed) {
    accessories.push({
      tag: { value: "Watched", color: Color.Green },
      icon: Icon.CheckCircle,
    });
  } else if (ep.percent > 0) {
    accessories.push({ tag: { value: `${ep.percent}%`, color: Color.Blue } });
  }
  accessories.push({ text: ep.sizeFormatted });
  return accessories;
}

export function ShowEpisodesView({
  showTitle,
  onLoggedOut,
}: ShowEpisodesViewProps) {
  const [detail, setDetail] = useState<TvShowDetailResponse | undefined>(() =>
    getCachedData<TvShowDetailResponse>(`show:${showTitle}`),
  );
  const [selectedSeason, setSelectedSeason] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getShowDetails(showTitle);
      setDetail(data);
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to load episodes",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsLoading(false);
    }
  }, [showTitle]);

  useEffect(() => {
    void load();
  }, [load]);

  const seasons = Array.isArray(detail?.seasons) ? detail.seasons : [];
  const hasMultipleSeasons = seasons.length > 1;

  const visibleSeasons = useMemo(() => {
    if (!hasMultipleSeasons || selectedSeason === "all") {
      return seasons;
    }
    const seasonNum = Number(selectedSeason);
    return seasons.filter((s) => s.seasonNumber === seasonNum);
  }, [hasMultipleSeasons, seasons, selectedSeason]);

  const renderEpisodeItem = (ep: TvEpisode) => {
    const code = formatEpisodeCode(ep);
    const fullTitle = `${showTitle} ${code} - ${ep.episode_title}`;
    return (
      <List.Item
        key={`${ep.account_id}-${ep.torrent_id}-${ep.file_id}`}
        title={`${code} · ${ep.episode_title}`}
        subtitle={ep.filename}
        icon={ep.still_url ? { source: ep.still_url } : Icon.Video}
        keywords={[
          code,
          `Season ${ep.season_number}`,
          `S${ep.season_number}`,
          ep.episode_title,
          ep.filename,
          ep.short_name,
        ].filter(Boolean)}
        accessories={buildEpisodeAccessories(ep)}
        actions={
          <PlayableActionPanel
            target={{
              account_id: ep.account_id,
              torrent_id: ep.torrent_id,
              file_id: ep.file_id,
              title: fullTitle,
            }}
            completed={ep.completed}
            onRefresh={load}
            onLoggedOut={onLoggedOut}
          />
        }
      />
    );
  };

  return (
    <List
      isLoading={isLoading}
      navigationTitle={detail?.show.showTitle ?? showTitle}
      searchBarPlaceholder="Search episodes..."
      searchBarAccessory={
        hasMultipleSeasons ? (
          <List.Dropdown
            tooltip="Filter by Season"
            value={selectedSeason}
            onChange={setSelectedSeason}
          >
            <List.Dropdown.Item title="All Seasons" value="all" />
            {seasons.map((s) => (
              <List.Dropdown.Item
                key={s.seasonNumber}
                title={`Season ${s.seasonNumber} (${s.episodes.length})`}
                value={String(s.seasonNumber)}
              />
            ))}
          </List.Dropdown>
        ) : undefined
      }
    >
      {visibleSeasons.map((season) =>
        hasMultipleSeasons ? (
          <List.Section
            key={season.seasonNumber}
            title={`Season ${season.seasonNumber}`}
            subtitle={`${season.episodes.length} episodes`}
          >
            {season.episodes.map(renderEpisodeItem)}
          </List.Section>
        ) : (
          season.episodes.map(renderEpisodeItem)
        ),
      )}
    </List>
  );
}
