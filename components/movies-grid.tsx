"use client";

import { Film, Play, Download, Copy, Users, MoreVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LOCAL_DAEMON_PLAYERS } from "@/lib/constants";
import { launchPlayback } from "@/lib/client-play";
import { WatchedProgressBar } from "@/components/watched-progress-bar";
import { AccountBadge } from "@/components/account-badge";
import { useFileStore } from "@/lib/store";
import { DeleteTorrentDialog } from "@/components/delete-torrent-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function useCompactActions() {
  const { sidebarCollapsed } = useFileStore();
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const check = () => {
      if (sidebarCollapsed) {
        setCompact(window.innerWidth < 1210);
      } else {
        setCompact(window.innerWidth < 1400);
      }
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [sidebarCollapsed]);
  return compact;
}

interface MovieItem {
  id: number;
  account_id: number;
  torrent_id: number;
  file_id: number;
  remote_path: string;
  filename: string;
  size?: number;
  sizeFormatted: string;
  title: string;
  tmdb_id?: number | null;
  year?: string;
  poster_url?: string;
  backdrop_url?: string;
  overview?: string;
  percent?: number;
  completed?: boolean;
}

interface GroupedMovie {
  groupId: string;
  title: string;
  poster_url?: string;
  overview?: string;
  year?: string;
  percent?: number;
  completed?: boolean;
  versions: MovieItem[];
}

type ActionType = "stream" | "copy" | "download" | "syncplay" | "delete";

interface MoviesGridProps {
  movies: MovieItem[];
  isLoading: boolean;
  searchQuery: string;
  playerProtocol: string;
}

async function fetchCdnLink(torrentId: number, fileId: number, accountId: number): Promise<string | null> {
  try {
    const res = await fetch("/api/cdn-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ torrent_id: torrentId, file_id: fileId, account_id: accountId }),
    });
    const data = await res.json();
    if (!res.ok || !data.url) throw new Error(data.error || "Failed to get CDN link");
    return data.url;
  } catch (e: any) {
    toast.error(e.message || "Failed to get CDN link");
    return null;
  }
}

export function MoviesGrid({ movies, isLoading, searchQuery, playerProtocol }: MoviesGridProps) {
  const { viewMode, accounts } = useFileStore();
  const compactActions = useCompactActions();
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<MovieItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const getAccount = (id: number) => accounts.find(a => a.id === id);

  const filtered = movies.filter((m) =>
    !deletedIds.has(m.id) && (m.title || m.filename).toLowerCase().includes(searchQuery.toLowerCase())
  );

  const groupedMovies = useMemo(() => {
    const map = new Map<string, GroupedMovie>();
    filtered.forEach((m) => {
      const groupId = m.tmdb_id ? String(m.tmdb_id) : m.title;
      if (!map.has(groupId)) {
        map.set(groupId, {
          groupId,
          title: m.title,
          poster_url: m.poster_url,
          overview: m.overview,
          year: m.year,
          percent: m.percent ?? 0,
          completed: m.completed ?? false,
          versions: [],
        });
      }
      const group = map.get(groupId)!;
      group.versions.push(m);

      // Keep the highest watch progress across all versions
      const mPercent = m.percent ?? 0;
      if (mPercent > (group.percent ?? 0)) {
        group.percent = mPercent;
        group.completed = m.completed ?? false;
      }
      if (m.completed) {
        group.completed = true;
      }
    });

    const groups = Array.from(map.values());
    // Sort versions within each group by size descending (largest/best quality first)
    groups.forEach(g => {
      g.versions.sort((a, b) => (b.size || 0) - (a.size || 0));
    });
    return groups;
  }, [filtered]);

  const handleCopyLink = useCallback(async (movie: MovieItem) => {
    const cdnUrl = await fetchCdnLink(movie.torrent_id, movie.file_id, movie.account_id);
    if (!cdnUrl) return;

    try {
      await navigator.clipboard.writeText(cdnUrl);
      toast.success("CDN link copied to clipboard");
    } catch {
      toast.error("Failed to copy link");
    }
  }, []);

  const handleStream = useCallback(async (movie: MovieItem) => {
    await launchPlayback({
      torrentId: movie.torrent_id,
      fileId: movie.file_id,
      accountId: movie.account_id,
      playerProtocol,
    });
  }, [playerProtocol]);

  const handleSyncplay = useCallback(async (movie: MovieItem) => {
    if (!LOCAL_DAEMON_PLAYERS.includes(playerProtocol)) return;
    const cdnUrl = await fetchCdnLink(movie.torrent_id, movie.file_id, movie.account_id);
    if (!cdnUrl) return;

    try {
      const daemonRes = await fetch("http://localhost:9070/syncplay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player: playerProtocol, url: cdnUrl }),
      });

      if (daemonRes.ok) {
        const resData = await daemonRes.json();
        toast.success(`Syncplay launched via ${playerProtocol.toUpperCase()}`, {
          description: `Joined room: ${resData.room || "unknown"}`,
        });
        return;
      }
      throw new Error("Daemon returned error");
    } catch (e: any) {
      toast.error("Syncplay launch failed", {
        description: e.message || "Ensure Aemond is running and syncplay.conf is configured.",
      });
    }
  }, [playerProtocol]);

  const handleDownload = useCallback(async (movie: MovieItem) => {
    const cdnUrl = await fetchCdnLink(movie.torrent_id, movie.file_id, movie.account_id);
    if (!cdnUrl) return;
    window.open(cdnUrl, "_blank");
    toast.success("Download started");
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch("/api/torrent/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ torrent_id: deleteTarget.torrent_id, account_id: deleteTarget.account_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete torrent");
      setDeletedIds((prev) => new Set(prev).add(deleteTarget.id));
      window.dispatchEvent(new CustomEvent("torrent-files-updated"));
      toast.success("Movie deleted", { description: deleteTarget.title });
    } catch (e: any) {
      toast.error(e.message || "Failed to delete torrent");
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget]);

  const [actionState, setActionState] = useState<{
    movieGroup: GroupedMovie;
    action: ActionType;
  } | null>(null);

  // Route the action to the correct existing handler
  const executeAction = useCallback((action: ActionType, version: MovieItem) => {
    switch (action) {
      case "stream": handleStream(version); break;
      case "copy": handleCopyLink(version); break;
      case "download": handleDownload(version); break;
      case "syncplay": handleSyncplay(version); break;
      case "delete": setDeleteTarget(version); break;
    }
  }, [handleStream, handleCopyLink, handleDownload, handleSyncplay]);

  // Dispatcher: single version -> execute immediately, multiple -> open dialog
  const onActionClick = useCallback((movieGroup: GroupedMovie, action: ActionType) => {
    if (movieGroup.versions.length === 1) {
      executeAction(action, movieGroup.versions[0]);
    } else {
      setActionState({ movieGroup, action });
    }
  }, [executeAction]);

  if (isLoading) {
    return (
      <div className={viewMode === "list" ? "flex flex-col gap-3" : "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5"}>
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className={viewMode === "list" ? "h-20 w-full rounded-xl" : "aspect-2/3 rounded-xl"} />
        ))}
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Film size={48} className="text-muted-foreground/30 mb-2" />
        <p className="text-lg font-medium">No movies found</p>
        <p className="text-sm">Try syncing your TorBox account or adjusting your search.</p>
      </div>
    );
  }

  return (
    <div className={viewMode === "list" ? "flex flex-col gap-3" : "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5"}>
      {viewMode === "list" ? (
        filtered.map((movie) => (
          <div
            key={movie.id}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleStream(movie);
            }}
            className="navigable-card group flex flex-col sm:flex-row items-stretch sm:items-center gap-4 px-4 py-3 rounded-xl border border-border/40 bg-card/40 hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary focus:outline-none transition-all overflow-hidden relative cursor-pointer"
          >
            {/* Poster Thumbnail */}
            <div className="w-12 h-16 shrink-0 rounded bg-muted/30 overflow-hidden relative border border-border/50">
              {movie.poster_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={movie.poster_url} alt={movie.title} className="object-cover w-full h-full" loading="lazy" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <Film size={20} className="opacity-40" />
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <h3 className="text-sm font-bold tracking-tight text-foreground truncate group-hover:text-primary transition-colors">
                {movie.filename}
              </h3>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
                {movie.year && <span>{movie.year}</span>}
                {movie.year && <span className="text-muted-foreground/50">•</span>}
                <span>{movie.sizeFormatted}</span>

                {(() => {
                  const acc = getAccount(movie.account_id);
                  return acc && <AccountBadge accountId={acc.id} email={acc.torbox_email} variant="inline" />;
                })()}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity sm:mt-0 pb-1 sm:pb-0">
              <Button
                size="sm"
                onClick={() => handleStream(movie)}
                className="h-8 text-xs font-semibold gap-1 bg-primary text-primary-foreground hover:bg-primary/90 shadow-md cursor-pointer"
              >
                <Play size={13} className="fill-current" />
                Stream
              </Button>
              {LOCAL_DAEMON_PLAYERS.includes(playerProtocol) && (
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => handleSyncplay(movie)}
                  className="h-8 w-8 shrink-0 text-xs text-amber-400 border-amber-500/30 hover:bg-amber-500/10 cursor-pointer"
                  title="Syncplay with friends"
                >
                  <Users size={13} />
                </Button>
              )}
              <Button
                size="icon"
                variant="outline"
                onClick={() => handleCopyLink(movie)}
                className="h-8 w-8 shrink-0 text-xs cursor-pointer"
                title="Copy CDN Link"
              >
                <Copy size={13} />
              </Button>
              <Button
                size="icon"
                variant="outline"
                onClick={() => handleDownload(movie)}
                className="h-8 w-8 shrink-0 text-xs cursor-pointer"
                title="Download File"
              >
                <Download size={13} />
              </Button>
              <Button
                size="icon"
                variant="outline"
                onClick={() => setDeleteTarget(movie)}
                className="h-8 w-8 shrink-0 text-xs text-red-400 border-red-500/30 hover:bg-red-500/10 cursor-pointer"
                title="Delete Torrent"
              >
                <Trash2 size={13} />
              </Button>
            </div>

            <WatchedProgressBar
              percent={movie.percent ?? null}
              completed={movie.completed}
            />
          </div>
        ))
      ) : (
        groupedMovies.map((movieGroup) => (
          <Card
            key={movieGroup.groupId}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onActionClick(movieGroup, "stream");
            }}
            className="navigable-card group relative overflow-hidden rounded-xl border-0 bg-black/40 transition-all duration-300 hover:shadow-2xl hover:shadow-primary/20 focus:ring-4 focus:ring-primary focus:outline-none cursor-pointer"
          >
            <div className="relative aspect-2/3 w-full overflow-hidden bg-muted/40">
              {movieGroup.poster_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={movieGroup.poster_url}
                  alt={movieGroup.title}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-muted/50 to-muted/20 text-muted-foreground">
                  <Film size={48} className="opacity-40" />
                </div>
              )}

              {/* Always-visible bottom gradient overlay with title */}
              <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black via-black/80 to-transparent pt-24 pb-3.5 px-3.5 transition-opacity duration-300 group-hover:opacity-0 pointer-events-none">
                <h3 className="text-lg font-display font-bold text-white leading-snug line-clamp-2 drop-shadow-lg tracking-wide">
                  {movieGroup.title}
                </h3>
              </div>

              {/* Top Right: Version count badge (only if multiple versions) */}
              {/* NOTE: This badge is intentionally covered by the hover overlay below. */}
              {/* When hovered, the overlay metadata already shows "X Versions", so hiding the badge is correct. */}
              <div className="absolute top-2 right-2 z-30 flex items-center gap-1.5">
                {movieGroup.versions.length > 1 && (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted/80 text-[10px] font-bold text-white backdrop-blur-md">
                    {movieGroup.versions.length}
                  </div>
                )}

                {/* Compact: always-visible three-dots at top-right */}
                {compactActions && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        className="h-8 w-8 rounded-full bg-transparent hover:bg-transparent text-white cursor-pointer ring-0 focus:outline-none"
                      >
                        <MoreVertical size={15} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" sideOffset={6} className="min-w-42.5 bg-popover/95 backdrop-blur-xl border-border/60 shadow-2xl rounded-xl p-1.5">
                      <DropdownMenuItem onClick={() => onActionClick(movieGroup, "stream")} className="gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer text-sm font-medium hover:bg-violet-500/10 focus:bg-violet-500/10">
                        <Play size={14} className="text-violet-400 fill-violet-400" />
                        Stream
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onActionClick(movieGroup, "copy")} className="gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer text-sm font-medium hover:bg-primary/10 focus:bg-primary/10">
                        <Copy size={14} className="text-muted-foreground" />
                        Copy link
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onActionClick(movieGroup, "download")} className="gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer text-sm font-medium hover:bg-emerald-500/10 focus:bg-emerald-500/10">
                        <Download size={14} className="text-emerald-400" />
                        Download
                      </DropdownMenuItem>
                      {LOCAL_DAEMON_PLAYERS.includes(playerProtocol) && (
                        <DropdownMenuItem onClick={() => onActionClick(movieGroup, "syncplay")} className="gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer text-sm font-medium hover:bg-amber-500/10 focus:bg-amber-500/10">
                          <Users size={14} className="text-amber-400" />
                          Syncplay
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => onActionClick(movieGroup, "delete")} className="gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer text-sm font-medium hover:bg-red-500/10 focus:bg-red-500/10">
                        <Trash2 size={14} className="text-red-400" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              {/* Hover overlay: metadata + action buttons */}
              <div className="absolute inset-0 bg-linear-to-t from-black via-black/85 to-black/60 opacity-0 transition-opacity duration-300 group-hover:opacity-100 flex flex-col justify-end p-2.5 sm:p-4 gap-2 sm:gap-3">
                {/* Overview + metadata */}
                <div className="space-y-1.5">
                  {movieGroup.overview && (
                    <p className="text-[12px] text-zinc-300 line-clamp-4 font-normal leading-relaxed">
                      {movieGroup.overview}
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-[11px] text-zinc-400 font-medium">
                    {movieGroup.year && <span>{movieGroup.year}</span>}
                    {movieGroup.year && <span className="text-zinc-600">•</span>}
                    <span>
                      {movieGroup.versions.length > 1
                        ? `${movieGroup.versions.length} Versions`
                        : movieGroup.versions[0].sizeFormatted}
                    </span>

                    {/* Account badge(s) shown on hover */}
                    <div className="flex items-center gap-1 ml-auto">
                      {movieGroup.versions.length === 1 ? (() => {
                        const acc = getAccount(movieGroup.versions[0].account_id);
                        return acc && <AccountBadge accountId={acc.id} email={acc.torbox_email} variant="inline" />;
                      })() : (
                        <div className="flex items-center -space-x-1">
                          {/* Deduplicate account badges across versions */}
                          {[...new Set(movieGroup.versions.map(v => v.account_id))].map(accId => {
                            const acc = getAccount(accId);
                            return acc && <AccountBadge key={accId} accountId={acc.id} email={acc.torbox_email} variant="inline" />;
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Inline action buttons — only when NOT compact */}
                {!compactActions && (
                  <div className="flex items-center gap-2 w-full">
                    <Button
                      size="sm"
                      onClick={() => onActionClick(movieGroup, "stream")}
                      className="h-10 w-10 shrink-0 bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                    >
                      <Play size={15} className="fill-current" />
                    </Button>
                    <Button
                      size="icon"
                      variant="secondary"
                      onClick={() => onActionClick(movieGroup, "copy")}
                      className="h-10 w-10 shrink-0 bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                      title="Copy CDN Link"
                    >
                      <Copy size={15} />
                    </Button>
                    {LOCAL_DAEMON_PLAYERS.includes(playerProtocol) && (
                      <Button
                        size="icon"
                        variant="secondary"
                        onClick={() => onActionClick(movieGroup, "syncplay")}
                        className="h-10 w-10 shrink-0 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 cursor-pointer"
                        title="Syncplay with friends"
                      >
                        <Users size={15} />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="secondary"
                      onClick={() => onActionClick(movieGroup, "delete")}
                      className="h-10 w-10 shrink-0 bg-red-500/20 hover:bg-red-500/30 text-red-300 cursor-pointer"
                      title="Delete Torrent"
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                )}
              </div>

              {/* Resume progress bar at the bottom of the card */}
              <WatchedProgressBar
                percent={movieGroup.percent ?? null}
                completed={movieGroup.completed}
              />
            </div>
          </Card>
        ))
      )}

      <Dialog open={!!actionState} onOpenChange={(open) => { if (!open) setActionState(null); }}>
        <DialogContent className="sm:max-w-md bg-background/95 backdrop-blur-xl border-border/60">
          <DialogHeader>
            <DialogTitle className="capitalize">Select Version to {actionState?.action}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 mt-2">
            {actionState?.movieGroup.versions.map(v => {
              const acc = getAccount(v.account_id);
              return (
                <Button
                  key={v.id}
                  variant="outline"
                  className="flex items-start justify-between h-auto py-3 px-4 hover:bg-muted/50 cursor-pointer text-left w-full gap-3"
                  onClick={() => {
                    executeAction(actionState.action, v);
                    setActionState(null);
                  }}
                >
                  <div className="flex items-start gap-2.5 flex-1 min-w-0">
                    <div className="mt-0.5 shrink-0">
                      <AccountBadge accountId={v.account_id} email={acc?.torbox_email || ""} variant="inline" />
                    </div>
                    <span className="text-muted-foreground/60 shrink-0 mt-[1px]">-</span>
                    <span className="font-medium text-sm whitespace-normal break-all leading-snug">
                      {v.filename}
                    </span>
                  </div>
                  <span className="text-muted-foreground text-xs font-mono shrink-0 whitespace-nowrap mt-0.5">
                    {v.sizeFormatted}
                  </span>
                </Button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <DeleteTorrentDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        onConfirm={handleDeleteConfirm}
        title="Delete Movie?"
        description={`This will permanently delete "${deleteTarget?.title}" from your TorBox account and remove it from your library. This action cannot be undone.`}
        isDeleting={isDeleting}
      />
    </div>
  );
}
