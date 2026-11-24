import { describe, it, expect } from "bun:test";
import fs from "fs";

if (fs.existsSync(".env")) {
  const env = fs.readFileSync(".env", "utf8");
  for (const line of env.split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}

import { safeParseJson, cleanErrorMessage } from "../lib/utils";
import { getValidAccessToken, requestCdnLink, deleteTorrent } from "../lib/torbox";

describe("Safe JSON Parsing & Error Reporting Suite", () => {
  describe("safeParseJson unit tests", () => {
    it("handles HTML 502 Bad Gateway without crashing and extracts clean error message", async () => {
      const html502 = new Response(
        "<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1><p>Cloudflare</p></body></html>",
        {
          status: 502,
          statusText: "Bad Gateway",
          headers: { "Content-Type": "text/html; charset=UTF-8" },
        }
      );
      const res = await safeParseJson(html502, "Failed to get CDN link");
      expect(res.ok).toBe(false);
      expect(res.status).toBe(502);
      expect(res.error).toBe("502 Bad Gateway (502)");
    });

    it("handles empty body on 504 Timeout", async () => {
      const empty504 = new Response("", {
        status: 504,
        statusText: "Gateway Timeout",
        headers: { "Content-Type": "application/json" },
      });
      const res = await safeParseJson(empty504, "Failed to get CDN link");
      expect(res.ok).toBe(false);
      expect(res.status).toBe(504);
      expect(res.error).toBe("Failed to get CDN link (504)");
    });

    it("handles TorBox DATABASE_ERROR JSON response", async () => {
      const dbErrorRes = new Response(
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
      const res = await safeParseJson(dbErrorRes, "Failed to get CDN link");
      expect(res.ok).toBe(false);
      expect(res.error).toBe("Torrent not found or removed on TorBox");
    });

    it("parses valid JSON successfully", async () => {
      const validRes = new Response(
        JSON.stringify({
          success: true,
          url: "https://cdn.torbox.app/download/test-stream.mp4",
          playToken: "test-token-123",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
      const res = await safeParseJson<{ url: string; playToken: string }>(validRes);
      expect(res.ok).toBe(true);
      expect(res.data?.url).toBe("https://cdn.torbox.app/download/test-stream.mp4");
      expect(res.error).toBeNull();
    });
  });

  describe("cleanErrorMessage unit tests", () => {
    it("strips Error: prefix", () => {
      expect(cleanErrorMessage("Error: Something failed")).toBe("Something failed");
    });

    it("strips HTML tags", () => {
      expect(cleanErrorMessage("<h1>Access Denied</h1>")).toBe("Access Denied");
    });

    it("normalizes JSON parse error crash messages", () => {
      expect(cleanErrorMessage("JSON Parse error: Unexpected token '<' at 0")).toBe(
        "Invalid response from server"
      );
      expect(cleanErrorMessage("SyntaxError: Failed to parse JSON")).toBe(
        "Invalid response from server"
      );
    });

    it("normalizes connection refused errors", () => {
      expect(cleanErrorMessage("fetch failed: ECONNREFUSED 127.0.0.1:9070")).toBe(
        "Network connection failed"
      );
    });
  });

  describe("TorBox client 1:1 error handling", () => {
    it("handles removed torrent gracefully without retrying indefinitely", async () => {
      let token: string | null = null;
      try {
        token = await getValidAccessToken(1);
      } catch {
        return;
      }
      if (!token) return;

      const nonExistentTorrentId = 99999999;
      let cdnError: string | null = null;
      try {
        await requestCdnLink(nonExistentTorrentId, 0, token);
      } catch (err: unknown) {
        cdnError = (err as Error).message;
      }
      expect(cdnError).toBe("Torrent not found or removed on TorBox");

      let deleteError: string | null = null;
      try {
        await deleteTorrent(nonExistentTorrentId, token);
      } catch (err: unknown) {
        deleteError = (err as Error).message;
      }
      expect(deleteError).toBe("Torrent not found or already deleted on TorBox");
    });
  });
});
