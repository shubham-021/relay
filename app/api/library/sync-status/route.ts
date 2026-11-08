import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getAccountsByUserId } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const session = await getSession();
        if (!session.userId) {
            return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
        }

        const accounts = getAccountsByUserId(session.userId);
        const accountsSyncStatus = accounts.map((account) => ({
            id: account.id,
            torbox_email: account.torbox_email,
            last_synced_at: account.last_synced_at,
            is_active: !!account.is_active
        }));

        return NextResponse.json({ accounts: accountsSyncStatus }, {
            headers: {
                "Cache-Control": "no-store, no-cache, must-revalidate"
            }
        })
    } catch (error) {
        console.error("Sync status API error:", error);
        return NextResponse.json({ error: "Failed to fetch sync status" }, { status: 500 });
    }
}