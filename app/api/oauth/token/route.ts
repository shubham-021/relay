import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { authCodes } from "../authorize/route";
import { mintOAuthAccessToken } from "@/mcp/auth";

export const dynamic = "force-dynamic";

function base64Url(buf: Buffer): string {
    return buf
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function verifyPkceS256(verifier: string, challenge: string): boolean {
    const hash = createHash("sha256").update(verifier).digest();
    return base64Url(hash) === challenge;
}

export async function POST(request: Request) {
    let grantType = "";
    let code = "";
    let codeVerifier = "";
    let redirectUri = "";

    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
        const text = await request.text();
        const params = new URLSearchParams(text);
        grantType = params.get("grant_type") || "";
        code = params.get("code") || "";
        codeVerifier = params.get("code_verifier") || "";
        redirectUri = params.get("redirect_uri") || "";
    } else {
        try {
            const json = await request.json();
            grantType = json.grant_type || "";
            code = json.code || "";
            codeVerifier = json.code_verifier || "";
            redirectUri = json.redirect_uri || "";
        } catch {
            return NextResponse.json(
                { error: "invalid_request", error_description: "Invalid request body" },
                { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
            );
        }
    }

    if (grantType !== "authorization_code") {
        return NextResponse.json(
            { error: "unsupported_grant_type", error_description: "Only authorization_code is supported" },
            { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
        );
    }

    const entry = authCodes.get(code);
    if (!entry) {
        return NextResponse.json(
            { error: "invalid_grant", error_description: "Authorization code not found or expired" },
            { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
        );
    }

    // Codes are single-use
    authCodes.delete(code);

    if (Date.now() > entry.expiresAt) {
        return NextResponse.json(
            { error: "invalid_grant", error_description: "Authorization code expired" },
            { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
        );
    }

    if (redirectUri && entry.redirectUri && redirectUri !== entry.redirectUri) {
        return NextResponse.json(
            { error: "invalid_grant", error_description: "Redirect URI mismatch" },
            { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
        );
    }

    // Verify PKCE
    if (!codeVerifier || !verifyPkceS256(codeVerifier, entry.codeChallenge)) {
        return NextResponse.json(
            { error: "invalid_grant", error_description: "PKCE verification failed" },
            { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
        );
    }

    const { accessToken, expiresIn } = mintOAuthAccessToken(entry.userId);

    return NextResponse.json(
        {
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: expiresIn,
            scope: "mcp",
        },
        {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store",
                Pragma: "no-cache",
            },
        }
    );
}

export async function OPTIONS() {
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
    });
}