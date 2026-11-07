import { createHmac, timingSafeEqual } from "crypto";

const secret = process.env.SESSION_SECRET ?? "";

export function deriveMcpApiKey(userId: number): string {
    return createHmac("sha256", secret).update(`mcp:${userId}`).digest("hex");
}

export function validateMcpApiKey(token: string): number | null {
    // token: "<userId>:<hmac>"
    const sep = token.indexOf(":");
    if (sep == -1) return null;

    const userId = Number(token.slice(0, sep));
    if (!Number.isInteger(userId) || userId < 1) return null;

    const expected = deriveMcpApiKey(userId);
    const provided = token.slice(sep + 1);

    if (expected.length !== provided.length) return null;
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(provided, "hex");
    if (a.length !== b.length) return null;

    return timingSafeEqual(a, b) ? userId : null;
}

