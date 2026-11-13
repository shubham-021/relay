import {
  Action,
  ActionPanel,
  Icon,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useCallback, useEffect, useState } from "react";
import { getCachedArray, getShows } from "../api";
import type { TvShowSummary } from "../types";
import { RelayManagementActions } from "./MediaActions";
import { ShowEpisodesView } from "./ShowEpisodesView";

interface ShowsListProps {
  onLoggedOut?: () => void | Promise<void>;
}

export function buildShowAccessories(
  show: TvShowSummary,
): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [];
  if (show.season_count > 1) {
    accessories.push({ tag: `${show.season_count} Seasons` });
  }
  accessories.push({ text: `${show.episode_count} Episodes` });
  return accessories;
}

export function ShowsList({ onLoggedOut }: ShowsListProps) {
  const { push } = useNavigation();
  const [shows, setShows] = useState<TvShowSummary[]>(() =>
    getCachedArray<TvShowSummary>("shows"),
  );
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const items = await getShows();
      setShows(Array.isArray(items) ? items : []);
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to load TV shows",
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
      navigationTitle="TV Shows"
      searchBarPlaceholder="Search TV shows..."
    >
      {(Array.isArray(shows) ? shows : []).map((show) => (
        <List.Item
          key={show.show_title}
          title={show.show_title}
          subtitle={show.start_year ? String(show.start_year) : undefined}
          icon={show.poster_url ? { source: show.poster_url } : Icon.Monitor}
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
                      onLoggedOut={onLoggedOut}
                    />,
                  )
                }
              />
              <RelayManagementActions
                onRefresh={load}
                onLoggedOut={onLoggedOut}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
