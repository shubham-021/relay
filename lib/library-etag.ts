import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getAccountsByUserId, getAccountById, verifyUserAccountAccess } from "./db";

export function getLibEtag(userId: number, accountId?: number): string {
    if (accountId) {
        if (!verifyUserAccountAccess(userId, accountId)) {
            const hash = createHash("md5").update(`${accountId}:forbidden`).digest("hex");
            return `W/"${accountId}-${hash}"`;
        }
        const account = getAccountById(accountId);
        const updatedAt = account?.last_updated_at || account?.last_synced_at || "none";
        const hash = createHash("md5").update(`${accountId}:${updatedAt}`).digest("hex");
        return `W/"${accountId}-${hash}"`;
    }

    const accounts = getAccountsByUserId(userId);
    const raw = accounts
        .map((a) => `${a.id}:${a.last_updated_at || a.last_synced_at || "none"}`)
        .join("|");
    const hash = createHash("md5").update(raw).digest("hex");

    return `W/"all-${hash}"`;
}

export function validateETag(request: NextRequest, etag: string): NextResponse | null {
    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch && ifNoneMatch === etag) {
        return new NextResponse(null, {
            status: 304,
            headers: {
                Etag: etag,
                "Cache-Control": "private, no-cache"
            }
        })
    }

    return null;
}