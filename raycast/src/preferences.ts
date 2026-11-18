import { getPreferenceValues, LocalStorage } from "@raycast/api";
import fs from "node:fs";
import type {
  ExtensionPreferences,
  PlayerConfig,
  SyncplayConfig,
} from "./types";

const KEY_PLAYER_PATH = "relay.playerPath";
const KEY_PLAYER_ARGS = "relay.playerArgs";
const KEY_RESUME_PLAYBACK = "relay.resumePlayback";

const KEY_SYNCPLAY_PATH = "relay.syncplayPath";
const KEY_SYNCPLAY_SERVER = "relay.syncplayServer";
const KEY_SYNCPLAY_USERNAME = "relay.syncplayUsername";
const KEY_SYNCPLAY_ROOM = "relay.syncplayRoom";
const KEY_SYNCPLAY_PASSWORD = "relay.syncplayPassword";
const KEY_SYNCPLAY_PLAYER_PATH = "relay.syncplayPlayerPath";

export function getServerUrl(): string {
  const prefs = getPreferenceValues<ExtensionPreferences>();
  const raw = (prefs.serverUrl || "https://relay.kshiyo.dpdns.org").trim();
  const normalized = raw.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(normalized)) {
    return normalized.startsWith("localhost") ||
      normalized.startsWith("127.0.0.1")
      ? `http://${normalized}`
      : `https://${normalized}`;
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

export function getDefaultSyncplayPath(): string {
  if (fs.existsSync("/Applications/Syncplay.app/Contents/MacOS/Syncplay")) {
    return "/Applications/Syncplay.app/Contents/MacOS/Syncplay";
  }
  if (fs.existsSync("/Applications/Syncplay.app")) {
    return "/Applications/Syncplay.app";
  }
  return "syncplay";
}

export async function getSyncplayConfig(): Promise<SyncplayConfig> {
  const [
    storedPath,
    storedServer,
    storedUsername,
    storedRoom,
    storedPassword,
    storedPlayerPath,
  ] = await Promise.all([
    LocalStorage.getItem<string>(KEY_SYNCPLAY_PATH),
    LocalStorage.getItem<string>(KEY_SYNCPLAY_SERVER),
    LocalStorage.getItem<string>(KEY_SYNCPLAY_USERNAME),
    LocalStorage.getItem<string>(KEY_SYNCPLAY_ROOM),
    LocalStorage.getItem<string>(KEY_SYNCPLAY_PASSWORD),
    LocalStorage.getItem<string>(KEY_SYNCPLAY_PLAYER_PATH),
  ]);

  return {
    syncplayPath: (storedPath ?? getDefaultSyncplayPath()).trim(),
    server: (storedServer ?? "syncplay.pl:8999").trim(),
    username: (storedUsername ?? "").trim(),
    room: (storedRoom ?? "").trim(),
    password: (storedPassword ?? "").trim(),
    playerPath: (storedPlayerPath ?? "").trim(),
  };
}

export async function saveSyncplayConfig(
  config: SyncplayConfig,
): Promise<void> {
  await Promise.all([
    LocalStorage.setItem(KEY_SYNCPLAY_PATH, config.syncplayPath.trim()),
    LocalStorage.setItem(KEY_SYNCPLAY_SERVER, config.server.trim()),
    LocalStorage.setItem(KEY_SYNCPLAY_USERNAME, config.username.trim()),
    LocalStorage.setItem(KEY_SYNCPLAY_ROOM, config.room.trim()),
    LocalStorage.setItem(KEY_SYNCPLAY_PASSWORD, (config.password ?? "").trim()),
    LocalStorage.setItem(
      KEY_SYNCPLAY_PLAYER_PATH,
      (config.playerPath ?? "").trim(),
    ),
  ]);
}
