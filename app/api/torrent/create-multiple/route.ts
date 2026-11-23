import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getAccountsByUserId, verifyUserAccountAccess } from "@/lib/db";
import { getValidAccessToken, createTorrent } from "@/lib/torbox";
import { acquireLock, releaseLock } from "@/lib/in-flight";
import { parseMediaFilename } from "@/lib/parser";
import { isVideoFile } from "@/lib/sync";

export const dynamic = "force-dynamic";

interface CachedFilePayload {
  id: number;
  name: string;
  size: number;
  short_name: string;
  mimetype: string;
}

interface AccountResult {
  account_id: number;
  success: boolean;
  files_inserted?: number;
  torrent_id?: number;
  error?: string;
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { magnet, account_ids, add_only_if_cached, cached_files, torrent_hash } = body;

    if (!magnet || typeof magnet !== "string") {
      return NextResponse.json({ error: "Missing 'magnet' link" }, { status: 400 });
    }

    if (!Array.isArray(account_ids) || account_ids.length === 0) {
      return NextResponse.json({ error: "Missing 'account_ids' array" }, { status: 400 });
    }

    const accounts = getAccountsByUserId(session.userId);
    if (accounts.length === 0) {
      return NextResponse.json({ error: "No TorBox accounts linked" }, { status: 400 });
    }

    // Validate all requested account IDs belong to this user
    const requestedIds: number[] = account_ids.map((id: any) => parseInt(id, 10));
    for (const id of requestedIds) {
      if (!verifyUserAccountAccess(session.userId, id)) {
        return NextResponse.json({ error: `Account access denied for account ${id}` }, { status: 403 });
      }
    }

    const lockKey = `${session.userId}:torrent:create`;
    const controller = acquireLock(lockKey);
    if (!controller) {
      return NextResponse.json(
        { error: "A torrent is already being added. Please wait for it to complete" },
        { status: 409 }
      );
    }

    try {
      const results: AccountResult[] = [];

      for (const accountId of requestedIds) {
        try {
          const accessToken = await getValidAccessToken(accountId, controller.signal);
          const result = await createTorrent(
            magnet,
            accessToken,
            add_only_if_cached !== false, // default to true
            controller.signal
          );

          results.push({
            account_id: accountId,
            success: result.success,
            torrent_id: result.data?.torrent_id,
            error: !result.success
              ? ((result as any).detail || (result as any).error || "TorBox rejected addition")
              : undefined,
          });
        } catch (e) {
          results.push({
            account_id: accountId,
            success: false,
            error: e instanceof Error ? e.message : `Failed for account ${accountId}`,
          });
        }
      }

      const allSucceeded = results.every(r => r.success);
      const anySucceeded = results.some(r => r.success);

      if (anySucceeded && Array.isArray(cached_files) && cached_files.length > 0) {
        const firstVideo =
          (cached_files as CachedFilePayload[]).find(f => isVideoFile(f.name, f.mimetype)) ||
          cached_files[0];
        const filename = firstVideo
          ? (firstVideo.short_name || firstVideo.name.split("/").pop() || firstVideo.name)
          : "Media";
        const parsed = parseMediaFilename(filename);

        return NextResponse.json({
          success: true,
          status: "action_needed",
          results,
          torrent_hash: torrent_hash || null,
          torrent_name: filename,
          cached_files: cached_files,
          parsed_title: parsed.title,
          parsed_year: parsed.year || null,
          detected_category: parsed.mediaType === "tv" ? "tv" : "movie",
        });
      }

      return NextResponse.json({
        success: anySucceeded,
        total_inserted: 0,
        results,
        status: allSucceeded ? "completed" : anySucceeded ? "partial" : "failed",
      });
    } finally {
      releaseLock(lockKey, controller);
    }
  } catch (error) {
    console.error("Create torrent (multiple) error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create torrent" },
      { status: 500 }
    );
  }
}
