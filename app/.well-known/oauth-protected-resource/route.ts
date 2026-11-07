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
            resource: `${baseUrl}/api/mcp`,
            authorization_servers: [baseUrl],
            scopes_supported: ["mcp"],
            bearer_methods_supported: ["header"]
        },
        {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=3600"
            }
        }
    );
}

export async function OPTIONS() {
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTION",
            "Access-Control-Allow-Headers": "*"
        }
    })
}