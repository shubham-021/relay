"use client";

import { FileText, Play, Download, Copy, FolderOpen, Users, MoreVertical, Loader2, ChevronLeft, ChevronRight, Images, FileVideo, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { buildPlayerURL } from "@/lib/players";
import { Skeleton } from "@/components/ui/skeleton";
import { useCallback, useEffect, useState } from "react";
import { AccountBadge } from "@/components/account-badge";
import { useFileStore } from "@/lib/store";
import { DeleteTorrentDialog } from "@/components/delete-torrent-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function useNarrow(breakpoint = 640) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < breakpoint);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);
  return narrow;
}

interface OtherFile {
  id: number;
  account_id: number;
  torrent_id: number;
  file_id: number;
  remote_path: string;
  filename: string;
  sizeFormatted: string;
  mime_type: string;
}

interface OtherFilesViewProps {
  files: OtherFile[];
  isLoading: boolean;
  searchQuery: string;
  playerProtocol: string;
}

const LOCAL_DAEMON_PLAYERS = ["mpv", "vlc", "iina"];

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

function FileCard({ file, playerProtocol, accounts, compactActions, onDeleted }: { file: OtherFile, playerProtocol: string, accounts: any[], compactActions: boolean, onDeleted: (id: number) => void }) {
  const [currentPos, setCurrentPos] = useState(1);
  const [thumbAvailable, setThumbAvailable] = useState<boolean | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isFetchingInfo, setIsFetchingInfo] = useState(false);
  const [torrentInfo, setTorrentInfo] = useState<{ primary_title: string | null, primary_media_type: string, torrent_name: string | null } | null>(null);

  useEffect(() => {
    fetch(`/api/thumbnails/${file.account_id}/${file.torrent_id}/${file.file_id}/1`, { method: "HEAD" })
      .then((res) => setThumbAvailable(res.ok))
      .catch(() => setThumbAvailable(false));
  }, [file.account_id, file.torrent_id, file.file_id]);

  const thumbUrl = `/api/thumbnails/${file.account_id}/${file.torrent_id}/${file.file_id}/${currentPos}`;
  const account = accounts.find(a => a.id === file.account_id);

  const handleCopyLink = async () => {
    const cdnUrl = await fetchCdnLink(file.torrent_id, file.file_id, file.account_id);
    if (!cdnUrl) return;
    try {
      await navigator.clipboard.writeText(cdnUrl);
      toast.success("Link copied");
    } catch {
      toast.error("Failed to copy link");
    }
  };

  const handleStream = async () => {
    const cdnUrl = await fetchCdnLink(file.torrent_id, file.file_id, file.account_id);
    if (!cdnUrl) return;

    if (LOCAL_DAEMON_PLAYERS.includes(playerProtocol)) {
      try {
        const daemonRes = await fetch("http://localhost:9070/play", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player: playerProtocol, url: cdnUrl }),
        });
        if (daemonRes.ok) {
          toast.success(`Launched ${playerProtocol.toUpperCase()} via Local Daemon`, {
            description: "CDN stream active."
          });
          return;
        }
        throw new Error("Daemon returned error status");
      } catch {
        toast.error("Local daemon connection failed", {
          description: "Ensure Relay Aemond is running on port 9070 on your machine."
        });
        return;
      }
    }

    const playerUrl = buildPlayerURL(playerProtocol, cdnUrl);
    const link = document.createElement("a");
    link.href = playerUrl;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Opening in ${playerProtocol.toUpperCase()}`, {
      description: "CDN stream active."
    });
  };

  const handleDownload = async () => {
    const cdnUrl = await fetchCdnLink(file.torrent_id, file.file_id, file.account_id);
    if (!cdnUrl) return;
    window.open(cdnUrl, "_blank");
    toast.success("Download started");
  };

  const handleSyncplay = async () => {
    if (!LOCAL_DAEMON_PLAYERS.includes(playerProtocol)) return;
    const cdnUrl = await fetchCdnLink(file.torrent_id, file.file_id, file.account_id);
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
  };

  const handleDeleteClick = async () => {
    setIsFetchingInfo(true);
    try {
      const res = await fetch(`/api/torrent/info?account_id=${file.account_id}&torrent_id=${file.torrent_id}`);
      if (res.ok) {
        const info = await res.json();
        setTorrentInfo(info);
      } else {
        setTorrentInfo(null);
      }
    } catch {
      setTorrentInfo(null);
    } finally {
      setIsFetchingInfo(false);
      setShowDeleteDialog(true);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch("/api/torrent/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ torrent_id: file.torrent_id, account_id: file.account_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete torrent");
      toast.success("File deleted", { description: file.filename });
      onDeleted(file.id);
    } catch (e: any) {
      toast.error(e.message || "Failed to delete torrent");
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  return (
    <Card className="group relative overflow-hidden rounded-xl border-0 bg-black/40 transition-all duration-300 hover:shadow-2xl hover:shadow-primary/20">
      <div className="relative aspect-2/3 w-full overflow-hidden bg-muted/40">
        
        {thumbAvailable === true ? (
          <img
            src={thumbUrl}
            alt={file.filename}
            className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-muted/50 to-muted/20 text-muted-foreground">
            <FileVideo size={48} className="opacity-40" />
          </div>
        )}

        {/* Top Right: Account badge & 3-dots menu */}
        <div className="absolute top-2 right-2 z-30 flex items-center gap-1.5 opacity-100 transition-opacity duration-300">
          {account && <AccountBadge accountId={account.id} email={account.torbox_email} variant="overlay" />}

          {/* Compact: always-visible three-dots at top-right */}
          {compactActions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  className="h-8 w-8 rounded-full bg-black/50 hover:bg-black/80 text-white cursor-pointer ring-0 focus:outline-none"
                >
                  <MoreVertical size={15} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6} className="min-w-42.5 bg-popover/95 backdrop-blur-xl border-border/60 shadow-2xl rounded-xl p-1.5">
                <DropdownMenuItem onClick={handleStream} className="gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer text-sm font-medium hover:bg-violet-500/10 focus:bg-violet-500/10">
                  <Play size={14} className="text-violet-400 fill-violet-400" />
                  Stream
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleCopyLink} className="gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer text-sm font-medium hover:bg-primary/10 focus:bg-primary/10">
                  <Copy size={14} className="text-muted-foreground" />
                  Copy link
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDownload} className="gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer text-sm font-medium hover:bg-emerald-500/10 focus:bg-emerald-500/10">
                  <Download size={14} className="text-emerald-400" />
                  Download
                </DropdownMenuItem>
                {LOCAL_DAEMON_PLAYERS.includes(playerProtocol) && (
                  <DropdownMenuItem onClick={handleSyncplay} className="gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer text-sm font-medium hover:bg-amber-500/10 focus:bg-amber-500/10">
                    <Users size={14} className="text-amber-400" />
                    Syncplay
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleDeleteClick} disabled={isFetchingInfo} className="gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer text-sm font-medium hover:bg-red-500/10 focus:bg-red-500/10">
                  {isFetchingInfo ? <Loader2 size={14} className="text-red-400 animate-spin" /> : <Trash2 size={14} className="text-red-400" />}
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Always-visible bottom gradient overlay with title */}
        <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black via-black/80 to-transparent pt-24 pb-3.5 px-3.5 transition-opacity duration-300 group-hover:opacity-0 pointer-events-none">
          <h3 className="text-lg font-display font-bold text-white leading-snug line-clamp-2 drop-shadow-lg tracking-wide">
            {file.filename}
          </h3>
        </div>

        {/* Thumb Navigation arrows — visible on hover, no dark overlay */}
        <div className="absolute top-1/3 inset-x-0 flex items-center justify-between px-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">
          {thumbAvailable === true ? (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setCurrentPos(p => Math.max(1, p - 1)); }}
                disabled={currentPos <= 1}
                className="p-1.5 rounded-full bg-black/50 text-white hover:bg-black/80 disabled:opacity-0 transition-all cursor-pointer shadow-xl backdrop-blur-xs border border-white/10"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setCurrentPos(p => Math.min(5, p + 1)); }}
                disabled={currentPos >= 5}
                className="p-1.5 rounded-full bg-black/50 text-white hover:bg-black/80 disabled:opacity-0 transition-all cursor-pointer shadow-xl backdrop-blur-xs border border-white/10"
              >
                <ChevronRight size={20} />
              </button>
            </>
          ) : <div />}
        </div>

        {/* Action buttons — visible on hover, no dark overlay */}
        {!compactActions && (
          <div className="absolute bottom-0 inset-x-0 p-2.5 sm:p-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">
            <Button
              size="sm"
              onClick={handleStream}
              className="h-10 flex-1 sm:flex-none sm:w-10 shrink-0 bg-white/10 hover:bg-white/20 text-white cursor-pointer"
            >
              <Play size={15} className="fill-current" />
              <span className="sm:hidden">Play</span>
            </Button>
            <Button
              size="icon"
              variant="secondary"
              onClick={handleCopyLink}
              className="h-10 w-10 shrink-0 bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              title="Copy CDN Link"
            >
              <Copy size={15} />
            </Button>
            {/* <Button
              size="icon"
              variant="secondary"
              onClick={handleDownload}
              className="h-10 w-10 shrink-0 bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              title="Download File"
            >
              <Download size={15} />
            </Button> */}
            {LOCAL_DAEMON_PLAYERS.includes(playerProtocol) && (
              <Button
                size="icon"
                variant="secondary"
                onClick={handleSyncplay}
                className="h-10 w-10 shrink-0 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 cursor-pointer"
                title="Syncplay with friends"
              >
                <Users size={15} />
              </Button>
            )}
            <Button
              size="icon"
              variant="secondary"
              onClick={handleDeleteClick}
              disabled={isFetchingInfo}
              className="h-10 w-10 shrink-0 bg-red-500/20 hover:bg-red-500/30 text-red-300 cursor-pointer"
              title="Delete Torrent"
            >
              {isFetchingInfo ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            </Button>
          </div>
        )}
        
        {/* Thumb dots at very bottom overlay */}
        {thumbAvailable === true && (
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-20 pointer-events-none">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className={`w-1.5 h-1.5 rounded-full shadow-sm ${i + 1 === currentPos ? "bg-white" : "bg-white/30"}`} />
            ))}
          </div>
        )}
      </div>

      <DeleteTorrentDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={handleDelete}
        title="Delete File?"
        description={
          torrentInfo?.primary_title || torrentInfo?.torrent_name
            ? `This file belongs to "${torrentInfo.primary_title || torrentInfo.torrent_name}". Deleting it will permanently remove the ENTIRE torrent from your TorBox account. This action cannot be undone.`
            : `This will permanently delete "${file.filename}" from your TorBox account. This action cannot be undone.`
        }
        isDeleting={isDeleting}
      />
    </Card>
  );
}

export function OtherFilesView({ files, isLoading, searchQuery, playerProtocol }: OtherFilesViewProps) {
  const narrow = useNarrow(640);
  const { accounts, activeAccountId } = useFileStore();
  const [generating, setGenerating] = useState(false);
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set());

  const filtered = files.filter((f) =>
    !deletedIds.has(f.id) && f.filename.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleGenerateThumbnails = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/thumbnails/generate", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate thumbnails");
      if (data.generated > 0) {
        toast.success(`Generated thumbnails for ${data.generated} file${data.generated !== 1 ? "s" : ""}`);
        window.location.reload();
      } else if (data.failed > 0) {
        toast.error(`Failed for ${data.failed} file${data.failed !== 1 ? "s" : ""}`);
      } else {
        toast.info("No files need thumbnail generation");
      }
    } catch (e: any) {
      toast.error(e.message || "Failed to generate thumbnails");
    } finally {
      setGenerating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="aspect-2/3 rounded-xl" />
        ))}
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <FolderOpen size={48} className="text-muted-foreground/30 mb-2" />
        <p className="text-lg font-medium">No uncategorized files</p>
        <p className="text-sm">All indexed items have been parsed into Movies or TV Shows.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={handleGenerateThumbnails}
          disabled={generating || filtered.length === 0}
          className="gap-1.5"
        >
          {generating ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Images size={14} />
          )}
          {generating ? "Generating..." : "Generate Thumbnails"}
        </Button>
        <p className="text-xs text-muted-foreground">{filtered.length} files</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
        {filtered.map((file) => (
          <FileCard 
            key={file.id} 
            file={file} 
            playerProtocol={playerProtocol} 
            accounts={accounts}
            compactActions={narrow}
            onDeleted={(id) => setDeletedIds((prev) => new Set(prev).add(id))}
          />
        ))}
      </div>
    </div>
  );
}
