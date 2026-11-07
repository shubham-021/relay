import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp";
import { createMcpServer } from "@/mcp/server";
import { validateMcpApiKey } from "@/mcp/auth";
import { getUserById } from "@/lib/db";

export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, mcp-session-id, Mcp-Session-Id, mcp-protocol-version, Mcp-Protocol-Version",
    "Access-Control-Expose-Headers": "mcp-session-id, Mcp-Session-Id, mcp-protocol-version, Mcp-Protocol-Version, WWW-Authenticate",
};

function getBaseUrl(request: Request): string {
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
    const proto = request.headers.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
}

function unauthorizedResponse(request: Request): Response {
    const baseUrl = getBaseUrl(request);
    const metadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`;

    const headers = new Headers(CORS_HEADERS);
    headers.set(
        "WWW-Authenticate",
        `Bearer error="invalid_token", error_description="Bearer token is missing or invalid", resource_metadata="${metadataUrl}"`
    );
    headers.set("Content-Type", "application/json");

    return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers,
    });
}

function withCors(response: Response): Response {
    try {
        for (const [key, value] of Object.entries(CORS_HEADERS)) {
            response.headers.set(key, value);
        }
        const sid = response.headers.get("mcp-session-id");
        if (sid && !response.headers.get("Mcp-Session-Id")) {
            response.headers.set("Mcp-Session-Id", sid);
        }
        return response;
    } catch {
        const headers = new Headers(response.headers);
        for (const [key, value] of Object.entries(CORS_HEADERS)) {
            headers.set(key, value);
        }
        const sid = headers.get("mcp-session-id");
        if (sid && !headers.get("Mcp-Session-Id")) {
            headers.set("Mcp-Session-Id", sid);
        }
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    }
}

function normalizeRequest(request: Request): Request {
    const accept = request.headers.get("accept") ?? "";
    if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
        const headers = new Headers(request.headers);
        headers.set("accept", "application/json, text/event-stream");
        return new Request(request, { headers });
    }
    return request;
}

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

interface McpSession {
    transport: WebStandardStreamableHTTPServerTransport;
    userId: number;
    createdAt: number;
}

const sessions = new Map<string, McpSession>();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30m

function pruneStale() {
    const now = Date.now();
    for (const [id, s] of sessions) {
        if (now - s.createdAt > SESSION_TTL_MS) {
            s.transport.close();
            sessions.delete(id);
        }
    }
}

function authenticate(request: Request): number | null {
    const auth = request.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) return null;
    return validateMcpApiKey(auth.slice(7));
}

export async function POST(request: Request) {
    const userId = authenticate(request);
    if (userId === null) {
        return unauthorizedResponse(request);
    }

    const req = normalizeRequest(request);
    const sessionId = req.headers.get("mcp-session-id");

    if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session || session.userId !== userId) {
            return withCors(Response.json({ error: "Session not found" }, { status: 404 }));
        }

        const res = await session.transport.handleRequest(req);
        return withCors(res);
    }

    // new session
    const user = getUserById(userId);
    if (!user) {
        return withCors(Response.json({ error: "User not found" }, { status: 404 }));
    }

    pruneStale();

    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
            sessions.set(id, { transport, userId, createdAt: Date.now() });
        },
        onsessionclosed: (id) => {
            sessions.delete(id);
        },
    });

    const server = createMcpServer({ userId });
    await server.connect(transport);

    const res = await transport.handleRequest(req);
    return withCors(res);
}

export async function GET(request: Request) {
    const userId = authenticate(request);
    if (userId === null) {
        return unauthorizedResponse(request);
    }

    const req = normalizeRequest(request);
    const sessionId = req.headers.get("mcp-session-id");
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session || session.userId !== userId) {
        return withCors(Response.json({ error: "Session not found" }, { status: 404 }));
    }

    const res = await session.transport.handleRequest(req);
    return withCors(res);
}

export async function DELETE(request: Request) {
    const userId = authenticate(request);
    if (userId === null) {
        return unauthorizedResponse(request);
    }

    const req = normalizeRequest(request);
    const sessionId = req.headers.get("mcp-session-id");
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session || session.userId !== userId) {
        return withCors(Response.json({ error: "Session not found" }, { status: 404 }));
    }

    const res = await session.transport.handleRequest(req);
    return withCors(res);
}