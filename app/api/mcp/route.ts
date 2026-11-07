import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp";
import { createMcpServer } from "@/mcp/server";
import { validateMcpApiKey } from "@/mcp/auth";
import { getUserById } from "@/lib/db";

export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, mcp-session-id, Mcp-Session-Id, mcp-protocol-version, Mcp-Protocol-Version",
    "Access-Control-Expose-Headers": "mcp-session-id, Mcp-Session-Id, mcp-protocol-version, Mcp-Protocol-Version",
};

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
            headers
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
    transport: WebStandardStreamableHTTPServerTransport,
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
    // console.log("[MCP] [POST]", {
    //     auth: request.headers.get("authorization") ? "present" : "missing",
    //     session: request.headers.get("mcp-session-id"),
    // });

    const userId = authenticate(request);
    if (userId === null) {
        // console.log("[MCP] [POST] Auth failed -> returning 401");
        return withCors(Response.json({ error: "unauthorized" }, { status: 401 }));
    }

    const req = normalizeRequest(request);
    const sessionId = req.headers.get("mcp-session-id");

    if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session || session.userId !== userId) {
            // console.log("[MCP] [POST] Session not found:", sessionId);
            return withCors(Response.json({ error: "Session not found" }, { status: 404 }));
        }

        const res = await session.transport.handleRequest(req);
        // console.log("[MCP] [POST] Session hit -> status:", res.status);
        return withCors(res);
    }

    // new session
    const user = getUserById(userId);
    if (!user) {
        console.log("[MCP] [POST] User not found for id:", userId);
        return withCors(Response.json({ error: "User not found" }, { status: 404 }));
    }

    pruneStale();

    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
            console.log("[MCP] [SESSION CREATED]", id);
            sessions.set(id, { transport, userId, createdAt: Date.now() });
        },
        onsessionclosed: (id) => {
            console.log("[MCP] [SESSION CLOSED]", id);
            sessions.delete(id);
        }
    });

    const server = createMcpServer({ userId });
    await server.connect(transport);

    try {
        const res = await transport.handleRequest(req);
        // console.log("[MCP] [POST] Handshake response -> status:", res.status, "content-type:", res.headers.get("content-type"), "mcp-session-id:", res.headers.get("mcp-session-id"));
        return withCors(res);
    } catch (err) {
        console.error("[MCP] [POST] transport.handleRequest threw error:", err);
        return withCors(Response.json({ error: "Internal server error" }, { status: 500 }));
    }
}

export async function GET(request: Request) {
    const userId = authenticate(request);
    if (userId === null) {
        return withCors(Response.json({ error: "Unauthorized" }, { status: 401 }));
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
        return withCors(Response.json({ error: "Unauthorized" }, { status: 401 }));
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