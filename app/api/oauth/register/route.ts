import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

interface OAuthClient {
    client_id: string;
    client_name?: string;
    redirect_uris: string[];
    created_at: number;
}

export const oauthClients = new Map<string, OAuthClient>();

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        // console.log("[OAUTH DCR] Request from client:", body);

        const clientId = randomBytes(16).toString("hex");
        const clientSecret = randomBytes(32).toString("hex");
        const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];

        const client: OAuthClient = {
            client_id: clientId,
            client_name: typeof body.client_name === "string" ? body.client_name : "MCP Client",
            redirect_uris: redirectUris,
            created_at: Date.now(),
        };

        oauthClients.set(clientId, client);

        const response = {
            client_id: clientId,
            client_secret: clientSecret,
            client_id_issued_at: Math.floor(Date.now() / 1000),
            client_secret_expires_at: 0,
            client_name: client.client_name,
            redirect_uris: client.redirect_uris,
            grant_types: ["authorization_code"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
        };

        // console.log("[OAUTH DCR] Registration success for:", clientId);

        return NextResponse.json(response, {
            status: 201,
            headers: { "Access-Control-Allow-Origin": "*" },
        });
    } catch (error) {
        console.error("[OAUTH DCR] Registration error:", error);
        return NextResponse.json(
            { error: "invalid_request", error_description: "Failed to process registration" },
            { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
        );
    }
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