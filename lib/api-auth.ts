import { getSession } from "./session";
import { validateMcpApiKey } from "@/mcp/auth";

/**
 * Resolves the authenticated user ID from either:
 * 1. `Authorization: Bearer <token>` header (OAuth access token or MCP API key)
 * 2. Iron-session cookie (`doma-session`) when no Bearer header is sent
 *
 * Returns `null` if unauthenticated or if an invalid Bearer token is provided.
 */
export async function getAuthenticatedUserId(request?: Request): Promise<number | null> {
  const authHeader = request?.headers.get("authorization");
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return null;
    }
    return validateMcpApiKey(match[1].trim());
  }

  const session = await getSession();
  return session.userId ?? null;
}

