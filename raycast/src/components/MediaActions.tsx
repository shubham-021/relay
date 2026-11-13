import {
  Action,
  ActionPanel,
  Icon,
  openExtensionPreferences,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { clearLibraryCache, markAsWatched, syncAllAccounts } from "../api";
import { clearAuthTokens } from "../oauth";
import { copyCdnLink, launchInConfiguredPlayer } from "../player";
import type { PlayableTarget } from "../types";
import { ConfigurePlayerForm } from "./ConfigurePlayerForm";

interface ManagementActionsProps {
  onRefresh?: () => void | Promise<void>;
  onLoggedOut?: () => void | Promise<void>;
}

export function RelayManagementActions({
  onRefresh,
  onLoggedOut,
}: ManagementActionsProps) {
  const { push } = useNavigation();

  async function handleSync() {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Syncing TorBox library...",
    });
    try {
      const count = await syncAllAccounts();
      toast.style = Toast.Style.Success;
      toast.title = "Library synced";
      toast.message = `${count} files indexed`;
      if (onRefresh) {
        await onRefresh();
      }
    } catch (err) {
      toast.style = Toast.Style.Failure;
      toast.title = "Sync failed";
      toast.message = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleLogout() {
    await clearAuthTokens();
    clearLibraryCache();
    await showToast({
      style: Toast.Style.Success,
      title: "Signed out of Relay",
    });
    if (onLoggedOut) {
      await onLoggedOut();
    }
  }

  return (
    <ActionPanel.Section title="Relay">
      {onRefresh && (
        <Action
          title="Refresh"
          icon={Icon.ArrowClockwise}
          shortcut={{ modifiers: ["cmd"], key: "r" }}
          onAction={onRefresh}
        />
      )}
      <Action
        title="Configure Player"
        icon={Icon.Video}
        shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
        onAction={() => push(<ConfigurePlayerForm />)}
      />
      <Action
        title="Sync TorBox Library"
        icon={Icon.Cloud}
        shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
        onAction={handleSync}
      />
      <Action
        title="Extension Preferences"
        icon={Icon.Gear}
        shortcut={{ modifiers: ["cmd", "shift"], key: "," }}
        onAction={openExtensionPreferences}
      />
      <Action
        title="Sign Out"
        icon={Icon.Logout}
        style={Action.Style.Destructive}
        onAction={handleLogout}
      />
    </ActionPanel.Section>
  );
}

interface PlayableActionPanelProps {
  target: PlayableTarget;
  completed?: boolean;
  onRefresh?: () => void | Promise<void>;
  onLoggedOut?: () => void | Promise<void>;
}

export function PlayableActionPanel({
  target,
  completed,
  onRefresh,
  onLoggedOut,
}: PlayableActionPanelProps) {
  const { push } = useNavigation();

  async function handlePlay() {
    const result = await launchInConfiguredPlayer(target);
    if (result === "needs_config") {
      push(
        <ConfigurePlayerForm
          onConfigured={async (config) => {
            await launchInConfiguredPlayer(target, config);
          }}
        />,
      );
    }
  }

  async function handleMarkWatched() {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Marking as watched...",
    });
    try {
      await markAsWatched(target);
      clearLibraryCache();
      toast.style = Toast.Style.Success;
      toast.title = "Marked as watched";
      if (onRefresh) {
        await onRefresh();
      }
    } catch (err) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to mark as watched";
      toast.message = err instanceof Error ? err.message : String(err);
    }
  }

  return (
    <ActionPanel>
      <ActionPanel.Section>
        <Action
          title="Play in Configured Player"
          icon={Icon.Play}
          onAction={handlePlay}
        />
        <Action
          title="Copy CDN Link"
          icon={Icon.Link}
          shortcut={{ modifiers: ["cmd"], key: "c" }}
          onAction={() => copyCdnLink(target)}
        />
        {!completed && (
          <Action
            title="Mark as Watched"
            icon={Icon.CheckCircle}
            shortcut={{ modifiers: ["cmd", "shift"], key: "w" }}
            onAction={handleMarkWatched}
          />
        )}
      </ActionPanel.Section>
      <RelayManagementActions onRefresh={onRefresh} onLoggedOut={onLoggedOut} />
    </ActionPanel>
  );
}
