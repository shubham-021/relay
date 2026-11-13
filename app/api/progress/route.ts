import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { getWatchedPosition, upsertWatchedPosition } from "@/lib/db";
import { verifyPlayToken } from "@/lib/crypto";

export const dynamic = "force-dynamic";

const progressSchema = z.object({
  token: z.string().min(1),
  position: z.number().nonnegative(),
  duration: z.number().nonnegative().nullable().optional(),
  completed: z.boolean(),
});

export async function GET(request: Request) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const accountId = parseInt(searchParams.get("account_id") || "", 10);
    const torrentId = parseInt(searchParams.get("torrent_id") || "", 10);
    const fileId = parseInt(searchParams.get("file_id") || "", 10);

    if (Number.isNaN(accountId) || Number.isNaN(torrentId) || Number.isNaN(fileId)) {
      return NextResponse.json(
        { error: "account_id, torrent_id and file_id query params are required" },
        { status: 400 }
      );
    }

    const row = getWatchedPosition(userId, accountId, torrentId, fileId);
    if (!row) {
      return NextResponse.json({ position: 0, duration: null, completed: false });
    }

    return NextResponse.json({
      position: row.position_seconds ?? 0,
      duration: row.duration_seconds ?? null,
      completed: !!row.completed,
    });
  } catch (error) {
    console.error("Progress GET error:", error);
    return NextResponse.json(
      { error: "Failed to get progress" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const parsed = progressSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { token, position, duration, completed } = parsed.data;
    const payload = verifyPlayToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    const withinLastMinute =
      duration != null && duration > 0 && position >= duration - 60;
    const isCompleted = completed || withinLastMinute;

    upsertWatchedPosition(
      payload.userId,
      payload.accountId,
      payload.torrentId,
      payload.fileId,
      position,
      duration ?? null,
      isCompleted
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Progress POST error:", error);
    return NextResponse.json(
      { error: "Failed to save progress" },
      { status: 500 }
    );
  }
}
