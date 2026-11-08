import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { getOtherFilesForUser } from "@/lib/db";
import { formatBytes } from "@/lib/utils";
import { getLibEtag, validateETag } from "@/lib/library-etag";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const accountIdParam = request.nextUrl.searchParams.get("account_id");
    const accountId = accountIdParam ? parseInt(accountIdParam, 10) : undefined;

    const etag = getLibEtag(session.userId, accountId);
    const notModified = validateETag(request, etag);
    if (notModified) return notModified;

    const rawFiles = getOtherFilesForUser(session.userId, accountId);

    const items = rawFiles.map((row) => ({
      id: row.id,
      account_id: row.account_id,
      torrent_id: row.torrent_id,
      file_id: row.file_id,
      remote_path: row.remote_path,
      filename: row.filename,
      short_name: row.short_name,
      size: row.size,
      sizeFormatted: formatBytes(row.size || 0),
      mime_type: row.mime_type,
      percent: (!row.duration_seconds || row.duration_seconds <= 0) ? 0 : Math.min(100, Math.round((row.position_seconds / row.duration_seconds) * 100)),
      completed: !!row.completed,
      has_thumbnail: !!row.has_thumbnail,
    }));

    return NextResponse.json({ items }, {
      headers: {
        Etag: etag,
        "Cache-Control": "private, no-cache"
      }
    });
  } catch (error) {
    console.error("Other Files API error:", error);
    return NextResponse.json({ error: "Failed to fetch uncategorized files" }, { status: 500 });
  }
}
