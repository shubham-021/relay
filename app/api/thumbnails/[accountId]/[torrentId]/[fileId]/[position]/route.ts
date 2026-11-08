import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { getSession } from "@/lib/session";
import { verifyUserAccountAccess } from "@/lib/db";

export const dynamic = "force-dynamic";

const THUMBNAILS_DIR = join(process.cwd(), "data", "thumbnails");

export async function GET(
  request: Request,
  { params }: { params: Promise<{ accountId: string; torrentId: string; fileId: string; position: string }> }
) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { accountId: accountIdStr, torrentId: torrentIdStr, fileId: fileIdStr, position: positionStr } = await params;
    const accountId = parseInt(accountIdStr, 10);
    const torrentId = parseInt(torrentIdStr, 10);
    const fileId = parseInt(fileIdStr, 10);
    const position = parseInt(positionStr, 10);

    if (isNaN(accountId) || isNaN(torrentId) || isNaN(fileId) || isNaN(position)) {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    if (position < 1 || position > 5) {
      return NextResponse.json({ error: "Position must be 1-5" }, { status: 400 });
    }

    if (!verifyUserAccountAccess(session.userId, accountId)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const filePath = join(THUMBNAILS_DIR, String(accountId), String(torrentId), String(fileId), `${position}.jpg`);

    try {
      const data = await readFile(filePath);
      return new Response(data, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      return NextResponse.json({ error: "Thumbnail not found" }, { status: 404 });
    }
  } catch (error) {
    console.error("Thumbnail serving error:", error);
    return NextResponse.json({ error: "Failed to serve thumbnail" }, { status: 500 });
  }
}
