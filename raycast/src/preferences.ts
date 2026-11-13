import { getPreferenceValues, LocalStorage } from "@raycast/api";
import type { ExtensionPreferences, PlayerConfig } from "./types";

const KEY_PLAYER_PATH = "relay.playerPath";
const KEY_PLAYER_ARGS = "relay.playerArgs";
const KEY_RESUME_PLAYBACK = "relay.resumePlayback";

export function getServerUrl(): string {
  const prefs = getPreferenceValues<ExtensionPreferences>();
  const raw = (prefs.serverUrl || "http://localhost:9069").trim();
  const normalized = raw.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(normalized)) {
    return `http://${normalized}`;
  }
  return normalized;
}

export async function getPlayerConfig(): Promise<PlayerConfig> {
  const prefs = getPreferenceValues<ExtensionPreferences>();
  const [storedPath, storedArgs, storedResume] = await Promise.all([
    LocalStorage.getItem<string>(KEY_PLAYER_PATH),
    LocalStorage.getItem<string>(KEY_PLAYER_ARGS),
    LocalStorage.getItem<string>(KEY_RESUME_PLAYBACK),
  ]);

  const playerPath = (storedPath ?? prefs.playerPath ?? "").trim();
  const playerArgs = (storedArgs ?? prefs.playerArgs ?? "").trim();
  const resumePlayback =
    storedResume !== undefined
      ? storedResume === "true"
      : (prefs.resumePlayback ?? true);

  return {
    playerPath,
    playerArgs,
    resumePlayback,
  };
}

export async function savePlayerConfig(config: PlayerConfig): Promise<void> {
  await Promise.all([
    LocalStorage.setItem(KEY_PLAYER_PATH, config.playerPath.trim()),
    LocalStorage.setItem(KEY_PLAYER_ARGS, config.playerArgs.trim()),
    LocalStorage.setItem(KEY_RESUME_PLAYBACK, String(config.resumePlayback)),
  ]);
}
