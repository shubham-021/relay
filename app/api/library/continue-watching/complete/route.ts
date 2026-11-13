import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { verifyUserAccountAccess, upsertWatchedPosition } from "@/lib/db";

export const dynamic = "force-dynamic";

const completeSchema = z.object({
  account_id: z.number().int().positive(),
  torrent_id: z.number().int().nonnegative(),
  file_id: z.number().int().nonnegative(),
});

export async function POST(request: Request) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = completeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { account_id, torrent_id, file_id } = parsed.data;

    if (!verifyUserAccountAccess(userId, account_id)) {
      return NextResponse.json(
        { error: "Account not found or access denied" },
        { status: 403 }
      );
    }

    upsertWatchedPosition(userId, account_id, torrent_id, file_id, 0, null, true);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Continue watching complete error:", error);
    return NextResponse.json(
      { error: "Failed to mark as watched" },
      { status: 500 }
    );
  }
}
