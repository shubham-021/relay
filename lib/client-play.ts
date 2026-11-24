import { toast } from "sonner";
import { buildPlayerURL } from "@/lib/players";
import { LOCAL_DAEMON_PLAYERS } from "@/lib/constants";
import { safeParseJson, cleanErrorMessage } from "@/lib/utils";

/**
 * Shared playback orchestration used by FileActions and MoviesGrid.
 * 1. POST /api/cdn-link → { url, playToken }
 * 2. GET  /api/progress  → resume state
 * 3. POST local daemon (/play) with resume info for daemon players,
 *    otherwise fall back to the protocol-handler path.
 */
export async function launchPlayback(params: {
  torrentId: number;
  fileId: number;
  accountId: number;
  playerProtocol: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { torrentId, fileId, accountId, playerProtocol } = params;

  // 1. CDN link + play token
  let cdnUrl: string;
  let playToken: string;
  try {
    const res = await fetch("/api/cdn-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        torrent_id: torrentId,
        file_id: fileId,
        account_id: accountId,
      }),
    });
    const { ok, data, error } = await safeParseJson<{ url?: string; playToken?: string; error?: string }>(
      res,
      "Failed to get CDN link"
    );

    if (!ok || !data?.url || !data?.playToken) {
      const message = res.status === 409
        ? "A CDN request is already in progress"
        : error || "Failed to get CDN link";
      toast.error("Playback failed", { description: cleanErrorMessage(message) });
      return { ok: false, error: message };
    }
    cdnUrl = data.url;
    playToken = data.playToken;
  } catch (err: any) {
    const desc = cleanErrorMessage(err?.message || "Network connection error");
    toast.error("Playback failed", { description: desc });
    return { ok: false, error: desc };
  }

  // 2. Resume state (best-effort; defaults to beginning on any failure)
  let startTime = "00:00";
  try {
    const query = new URLSearchParams({
      account_id: String(accountId),
      torrent_id: String(torrentId),
      file_id: String(fileId),
    });
    const res = await fetch(`/api/progress?${query.toString()}`);
    if (res.ok) {
      const { data: progress } = await safeParseJson(res);
      if (progress) {
        const position = Number(progress.position ?? 0);
        const duration = progress.duration == null ? null : Number(progress.duration);
        const completed = Boolean(progress.completed);
        if (
          !completed &&
          position > 0 &&
          duration != null &&
          duration > 0 &&
          position < duration - 10
        ) {
          startTime = String(Math.floor(position));
        }
      }
    }
  } catch {
    // ignore — start from the beginning
  }

  // 3. Launch
  if (LOCAL_DAEMON_PLAYERS.includes(playerProtocol)) {
    try {
      const daemonRes = await fetch("http://localhost:9070/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player: playerProtocol,
          url: cdnUrl,
          startTime,
          torrent_id: torrentId,
          file_id: fileId,
          account_id: accountId,
          token: playToken,
          reportUrl: `${window.location.origin}/api/progress`,
        }),
      });

      const { ok: daemonOk, error: daemonErr } = await safeParseJson(daemonRes, "Daemon returned error status");

      if (daemonOk) {
        toast.success(`Launched ${playerProtocol.toUpperCase()} via Local Daemon`, {
          description: "CDN stream active",
        });
        return { ok: true };
      }
      throw new Error(daemonErr || "Daemon returned error status");
    } catch (e: any) {
      const isConnError = !e.message || /fetch|failed to fetch|network|refused/i.test(e.message);
      toast.error("Local daemon connection failed", {
        description: isConnError
          ? "Ensure Relay Aemond is running on port 9070 on your machine."
          : cleanErrorMessage(e.message),
      });
      return { ok: false, error: "Local daemon connection failed" };
    }
  }

  // Protocol handler path (potplayer, infuse, etc.)
  const playerUrl = buildPlayerURL(playerProtocol, cdnUrl);
  const link = document.createElement("a");
  link.href = playerUrl;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  toast.success(`Opening in ${playerProtocol.toUpperCase()}`, {
    description: "CDN stream active",
  });
  return { ok: true };
}
