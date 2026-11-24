import { describe, it, expect } from "bun:test";
import fs from "fs";

// Load environment variables if present
if (fs.existsSync(".env")) {
  const env = fs.readFileSync(".env", "utf8");
  for (const line of env.split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}

import { getValidAccessToken } from "../lib/torbox";
import { TORBOX_ENDPOINTS } from "../lib/torbox-config";
import { safeParseJson } from "../lib/utils";

describe("JSON Parsing & TorBox Error Handling", () => {
  it("reproduces raw SyntaxError when calling res.json() on Cloudflare/Nginx 502 HTML", async () => {
    const html502 = new Response(
      "<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1><p>Cloudflare</p></body></html>",
      {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "Content-Type": "text/html; charset=UTF-8" },
      }
    );

    // Calling res.json() directly throws SyntaxError (which previously caused user toasts with parse errors)
    expect(html502.json()).rejects.toThrow();
  });

  it("reproduces raw SyntaxError when calling res.json() on empty body 504", async () => {
    const empty504 = new Response("", {
      status: 504,
      statusText: "Gateway Timeout",
      headers: { "Content-Type": "application/json" },
    });

    // Calling res.json() directly throws SyntaxError
    expect(empty504.json()).rejects.toThrow();
  });

  it("safeParseJson handles HTML 502 without throwing and extracts clean error message", async () => {
    const html502 = new Response(
      "<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1><p>Cloudflare</p></body></html>",
      {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "Content-Type": "text/html; charset=UTF-8" },
      }
    );

    const result = await safeParseJson(html502, "Failed to get CDN link");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.data).toBeNull();
    expect(result.error).toBe("502 Bad Gateway (502)");
  });

  it("safeParseJson handles empty body 504 without throwing and returns fallback with status", async () => {
    const empty504 = new Response("", {
      status: 504,
      statusText: "Gateway Timeout",
      headers: { "Content-Type": "application/json" },
    });

    const result = await safeParseJson(empty504, "Failed to get CDN link");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(504);
    expect(result.data).toBeNull();
    expect(result.error).toBe("Failed to get CDN link (504)");
  });

  it("safeParseJson parses JSON error responses properly", async () => {
    const jsonError = new Response(
      JSON.stringify({ error: "Torrent has been removed from TorBox account" }),
      {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Type": "application/json" },
      }
    );

    const result = await safeParseJson<{ error: string }>(jsonError, "Failed to get CDN link");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toBe("Torrent has been removed from TorBox account");
  });

  it("safeParseJson handles TorBox DATABASE_ERROR JSON response gracefully", async () => {
    const dbError = new Response(
      JSON.stringify({
        success: false,
        error: "DATABASE_ERROR",
        detail: "There was an error processing your request. Please try again later.",
        data: null,
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );

    const result = await safeParseJson(dbError, "Failed to get CDN link");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Torrent not found or removed on TorBox");
  });

  it("live test: TorBox API request for removed torrent (Better Call Saul S06 simulation)", async () => {
    let token: string | null = null;
    try {
      token = await getValidAccessToken(1);
    } catch {
      // Offline or missing environment token, gracefully skip live network assertion
      return;
    }

    if (!token) return;

    const removedTorrentId = 99999999;
    const fileId = 0;
    const url = new URL(TORBOX_ENDPOINTS.TORRENTS_REQUEST_DL);
    url.searchParams.set("torrent_id", String(removedTorrentId));
    url.searchParams.set("file_id", String(fileId));
    url.searchParams.set("token", token);

    const res = await fetch(url.toString(), { cache: "no-store" });
    const result = await safeParseJson(res, "Failed to get CDN link");
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error?.length).toBeGreaterThan(0);
  });
});
