import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp";
import { createMcpServer } from "@/mcp/server";
import { validateMcpApiKey } from "@/mcp/auth";
import { getUserById } from "@/lib/db";
import { error } from "console";

export const dynamic = "force-dynamic";

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
    const userId = authenticate(request);
    if (userId === null) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const sessionId = request.headers.get("mcp-session-id");
    if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session || session.userId !== userId) {
            return Response.json({ error: "Session not found" }, { status: 404 });
        }

        return session.transport.handleRequest(request);
    }

    // new session
    const user = getUserById(userId);
    if (!user) {
        return Response.json({ error: "User not found" }, { status: 404 });
    }

    pruneStale();

    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
            sessions.set(id, { transport, userId, createdAt: Date.now() });
        },
        onsessionclosed: (id) => {
            sessions.delete(id);
        }
    });

    const server = createMcpServer({ userId });
    await server.connect(transport);

    return transport.handleRequest(request);
}

export async function GET(request: Request) {
    const userId = authenticate(request);
    if (userId === null) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sessionId = request.headers.get("mcp-session-id");
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session || session.userId !== userId) {
        return Response.json({ error: "Session not found" }, { status: 404 });
    }

    return session.transport.handleRequest(request);
}

export async function DELETE(request: Request) {
    const userId = authenticate(request);
    if (userId === null) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sessionId = request.headers.get("mcp-session-id");
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session || session.userId !== userId) {
        return Response.json({ error: "Session not found" }, { status: 404 });
    }

    return session.transport.handleRequest(request);
}