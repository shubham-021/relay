import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { verifyUserAccountAccess, deleteRemoteFilesByTorrent } from "@/lib/db";
import { getValidAccessToken, deleteTorrent } from "@/lib/torbox";

const deleteSchema = z.object({
  torrent_id: z.number().int().positive().optional(),
  torrent_ids: z.array(z.number().int().positive()).optional(),
  account_id: z.number().int().positive(),
}).refine(
  (data) => data.torrent_id !== undefined || (data.torrent_ids !== undefined && data.torrent_ids.length > 0),
  { message: "Either torrent_id or torrent_ids must be provided" }
);

export async function DELETE(req: Request) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid request body" },
        { status: 400 }
      );
    }

    const { account_id } = parsed.data;

    // Verify the user owns this account
    if (!verifyUserAccountAccess(session.userId, account_id)) {
      return NextResponse.json({ error: "Account access denied" }, { status: 403 });
    }

    // Collect all torrent IDs to delete
    const torrentIds: number[] = parsed.data.torrent_ids
      ?? (parsed.data.torrent_id ? [parsed.data.torrent_id] : []);

    // Get a valid access token once for all deletions
    const accessToken = await getValidAccessToken(account_id);

    let deleted = 0;
    const errors: string[] = [];

    for (const tid of torrentIds) {
      try {
        await deleteTorrent(tid, accessToken);
        // Clean up local DB — runs in a single transaction
        deleteRemoteFilesByTorrent(account_id, tid);
        deleted++;
      } catch (e: any) {
        console.error(`Failed to delete torrent ${tid}:`, e);
        // If the torrent was already removed or not found on TorBox, clean it up locally
        if (e.message && /not found|already deleted|DATABASE_ERROR/i.test(e.message)) {
          deleteRemoteFilesByTorrent(account_id, tid);
          deleted++;
        } else {
          errors.push(`Torrent ${tid}: ${e.message || "Unknown error"}`);
        }
      }
    }

    if (deleted === 0 && errors.length > 0) {
      return NextResponse.json(
        { error: errors.join("; ") || "Failed to delete torrent(s)", details: errors },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      deleted,
      ...(errors.length > 0 ? { partial_errors: errors } : {}),
    });
  } catch (error) {
    console.error("Torrent delete API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
