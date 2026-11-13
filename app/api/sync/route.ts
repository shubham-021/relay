import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { syncAccount } from "@/lib/sync";
import { getAccountById, verifyUserAccountAccess } from "@/lib/db";
import { acquireLock, releaseLock } from "@/lib/in-flight";
import { cleanupOrphanedThumbnailsFromDisk } from "@/lib/thumbnails";

const syncSchema = z.object({
  account_id: z.number().int().positive(),
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

    const { account_id } = parsed.data;

    // Verify account belongs to user
    const account = getAccountById(account_id);
    if (!account || !verifyUserAccountAccess(userId, account_id)) {
      return NextResponse.json({ error: "Account not found or access denied" }, { status: 404 });
    }

    const lockKey = `${userId}:sync`;
    const controller = acquireLock(lockKey);
    if (!controller) {
      return NextResponse.json({ error: "A sync for an account is already in progress." }, { status: 409 });
    }

    try {
      const result = await syncAccount(account_id, controller.signal);
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: 500 }
        );
      }

      // Clean up orphaned thumbnails for files no longer in remote_list_cache
      await cleanupOrphanedThumbnailsFromDisk();

      return NextResponse.json({ success: true, files_synced: result.filesSynced });
    } finally {
      releaseLock(lockKey, controller);
    }
  } catch (error) {
    console.error("Sync API error:", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}