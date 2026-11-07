import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

export interface AuthCodeEntry {
    code: string;
    userId: number;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    expiresAt: number;
}

// In-memory store for pending authorization codes (5 min TTL)
export const authCodes = new Map<string, AuthCodeEntry>();

function getBaseUrl(request: Request): string {
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwardedHost || request.headers.get("host");

    if (host && !host.includes("localhost") && !host.includes("127.0.0.1")) {
        const proto = request.headers.get("x-forwarded-proto") || "https";
        return `${proto}://${host}`;
    }

    if (process.env.PUBLIC_URL) {
        return process.env.PUBLIC_URL.replace(/\/+$/, "");
    }

    return `https://${host || "localhost:3000"}`;
}

export async function GET(request: Request) {
    const url = new URL(request.url);
    const responseType = url.searchParams.get("response_type");
    const clientId = url.searchParams.get("client_id") || "claude";
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    const codeChallenge = url.searchParams.get("code_challenge");
    const codeChallengeMethod = url.searchParams.get("code_challenge_method");

    if (!redirectUri) {
        return new Response("Missing redirect_uri parameter", { status: 400 });
    }

    if (responseType !== "code") {
        const errorUrl = new URL(redirectUri);
        errorUrl.searchParams.set("error", "unsupported_response_type");
        if (state) errorUrl.searchParams.set("state", state);
        return NextResponse.redirect(errorUrl.toString());
    }

    if (!codeChallenge || codeChallengeMethod !== "S256") {
        const errorUrl = new URL(redirectUri);
        errorUrl.searchParams.set("error", "invalid_request");
        errorUrl.searchParams.set("error_description", "PKCE with S256 is required");
        if (state) errorUrl.searchParams.set("state", state);
        return NextResponse.redirect(errorUrl.toString());
    }

    // Check user session in Relay
    const session = await getSession();
    if (!session.userId) {
        const baseUrl = getBaseUrl(request);
        const loginUrl = new URL("/login", baseUrl);
        loginUrl.searchParams.set("redirect", `${url.pathname}${url.search}`);
        return NextResponse.redirect(loginUrl.toString());
    }

    // Mint a short-lived authorization code (5 minutes)
    const code = randomBytes(24).toString("hex");
    authCodes.set(code, {
        code,
        userId: session.userId,
        clientId,
        redirectUri,
        codeChallenge,
        expiresAt: Date.now() + 5 * 60 * 1000,
    });

    // Redirect back to client callback
    const callbackUrl = new URL(redirectUri);
    callbackUrl.searchParams.set("code", code);
    if (state) callbackUrl.searchParams.set("state", state);

    return NextResponse.redirect(callbackUrl.toString());
}