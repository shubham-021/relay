import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getAccountsByUserId, verifyUserAccountAccess, updateAccountUpdatedTime } from "@/lib/db";
import { getValidAccessToken, createTorrent } from "@/lib/torbox";
import { processAndInsertFile } from "@/lib/sync";
import { acquireLock, releaseLock } from "@/lib/in-flight";

export const dynamic = "force-dynamic";

interface CachedFilePayload {
  id: number;
  name: string;
  size: number;
  short_name: string;
  mimetype: string;
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { magnet, account_id, add_only_if_cached, cached_files, torrent_hash } = body;

    if (!magnet || typeof magnet !== "string") {
      return NextResponse.json({ error: "Missing 'magnet' link" }, { status: 400 });
    }

    const accounts = getAccountsByUserId(session.userId);
    if (accounts.length === 0) {
      return NextResponse.json({ error: "No TorBox accounts linked" }, { status: 400 });
    }

    let activeAccount = accounts[0];
    if (account_id) {
      const requested = accounts.find(a => a.id === parseInt(account_id, 10));
      if (requested) activeAccount = requested;
    }

    // Verify user has access to this account
    if (!verifyUserAccountAccess(session.userId, activeAccount.id)) {
      return NextResponse.json({ error: "Account access denied" }, { status: 403 });
    }

    const lockKey = `${session.userId}:torrent:create`;
    const controller = acquireLock(lockKey);
    if (!controller) {
      return NextResponse.json({ error: "A torrent is already being added. Please wait for it to complete" }, { status: 409 });
    }

    try {
      const accessToken = await getValidAccessToken(activeAccount.id, controller.signal);
      const result = await createTorrent(
        magnet,
        accessToken,
        add_only_if_cached !== false, // default to true
        controller.signal
      );

      // If we have cached file data from the cache-check step, insert them into DB
      // immediately instead of requiring a full re-sync
      let filesInserted = 0;
      if (
        result.success &&
        result.data?.torrent_id &&
        Array.isArray(cached_files) &&
        cached_files.length > 0
      ) {
        const torrentId = result.data.torrent_id;
        const hash = torrent_hash || result.data.hash || null;

        for (const file of cached_files as CachedFilePayload[]) {
          // Validate each file has required fields
          if (!file || typeof file.id !== "number" || !file.name) continue;

          try {
            const inserted = await processAndInsertFile(
              activeAccount.id,
              torrentId,
              hash,
              {
                id: file.id,
                name: file.name,
                short_name: file.short_name || undefined,
                size: file.size || 0,
                mimetype: file.mimetype || undefined,
              },
              { signal: controller.signal },
            );
            if (inserted) filesInserted++;
          } catch (e) {
            console.error(`Failed to process cached file ${file.id}:`, e);
            // Continue processing remaining files — don't let one failure block others
          }
        }
      }

      if (filesInserted > 0) {
        updateAccountUpdatedTime(activeAccount.id);
      }

      return NextResponse.json({
        ...result,
        files_inserted: filesInserted,
      });
    } finally {
      releaseLock(lockKey, controller);
    }
  } catch (error) {
    console.error("Create torrent error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create torrent" },
      { status: 500 }
    );
  }
}
