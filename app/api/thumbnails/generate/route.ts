import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { acquireLock, releaseLock } from "@/lib/in-flight";
import { generateAllThumbnails } from "@/lib/thumbnails";
import { getAccountsByUserId, updateAccountUpdatedTime } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const lockKey = `${session.userId}:thumbnails`;
    const controller = acquireLock(lockKey);
    if (!controller) {
      return NextResponse.json(
        { error: "Thumbnail generation already in progress" },
        { status: 409 }
      );
    }

    try {
      const accounts = getAccountsByUserId(session.userId);
      if (!accounts || accounts.length === 0) {
         return NextResponse.json({ error: "No accounts found" }, { status: 400 });
      }

      let totalGenerated = 0;
      let totalSkipped = 0;
      let totalFailed = 0;
      const allErrors: string[] = [];

      for (const account of accounts) {
        if (controller.signal.aborted) break;
        const result = await generateAllThumbnails(account.id, controller.signal);
        if (result.generated > 0) {
          updateAccountUpdatedTime(account.id);
        }
        totalGenerated += result.generated;
        totalSkipped += result.skipped;
        totalFailed += result.failed;
        allErrors.push(...result.errors);
      }

      return NextResponse.json({
        success: true,
        generated: totalGenerated,
        skipped: totalSkipped,
        failed: totalFailed,
        errors: allErrors,
      });
    } finally {
      releaseLock(lockKey, controller);
    }
  } catch (error) {
    console.error("Thumbnail generation API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Thumbnail generation failed" },
      { status: 500 }
    );
  }
}
