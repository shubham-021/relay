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

interface AccountResult {
  account_id: number;
  success: boolean;
  files_inserted: number;
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
    const { magnet, account_ids, add_only_if_cached, cached_files, torrent_hash, metadata_hints } = body;

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
      let totalInserted = 0;

      for (const accountId of requestedIds) {
        try {
          const accessToken = await getValidAccessToken(accountId, controller.signal);
          const result = await createTorrent(
            magnet,
            accessToken,
            add_only_if_cached !== false, // default to true
            controller.signal
          );

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
              if (!file || typeof file.id !== "number" || !file.name) continue;

              try {
                const inserted = await processAndInsertFile(
                  accountId,
                  torrentId,
                  hash,
                  {
                    id: file.id,
                    name: file.name,
                    short_name: file.short_name || undefined,
                    size: file.size || 0,
                    mimetype: file.mimetype || undefined,
                  },
                  { signal: controller.signal, metadataHints: metadata_hints },
                );
                if (inserted) filesInserted++;
              } catch (e) {
                console.error(`Failed to process cached file ${file.id} for account ${accountId}:`, e);
              }
            }
          }

          if (filesInserted > 0) {
            updateAccountUpdatedTime(accountId);
          }

          totalInserted += filesInserted;
          results.push({
            account_id: accountId,
            success: result.success,
            files_inserted: filesInserted,
            torrent_id: result.data?.torrent_id,
            error: !result.success
              ? ((result as any).detail || (result as any).error || "TorBox rejected addition")
              : undefined,
          });
        } catch (e) {
          results.push({
            account_id: accountId,
            success: false,
            files_inserted: 0,
            error: e instanceof Error ? e.message : `Failed for account ${accountId}`,
          });
        }
      }

      const allSucceeded = results.every(r => r.success);
      const anySucceeded = results.some(r => r.success);

      return NextResponse.json({
        success: anySucceeded,
        total_inserted: totalInserted,
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
