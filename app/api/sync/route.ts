import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { syncAccount } from "@/lib/sync";
import { getAccountById, verifyUserAccountAccess } from "@/lib/db";
import { acquireLock, releaseLock } from "@/lib/in-flight";
import { cleanupOrphanedThumbnailsFromDisk } from "@/lib/thumbnails";

const syncSchema = z.object({
  account_id: z.number().int().positive(),
  force_full_sync: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = syncSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid account_id" }, { status: 400 });
    }

    const { account_id, force_full_sync } = parsed.data;

    // Verify account belongs to user
    const account = getAccountById(account_id);
    if (!account || !verifyUserAccountAccess(userId, account_id)) {
      return NextResponse.json({ error: "Account not found or access denied" }, { status: 404 });
    }

    // 1. Account-level lock: only one sync per TorBox account at a time across all users
    const accountLockKey = `account:${account_id}:sync`;
    const accountController = acquireLock(accountLockKey);
    if (!accountController) {
      return NextResponse.json(
        { error: "A sync for this TorBox account is already in progress." },
        { status: 409 }
      );
    }

    // 2. User-level lock: only one heavy sync per user at a time
    const userLockKey = `user:${userId}:sync`;
    const userController = acquireLock(userLockKey);
    if (!userController) {
      releaseLock(accountLockKey, accountController);
      return NextResponse.json(
        { error: "You already have a sync in progress. Please wait for it to complete." },
        { status: 409 }
      );
    }

    try {
      const result = await syncAccount(account_id, {
        forceFullSync: force_full_sync ?? false,
        signal: accountController.signal,
      });
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: 500 }
        );
      }

      // Clean up orphaned thumbnails for files no longer in remote_list_cache
      await cleanupOrphanedThumbnailsFromDisk();

      return NextResponse.json({
        success: true,
        files_synced: result.filesSynced,
        files_added: result.filesAdded ?? 0,
        files_modified: result.filesModified ?? 0,
        files_deleted: result.filesDeleted ?? 0,
      });
    } finally {
      releaseLock(userLockKey, userController);
      releaseLock(accountLockKey, accountController);
    }
  } catch (error) {
    console.error("Sync API error:", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}