import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getBaseUrl(request: Request): string {
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
    const proto = request.headers.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
}

export async function GET(request: Request) {
    const baseUrl = getBaseUrl(request);

    return NextResponse.json(
        {
            issuer: baseUrl,
            authorization_endpoint: `${baseUrl}/api/oauth/authorize`,
            token_endpoint: `${baseUrl}/api/oauth/token`,
            registration_endpoint: `${baseUrl}/api/oauth/register`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
            scopes_supported: ["mcp"],
        },
        {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=3600",
            },
        }
    );
}

export async function OPTIONS() {
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        },
    });
}