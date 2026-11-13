import {
  Clipboard,
  environment,
  showHUD,
  showToast,
  Toast,
} from "@raycast/api";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchCdnLink, fetchProgress } from "./api";
import { getAccessToken } from "./oauth";
import { getPlayerConfig, getServerUrl } from "./preferences";
import type { PlayableTarget, PlayerConfig } from "./types";

let isRequestInFlight = false;

export function normalizePlayerPath(rawPath: string): string {
  let cleaned = rawPath.trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (cleaned === "~") {
    return os.homedir();
  }
  if (cleaned.startsWith("~/")) {
    return path.join(os.homedir(), cleaned.slice(2));
  }
  return cleaned;
}

export function validatePlayerPath(rawPath: string): {
  valid: boolean;
  resolved: string;
  error?: string;
} {
  const resolved = normalizePlayerPath(rawPath);
  if (!resolved) {
    return { valid: false, resolved, error: "Player path is required." };
  }
  if (!fs.existsSync(resolved)) {
    return {
      valid: false,
      resolved,
      error: `No file or app found at: ${resolved}`,
    };
  }
  return { valid: true, resolved };
}

function splitArgs(input: string): string[] {
  const args: string[] = [];
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    args.push(match[1] ?? match[2] ?? match[0]);
  }
  return args;
}

function getResumeFlag(
  binaryPath: string,
  startSeconds: number,
): string | null {
  if (startSeconds <= 0) return null;
  const binName = path.basename(binaryPath).toLowerCase();
  if (binName.includes("iina-cli")) {
    return `--mpv-start=${startSeconds}`;
  }
  if (binName === "mpv") {
    return `--start=${startSeconds}`;
  }
  if (binName.includes("vlc")) {
    return `--start-time=${startSeconds}`;
  }
  return null;
}

function formatTimestamp(totalSeconds: number): string {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}

async function spawnDetached(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });

    const onError = (err: Error) => {
      reject(err);
    };

    child.once("error", onError);
    // Give Node one tick to catch immediate ENOENT/EACCES spawn failures before unref'ing.
    setImmediate(() => {
      child.off("error", onError);
      child.unref();
      resolve();
    });
  });
}

function buildCliArgs(
  extraArgsRaw: string,
  cdnUrl: string,
  resumeFlag: string | null,
): string[] {
  const extra = extraArgsRaw ? splitArgs(extraArgsRaw) : [];
  let urlInjected = false;
  const mappedExtra = extra.map((arg) => {
    if (arg.includes("{url}")) {
      urlInjected = true;
      return arg.replaceAll("{url}", cdnUrl);
    }
    return arg;
  });

  const args: string[] = [];
  if (resumeFlag) {
    args.push(resumeFlag);
  }
  args.push(...mappedExtra);
  if (!urlInjected) {
    args.push(cdnUrl);
  }
  return args;
}

function buildMpvSocketPath(torrentId?: number, fileId?: number): string {
  const rand = Math.random().toString(36).slice(2, 8);
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\mpv_relay_${torrentId ?? "x"}_${fileId ?? "x"}_${rand}`;
  }
  return `/tmp/mpv_relay_${torrentId ?? "x"}_${fileId ?? "x"}_${rand}.sock`;
}

function detectMpvSupport(resolvedPath: string): {
  supported: boolean;
  isIina: boolean;
} {
  const lower = resolvedPath.toLowerCase();
  const base = path.basename(lower, ".app");
  if (base === "mpv" || base.includes("mpv")) {
    return { supported: true, isIina: false };
  }
  if (base.includes("iina")) {
    return { supported: true, isIina: true };
  }
  return { supported: false, isIina: false };
}

function findNodeBinary(): string {
  if (
    process.execPath &&
    path.basename(process.execPath).toLowerCase().includes("node")
  ) {
    return process.execPath;
  }
  const candidates = [
    "/usr/local/bin/node",
    "/opt/homebrew/bin/node",
    path.join(os.homedir(), ".bun/bin/bun"),
    "node",
  ];
  for (const candidate of candidates) {
    if (candidate === "node" || fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return "node";
}

function spawnMpvWatcher(
  socketPath: string,
  reportUrl: string,
  playToken: string,
  bearerToken?: string,
): void {
  const scriptCandidates = [
    path.join(environment.assetsPath, "mpv-watcher.mjs"),
    path.resolve(__dirname, "assets/mpv-watcher.mjs"),
    path.resolve(__dirname, "../assets/mpv-watcher.mjs"),
  ];
  const scriptPath = scriptCandidates.find((p) => fs.existsSync(p));
  if (!scriptPath) {
    console.error("Watcher script not found in:", scriptCandidates);
    return;
  }

  // Remove any stale socket at this path before player starts
  try {
    fs.rmSync(socketPath, { force: true });
  } catch {
    // ignore
  }

  const nodeBin = findNodeBinary();
  const args = [scriptPath, socketPath, reportUrl, playToken];
  if (bearerToken) {
    args.push(bearerToken);
  }

  const watcher = spawn(nodeBin, args, {
    detached: true,
    stdio: "ignore",
  });

  watcher.on("error", (err) => {
    console.error("Failed to spawn mpv watcher:", err);
  });

  watcher.unref();
}

export async function launchInConfiguredPlayer(
  target: PlayableTarget,
  overrideConfig?: PlayerConfig,
): Promise<"launched" | "needs_config" | "busy" | "error"> {
  if (isRequestInFlight) {
    await showToast({
      style: Toast.Style.Failure,
      title: "CDN request already in progress",
    });
    return "busy";
  }

  const config = overrideConfig ?? (await getPlayerConfig());
  if (!config.playerPath) {
    return "needs_config";
  }

  const validation = validatePlayerPath(config.playerPath);
  if (!validation.valid) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Invalid player path",
      message: validation.error,
    });
    return "needs_config";
  }

  isRequestInFlight = true;
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Fetching CDN link...",
    message: target.title,
  });

  try {
    const { url, playToken } = await fetchCdnLink(target);
    const reportUrl = `${getServerUrl()}/api/progress`;
    const bearerToken = await getAccessToken().catch(() => undefined);

    let startSeconds = 0;
    if (config.resumePlayback) {
      const progress = await fetchProgress(target);
      if (
        progress &&
        !progress.completed &&
        progress.position > 0 &&
        progress.duration != null &&
        progress.duration > 0 &&
        progress.position < progress.duration - 10
      ) {
        startSeconds = Math.floor(progress.position);
      }
    }

    const resolvedPath = validation.resolved;
    const isAppBundle = resolvedPath.toLowerCase().endsWith(".app");
    const playerName = path.basename(resolvedPath, ".app");

    const mpvSupport = detectMpvSupport(resolvedPath);
    let socketPath: string | undefined;
    if (mpvSupport.supported && playToken) {
      socketPath = buildMpvSocketPath(target.torrent_id, target.file_id);
    }

    if (isAppBundle) {
      const extraArgs = config.playerArgs
        ? splitArgs(config.playerArgs).map((a) => a.replaceAll("{url}", url))
        : [];
      if (socketPath) {
        if (mpvSupport.isIina) {
          extraArgs.push(`--mpv-input-ipc-server=${socketPath}`);
        } else {
          extraArgs.push(`--input-ipc-server=${socketPath}`);
        }
      }
      const openArgs = ["-a", resolvedPath, url];
      if (extraArgs.length > 0) {
        openArgs.push("--args", ...extraArgs);
      }
      await spawnDetached("open", openArgs);
      if (socketPath && playToken) {
        spawnMpvWatcher(socketPath, reportUrl, playToken, bearerToken);
      }
      await toast.hide();
      await showHUD(`Playing "${target.title}" in ${playerName}`);
      return "launched";
    }

    const resumeFlag = getResumeFlag(resolvedPath, startSeconds);
    const cliArgs = buildCliArgs(config.playerArgs, url, resumeFlag);
    if (socketPath) {
      if (mpvSupport.isIina) {
        cliArgs.unshift(`--mpv-input-ipc-server=${socketPath}`);
      } else {
        cliArgs.unshift(`--input-ipc-server=${socketPath}`);
      }
    }
    await spawnDetached(resolvedPath, cliArgs);
    if (socketPath && playToken) {
      spawnMpvWatcher(socketPath, reportUrl, playToken, bearerToken);
    }

    await toast.hide();
    const resumeSuffix = resumeFlag
      ? ` (from ${formatTimestamp(startSeconds)})`
      : "";
    await showHUD(`Playing "${target.title}" in ${playerName}${resumeSuffix}`);
    return "launched";
  } catch (err) {
    toast.style = Toast.Style.Failure;
    toast.title = "Playback failed";
    toast.message = err instanceof Error ? err.message : String(err);
    return "error";
  } finally {
    isRequestInFlight = false;
  }
}

export async function copyCdnLink(target: PlayableTarget): Promise<void> {
  if (isRequestInFlight) {
    await showToast({
      style: Toast.Style.Failure,
      title: "CDN request already in progress",
    });
    return;
  }

  isRequestInFlight = true;
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Fetching CDN link...",
    message: target.title,
  });

  try {
    const { url } = await fetchCdnLink(target);
    await Clipboard.copy(url);
    toast.style = Toast.Style.Success;
    toast.title = "CDN link copied";
    toast.message = target.title;
  } catch (err) {
    toast.style = Toast.Style.Failure;
    toast.title = "Failed to fetch CDN link";
    toast.message = err instanceof Error ? err.message : String(err);
  } finally {
    isRequestInFlight = false;
  }
}
