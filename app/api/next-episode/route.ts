import { NextResponse } from "next/server";
import { z } from "zod";
import {
  findNextEpisodeForFile,
  getWatchedPosition,
  verifyUserAccountAccess,
} from "@/lib/db";
import { mintPlayToken, verifyPlayToken } from "@/lib/crypto";
import { getValidAccessToken, requestCdnLink } from "@/lib/torbox";
import { acquireLock, releaseLock } from "@/lib/in-flight";

export const dynamic = "force-dynamic";

const nextEpisodeSchema = z.object({
  token: z.string().min(1),
});

// Called by the mpv webdoma_next.lua overlay: resolves "what episode comes
// after the file named by this play token", mints a CDN link + fresh token
// for it, and returns the resume start time. Auth is the HMAC play token
// alone (no cookie). Never logs token or url.
export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const parsed = nextEpisodeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const payload = verifyPlayToken(parsed.data.token);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    const next = findNextEpisodeForFile(
      payload.userId,
      payload.accountId,
      payload.torrentId,
      payload.fileId
    );
    if (!next) {
      // Movie, non-TV, or last episode of the show
      return NextResponse.json({ next: null });
    }

    // The next file may live on a different account — verify access to it
    if (!verifyUserAccountAccess(payload.userId, next.account_id)) {
      return NextResponse.json(
        { error: "Account not found or access denied" },
        { status: 404 }
      );
    }

    // SAME lock key as cdn-link — serializes TorBox CDN mints per user.
    // The Lua overlay retries 409 once after ~1.5s.
    const lockKey = `${payload.userId}:cdn`;
    const controller = acquireLock(lockKey);
    if (!controller) {
      return NextResponse.json(
        { error: "A CDN link request is already in progress" },
        { status: 409 }
      );
    }

    try {
      let accessToken: string;
      try {
        accessToken = await getValidAccessToken(next.account_id, controller.signal);
      } catch (e) {
        const message = e instanceof Error && e.message ? e.message : "Failed to authenticate with TorBox";
        return NextResponse.json({ error: message }, { status: 502 });
      }

      let cdnUrl: string;
      try {
        cdnUrl = await requestCdnLink(
          next.torrent_id,
          next.file_id,
          accessToken,
          controller.signal
        );
      } catch (e) {
        const message = e instanceof Error && e.message ? e.message : "Failed to generate CDN link";
        return NextResponse.json({ error: message }, { status: 502 });
      }

      const playToken = mintPlayToken({
        userId: payload.userId,
        accountId: next.account_id, // may differ from the requesting token's
        torrentId: next.torrent_id,
        fileId: next.file_id,
      });

      // Resume rule — mirrors lib/client-play.ts:60-70 exactly
      let startTime = "00:00";
      const watched = getWatchedPosition(
        payload.userId,
        next.account_id,
        next.torrent_id,
        next.file_id
      );
      if (watched) {
        const position = Number(watched.position_seconds ?? 0);
        const duration =
          watched.duration_seconds == null ? null : Number(watched.duration_seconds);
        const completed = Boolean(watched.completed);
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

      const episode: Record<string, unknown> = {
        url: cdnUrl,
        token: playToken,
        startTime,
        season_number: next.season_number,
        episode_number: next.episode_number,
        filename: next.filename,
      };
      if (next.episode_title) episode.episode_title = next.episode_title;

      return NextResponse.json({ next: episode });
    } finally {
      releaseLock(lockKey, controller);
    }
  } catch (error) {
    console.error("Next episode error:", error);
    return NextResponse.json(
      { error: "Failed to resolve next episode" },
      { status: 500 }
    );
  }
}
