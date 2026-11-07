import { createHmac, timingSafeEqual } from "crypto";

function getSecret(): string {
    return process.env.SESSION_SECRET ?? "";
}

export function deriveMcpApiKey(userId: number): string {
    return createHmac("sha256", getSecret()).update(`mcp:${userId}`).digest("hex");
}

export function validateMcpApiKey(token: string): number | null {
    // token: "<userId>:<hmac>"
    if (!token) return null;

    if (token.startsWith("oauth:")) {
        const parts = token.split(":");
        if (parts.length !== 4) return null;

        const [, userIdStr, expiresAtStr, providedSig] = parts;
        const userId = Number(userIdStr);
        const expiresAt = Number(expiresAtStr);

        if (!Number.isInteger(userId) || userId < 1) return null;
        if (Date.now() / 1000 > expiresAt) return null;

        const payload = `oauth:${userId}:${expiresAt}`;
        const expectedSig = createHmac("sha256", getSecret()).update(payload).digest("hex");

        if (expectedSig.length !== providedSig.length) return null;
        const a = Buffer.from(expectedSig, "hex");
        const b = Buffer.from(providedSig, "hex");
        if (a.length !== b.length) return null;

        return timingSafeEqual(a, b) ? userId : null;
    }

    // api
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

export function mintOAuthAccessToken(userId: number): { accessToken: string; expiresIn: number } {
    const expiresIn = 30 * 24 * 60 * 60 // 30days
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    const payload = `oauth:${userId}:${expiresAt}`;
    const sig = createHmac("sha256", getSecret()).update(payload).digest("hex");

    return {
        accessToken: `${payload}:${sig}`,
        expiresIn
    }
}

