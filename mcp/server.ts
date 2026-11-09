import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { z } from "zod";
import type { McpContext } from "./context";
import {
    getMoviesForUser,
    getTvShowsForUser,
    getTvShowDetailsForUser,
    getContinueWatching,
    findNextEpisodeForFile,
    verifyUserAccountAccess,
    getOtherFilesForUser,
    getAccountsByUserId,
    getWatchedPosition,
} from "@/lib/db";
import { getValidAccessToken, requestCdnLink, checkTorrentCached, createTorrent } from "@/lib/torbox";
import { mintPlayToken } from "@/lib/crypto";
import { SOURCES } from "@/tor_sources/registry";
import { cachedSearch } from "@/tor_sources/cache";
import { formatBytes } from "@/lib/utils";
import { syncAccount } from "@/lib/sync";
import { sendPlayCommand } from "@/lib/remote-control";

function toolError(e: unknown): { content: [{ type: "text"; text: string }]; isError: true } {
    const msg = e instanceof Error ? e.message : String(e);
    return { content: [{ type: "text", text: msg }], isError: true };
}

export function createMcpServer(ctx: McpContext): McpServer {
    const server = new McpServer({
        name: "relay",
        version: "1.0.0"
    });

    // tools
    server.registerTool("list_accounts", {
        title: "List Accounts",
        description: "List all TorBox accounts linked to this user. Returns account IDs needed by other tools.",
        annotations: { readOnlyHint: true },
    }, async () => {
        const accounts = getAccountsByUserId(ctx.userId);
        const result = accounts.map((a: any) => ({
            account_id: a.id,
            email: a.torbox_email,
            is_active: a.is_active === 1,
            last_synced_at: a.last_synced_at ?? null,
        }));
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    });

    server.registerTool("sync_library", {
        title: "Sync Library",
        description: "Sync a TorBox account's files to the local library. Run this after adding torrents to refresh the library.",
        inputSchema: {
            account_id: z.number().int().positive().describe("TorBox account ID to sync"),
        },
        annotations: { idempotentHint: true },
    }, async ({ account_id }) => {
        if (!verifyUserAccountAccess(ctx.userId, account_id)) {
            return { content: [{ type: "text", text: "Account not found or access denied" }], isError: true };
        }
        try {
            const result = await syncAccount(account_id);
            if (!result.success) {
                return { content: [{ type: "text", text: `Sync failed: ${result.error ?? "unknown error"}` }], isError: true };
            }
            return { content: [{ type: "text", text: JSON.stringify({ success: true, files_synced: result.filesSynced }, null, 2) }] };
        } catch (e) {
            return toolError(e);
        }
    });

    server.registerTool("list_movies", {
        title: "List movies",
        description: "List all movies in the user's library with metadata and watch progress",
        inputSchema: {
            account_id: z.number().int().positive().optional().describe("Filter by torbox account ID"),
        },
        annotations: { readOnlyHint: true },
    }, async ({ account_id }) => {
        const rows = getMoviesForUser(ctx.userId, account_id ?? ctx.accountId);
        const movies = rows.map((r: any) => ({
            title: r.media_title ?? r.raw_title ?? r.filename,
            year: r.media_year ?? r.parsed_year ?? null,
            overview: r.media_overview ?? null,
            size: formatBytes(r.size),
            account_id: r.account_id,
            torrent_id: r.torrent_id,
            file_id: r.file_id,
            tmdb_id: r.tmdb_id ?? null,
            watched: r.completed === 1,
            progress: r.duration_seconds ? Math.round((r.position_seconds / r.duration_seconds) * 100) : null,
        }));

        return { content: [{ type: "text", text: JSON.stringify(movies, null, 2) }] };
    });

    server.registerTool("list_tv_shows", {
        title: "List tv shows",
        description: "List all tv shows in the user's library with season/episode counts",
        inputSchema: {
            account_id: z.number().int().positive().optional().describe("Filter by torbox account ID")
        },
        annotations: { readOnlyHint: true },
    }, async ({ account_id }) => {
        const rows = getTvShowsForUser(ctx.userId, account_id ?? ctx.accountId);
        const shows = rows.map((r: any) => ({
            show_title: r.show_title,
            tmdb_id: r.tmdb_id ?? null,
            season_count: r.season_count,
            episode_count: r.episode_count,
            start_year: r.start_year ?? null,
            overview: r.overview ?? null,
        }));

        return { content: [{ type: "text", text: JSON.stringify(shows, null, 2) }] };
    })

    server.registerTool("get_tv_show_details", {
        title: "Get TV show details",
        description: "Get all episodes for a specific TV show, grouped by season.",
        inputSchema: {
            show_title: z.string().describe("Exact show title as returned by list_tv_shows")
        },
        annotations: { readOnlyHint: true },
    }, async ({ show_title }) => {
        const data = getTvShowDetailsForUser(ctx.userId, show_title);
        if (!data) {
            return { content: [{ type: "text", text: `No show found with title "${show_title}"` }], isError: true };
        }

        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    });

    server.registerTool("list_other_files", {
        title: "List Other Files",
        description: "List non-movie, non-TV files (games, software, documents, etc.).",
        inputSchema: {
            account_id: z.number().int().positive().optional().describe("Filter by TorBox account ID"),
        },
        annotations: { readOnlyHint: true },
    }, async ({ account_id }) => {
        const rows = getOtherFilesForUser(ctx.userId, account_id ?? ctx.accountId);
        const files = rows.map((r: any) => ({
            filename: r.filename,
            size: formatBytes(r.size),
            account_id: r.account_id,
            torrent_id: r.torrent_id,
            file_id: r.file_id,
        }));

        return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] };
    });

    server.registerTool("get_continue_watching", {
        title: "Continue Watching",
        description: "Get the user's continue watching list — in-progress media and up-next episodes.",
        inputSchema: {
            limit: z.number().int().min(1).max(20).optional().describe("Max items to return (default 5)"),
        },
        annotations: { readOnlyHint: true },
    }, async ({ limit }) => {
        const items = getContinueWatching(ctx.userId, limit ?? 5);
        return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
    });

    server.registerTool("get_next_episode", {
        title: "Get Next Episode",
        description: "Given a specific episode file, find the next episode in the series.",
        inputSchema: {
            account_id: z.number().int().positive().describe("TorBox account ID"),
            torrent_id: z.number().int().nonnegative().describe("Torrent ID"),
            file_id: z.number().int().nonnegative().describe("File ID of the current episode"),
        },
        annotations: { readOnlyHint: true },
    }, async ({ account_id, torrent_id, file_id }) => {
        if (!verifyUserAccountAccess(ctx.userId, account_id)) {
            return { content: [{ type: "text", text: "Account not found or access denied" }], isError: true };
        }
        const next = findNextEpisodeForFile(ctx.userId, account_id, torrent_id, file_id);
        if (!next) {
            return { content: [{ type: "text", text: "No next episode found" }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(next, null, 2) }] };
    });

    const sourceList = SOURCES.map((s) => `${s.id} (${s.label})`).join(", ");

    server.registerTool("search_torrents", {
        title: "Search Torrents",
        description: `Search for torrents across configured sources. Returns name, size, seeders, and magnet link. Available sources: ${sourceList}`,
        inputSchema: {
            query: z.string().min(1).describe("Search query"),
            sources: z.array(z.string()).optional().describe("Source IDs to search (omit for all)"),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
    }, async ({ query, sources }) => {
        try {
            const activeSources = sources
                ? SOURCES.filter((s) => sources.includes(s.id))
                : SOURCES;
            const allResults: any[] = [];
            const errors: string[] = [];
            await Promise.allSettled(
                activeSources.map(async (source) => {
                    try {
                        const results = await cachedSearch(source, query.trim());
                        for (const r of results) {
                            allResults.push({
                                name: r.name,
                                size: formatBytes(r.sizeBytes),
                                seeders: r.seeders,
                                leechers: r.leechers,
                                source: r.source,
                                infoHash: r.infoHash,
                                magnet: r.magnet,
                            });
                        }
                    } catch (e) {
                        errors.push(`${source.id}: ${e instanceof Error ? e.message : "failed"}`);
                    }
                })
            );
            allResults.sort((a, b) => b.seeders - a.seeders);
            const result = { results: allResults.slice(0, 50), total: allResults.length, errors };
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
            return toolError(e);
        }
    });

    server.registerTool("check_torrent_cache", {
        title: "Check Torrent Cache",
        description: "Check if a torrent hash is instantly available (cached) on TorBox. Cache availability is global across TorBox, not account-specific. The `account_id` parameter is required only to authenticate or establish the TorBox account context for the API request. Checking a torrent hash once using ANY valid linked account is sufficient. Never repeat cache checks across multiple accounts for the same hash.",
        inputSchema: {
            hash: z.string().min(1).describe("Torrent info hash"),
            account_id: z.number().int().positive().describe("TorBox account ID to check against"),
        },
        annotations: { readOnlyHint: true },
    }, async ({ hash, account_id }) => {
        if (!verifyUserAccountAccess(ctx.userId, account_id)) {
            return { content: [{ type: "text", text: "Account not found or access denied" }], isError: true };
        }
        try {
            const token = await getValidAccessToken(account_id);
            const result = await checkTorrentCached(hash, token);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
            return toolError(e);
        }
    });

    server.registerTool("add_torrent", {
        title: "Add Torrent",
        description: "Add a torrent to TorBox using a magnet link. By default only adds if cached (instant).",
        inputSchema: {
            magnet: z.string().min(1).describe("Magnet link"),
            account_id: z.number().int().positive().describe("TorBox account ID"),
            force: z.boolean().optional().describe("If true, add even if not cached (will need to download)"),
        },
        annotations: { destructiveHint: true },
    }, async ({ magnet, account_id, force }) => {
        if (!verifyUserAccountAccess(ctx.userId, account_id)) {
            return { content: [{ type: "text", text: "Account not found or access denied" }], isError: true };
        }
        try {
            const token = await getValidAccessToken(account_id);
            const result = await createTorrent(magnet, token, !(force ?? false));
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
            return toolError(e);
        }
    });

    server.registerTool("get_stream_link", {
        title: "Get Stream Link",
        description: "Generate a CDN streaming URL for a specific file. Returns a direct download/stream link.",
        inputSchema: {
            account_id: z.number().int().positive().describe("TorBox account ID"),
            torrent_id: z.number().int().nonnegative().describe("Torrent ID"),
            file_id: z.number().int().nonnegative().describe("File ID"),
        },
    }, async ({ account_id, torrent_id, file_id }) => {
        if (!verifyUserAccountAccess(ctx.userId, account_id)) {
            return { content: [{ type: "text", text: "Account not found or access denied" }], isError: true };
        }
        try {
            const token = await getValidAccessToken(account_id);
            const url = await requestCdnLink(torrent_id, file_id, token);
            const playToken = mintPlayToken({
                userId: ctx.userId,
                accountId: account_id,
                torrentId: torrent_id,
                fileId: file_id,
            });
            return { content: [{ type: "text", text: JSON.stringify({ url, playToken }, null, 2) }] };
        } catch (e) {
            return toolError(e);
        }
    });

    server.registerTool("play_media", {
        title: "Play Media via Aemond",
        description: "Launch playback of a movie or episode in the user's local video player (mpv, vlc, iina) via the Relay Aemond daemon (runs on localhost:9070). Automatically resumes from last watched position.",
        inputSchema: {
            account_id: z.number().int().positive().describe("TorBox account ID"),
            torrent_id: z.number().int().nonnegative().describe("Torrent ID"),
            file_id: z.number().int().nonnegative().describe("File ID"),
            player: z.enum(["mpv", "vlc", "iina"]).optional().describe("Video player to launch (default: mpv)"),
            daemon_url: z.string().optional().describe("Aemond daemon base URL (default: http://localhost:9070)"),
        },
    }, async ({ account_id, torrent_id, file_id, player, daemon_url }) => {
        if (!verifyUserAccountAccess(ctx.userId, account_id)) {
            return { content: [{ type: "text", text: "Account not found or access denied" }], isError: true };
        }
        try {
            const token = await getValidAccessToken(account_id);
            const url = await requestCdnLink(torrent_id, file_id, token);
            const playToken = mintPlayToken({
                userId: ctx.userId,
                accountId: account_id,
                torrentId: torrent_id,
                fileId: file_id,
            });
            // Resume position check
            const watched = getWatchedPosition(ctx.userId, account_id, torrent_id, file_id);
            let startTime = "0";
            if (
                watched &&
                !watched.completed &&
                watched.position_seconds > 0 &&
                watched.duration_seconds &&
                watched.position_seconds < watched.duration_seconds - 10
            ) {
                startTime = String(Math.floor(watched.position_seconds));
            }
            const activePlayer = player ?? "mpv";
            const daemonEndpoint = `${daemon_url ?? "http://localhost:9070"}/play`;
            const reportBase = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/+$/, "") : "http://localhost:3000";

            const playPayload = {
                player: activePlayer,
                url,
                startTime,
                torrent_id,
                file_id,
                account_id,
                token: playToken,
                reportUrl: `${reportBase}/api/progress`
            };

            const dispatched = sendPlayCommand(ctx.userId, playPayload);
            if (!dispatched) {
                return {
                    content: [{
                        type: "text",
                        text: "Could not launch playback: No active Relay browser tab was found. Please ensure you have Relay open in your browser so it can bridge the playback to your local machine."
                    }],
                    isError: true
                }
            }

            return {
                content: [{
                    type: "text",
                    text: `Successfully sent play command to your browser. ${activePlayer.toUpperCase()} is launching on your desktop.`
                }]
            }
        } catch (e) {
            return toolError(e);
        }
    });

    server.registerPrompt("system", {
        title: "Relay System Overview",
        description: "Describes what Relay is and the recommended workflow for interacting with it.",
    }, async () => ({
        messages: [{
            role: "user",
            content: {
                type: "text",
                text: [
                    "You are connected to Relay, a self-hosted TorBox media manager.",
                    "The user has one or more TorBox cloud storage accounts linked. Each account has an account_id.",
                    "",
                    "Typical workflow:",
                    "1. list_accounts: discover available TorBox accounts and their IDs",
                    "2. list_movies / list_tv_shows / list_other_files: browse the synced library",
                    "3. get_tv_show_details: drill into a specific show's episodes",
                    "4. get_continue_watching: see what the user was watching or should watch next",
                    "5. search_torrents: find new content across torrent indexers",
                    "6. check_torrent_cache: verify instant availability before adding",
                    "7. add_torrent: add a magnet link to TorBox (prefer cached-only unless user says otherwise)",
                    "8. sync_library: refresh the library after adding new torrents",
                    "9. get_stream_link: generate a CDN URL for streaming a specific file",
                    "10. play_media: launch media directly in the user's local player (mpv, vlc, iina) via Aemond daemon",
                    "",
                    "Always call list_accounts first if you don't know the account_id.",
                    "After add_torrent, call sync_library so the new files appear in the library.",
                    "Prefer torrents with high seeders. Default to cached-only when adding.",
                ].join("\n"),
            },
        }],
    }));

    return server;
}
