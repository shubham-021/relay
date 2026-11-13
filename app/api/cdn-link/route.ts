import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { verifyUserAccountAccess } from "@/lib/db";
import { getValidAccessToken, requestCdnLink } from "@/lib/torbox";
import { mintPlayToken } from "@/lib/crypto";
import { acquireLock, releaseLock } from "@/lib/in-flight";

const cdnLinkSchema = z.object({
  torrent_id: z.number().int().nonnegative(),
  file_id: z.number().int().nonnegative(),
  account_id: z.number().int().positive(),
});

export async function POST(request: Request) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const parsed = cdnLinkSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { torrent_id, file_id, account_id } = parsed.data;

    // Verify the user owns this account
    if (!verifyUserAccountAccess(userId, account_id)) {
      return NextResponse.json(
        { error: "Account not found or access denied" },
        { status: 404 }
      );
    }

    const lockKey = `${userId}:cdn`;
    const controller = acquireLock(lockKey);
    if (!controller) {
      return NextResponse.json({ error: "A CDN link request is already in progress" }, { status: 409 });
    }

    try {
      // Get a valid access token (auto-refreshes if expired)
      let accessToken: string;
      try {
        accessToken = await getValidAccessToken(account_id, controller.signal);
      } catch (e: any) {
        return NextResponse.json(
          { error: e.message || "Failed to authenticate with TorBox" },
          { status: 502 }
        );
      }

      // Request CDN download link
      let cdnUrl: string;
      try {
        cdnUrl = await requestCdnLink(torrent_id, file_id, accessToken, controller.signal);
      } catch (e: any) {
        return NextResponse.json(
          { error: e.message || "Failed to generate CDN link" },
          { status: 502 }
        );
      }

      // Mint a short-lived HMAC token so the local daemon can report playback
      // progress back to /api/progress (runs after ownership was verified above).
      const playToken = mintPlayToken({
        userId,
        accountId: account_id,
        torrentId: torrent_id,
        fileId: file_id,
      });

      return NextResponse.json({ success: true, url: cdnUrl, playToken });
    } finally {
      releaseLock(lockKey, controller);
    }
  } catch (error) {
    console.error("CDN link error:", error);
    return NextResponse.json(
      { error: "Failed to generate CDN link" },
      { status: 500 }
    );
  }
}
