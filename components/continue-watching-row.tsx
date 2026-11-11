"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Check, X, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { launchPlayback } from "@/lib/client-play";
import type { ContinueWatchingItem } from "@/lib/types";
import { useFileStore } from "@/lib/store";

interface ContinueWatchingRowProps {
  playerProtocol: string;
}

const FOCUS_RELOAD_MIN_INTERVAL_MS = 10_000;

export function ContinueWatchingRow({ playerProtocol }: ContinueWatchingRowProps) {
  const {
    viewMode,
    continueWatchingCollapsed,
    setContinueWatchingCollapsed,
    hydrateContinueWatchingCollapsed,
  } = useFileStore();
  const [items, setItems] = useState<ContinueWatchingItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const lastLoadAtRef = useRef(0);

  const load = useCallback(async () => {
    lastLoadAtRef.current = Date.now();
    try {
      const res = await fetch("/api/library/continue-watching");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items || []);
      setLoaded(true);
    } catch {
      // ignore — row stays hidden
    }
  }, []);

  useEffect(() => {
    hydrateContinueWatchingCollapsed();
    load();
    let timeoutId: NodeJS.Timeout | undefined;
    const onFocus = () => {
      // Debounce: collapse rapid focus/blur bursts into a single scheduled load.
      clearTimeout(timeoutId);
      // Add a small delay so the player's final progress save can reach the backend
      // before we fetch the new continue watching list.
      timeoutId = setTimeout(() => {
        // Throttle: skip if a load already happened recently.
        if (Date.now() - lastLoadAtRef.current < FOCUS_RELOAD_MIN_INTERVAL_MS) return;
        load();
      }, 500);
    };

    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("focus", onFocus);
    };
  }, [hydrateContinueWatchingCollapsed, load]);

  const handleMarkCompleted = async (item: ContinueWatchingItem) => {
    const res = await fetch("/api/library/continue-watching/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: item.account_id, torrent_id: item.torrent_id, file_id: item.file_id }),
    });
    if (res.ok) {
      toast.success("Marked as watched");
      window.dispatchEvent(new CustomEvent("torrent-files-updated"));
      load();
    } else {
      toast.error("Failed to mark as watched");
    }
  };

  const handleHide = async (item: ContinueWatchingItem) => {
    const res = await fetch("/api/library/continue-watching/hide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: item.account_id, torrent_id: item.torrent_id, file_id: item.file_id }),
    });
    if (res.ok) {
      toast.success("Removed from continue watching");
      load();
    } else {
      toast.error("Failed to remove");
    }
  };

  if (!loaded || items.length === 0) return null;

  const pad2 = (n: number) => String(n).padStart(2, "0");

  const subtitle = (item: ContinueWatchingItem) => {
    const sxxeyy =
      item.season_number != null && item.episode_number != null
        ? `S${pad2(item.season_number)}E${pad2(item.episode_number)}`
        : "";
    if (item.media_type === "movie") return item.year;
    if (item.media_type === "tv") {
      if (item.up_next) return `Up next · ${item.episode_title || sxxeyy}`;
      if (item.episode_title) return item.episode_title;
      return sxxeyy || item.show_title || "";
    }
    return item.filename;
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setContinueWatchingCollapsed(!continueWatchingCollapsed)}
        aria-expanded={!continueWatchingCollapsed}
        aria-controls="continue-watching-content"
        className="inline-flex items-center bg-muted p-1 rounded-xl shadow-[inset_0_1px_3px_rgba(0,0,0,0.1)] cursor-pointer select-none group/cw-toggle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-2 text-primary px-3 py-1.5 rounded-lg text-sm font-semibold group-hover/cw-toggle:bg-background/40 transition-colors">
          <Play size={15} />
          <span>Continue Watching</span>
          <motion.span
            initial={false}
            animate={{ rotate: continueWatchingCollapsed ? -90 : 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="inline-flex items-center text-muted-foreground group-hover/cw-toggle:text-primary transition-colors"
          >
            <ChevronDown size={14} />
          </motion.span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {!continueWatchingCollapsed && (
          <motion.div
            id="continue-watching-content"
            key="continue-watching-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.3, ease: [0.25, 0.1, 0.35, 1] },
              opacity: { duration: 0.15 },
            }}
            className="overflow-hidden"
          >
            <div className="pt-4">
              <div className={viewMode === "list" ? "flex flex-col gap-3" : "flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-thin"}>
                {items.map((item) => (
                  viewMode === "list" ? (
                    <div
                      key={`${item.account_id}-${item.torrent_id}-${item.file_id}`}
                      onClick={() =>
                        launchPlayback({
                          torrentId: item.torrent_id,
                          fileId: item.file_id,
                          accountId: item.account_id,
                          playerProtocol,
                        })
                      }
                      className="group flex flex-col sm:flex-row items-stretch sm:items-center gap-4 px-4 py-3 rounded-xl border border-border/40 bg-card/40 hover:bg-muted/40 hover:shadow-md transition-all duration-300 overflow-hidden relative cursor-pointer"
                    >
                      {/* Thumbnail */}
                      <div className="w-24 h-14 sm:w-20 sm:h-12 shrink-0 rounded bg-muted/30 overflow-hidden relative border border-border/50">
                        {item.backdrop_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.backdrop_url} alt={item.title} className="object-cover w-full h-full" loading="lazy" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                            <Play size={16} className="opacity-40" />
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <h3 className="text-sm font-bold tracking-tight text-foreground truncate group-hover:text-primary transition-colors">
                          {item.filename}
                        </h3>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
                          <span className="truncate">{subtitle(item)}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity mt-3 sm:mt-0 pb-1 sm:pb-0 relative z-10">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMarkCompleted(item);
                          }}
                          title="Mark as watched"
                          className="h-8 w-8 rounded-full bg-black/40 border border-white/10 text-white flex items-center justify-center hover:bg-primary/80 transition-colors cursor-pointer"
                        >
                          <Check size={14} />
                        </button>

                        {item.media_type === "tv" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleHide(item);
                            }}
                            title="Remove from continue watching"
                            className="h-8 w-8 rounded-full bg-black/40 border border-white/10 text-white flex items-center justify-center hover:bg-red-500/80 transition-colors cursor-pointer"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>

                      {/* Progress bar */}
                      {!item.up_next && item.percent > 0 && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-black/50">
                          <div className="h-full bg-primary" style={{ width: `${item.percent}%` }} />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      key={`${item.account_id}-${item.torrent_id}-${item.file_id}`}
                      onClick={() =>
                        launchPlayback({
                          torrentId: item.torrent_id,
                          fileId: item.file_id,
                          accountId: item.account_id,
                          playerProtocol,
                        })
                      }
                      className="shrink-0 snap-start w-52 sm:w-64 aspect-video rounded-xl border-0 bg-black/40 overflow-hidden group relative cursor-pointer"
                    >
                      {item.backdrop_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.backdrop_url}
                          alt={item.title}
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-muted/50 to-muted/20 text-muted-foreground">
                          <Play size={32} className="opacity-40" />
                        </div>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMarkCompleted(item);
                        }}
                        title="Mark as watched"
                        className="absolute top-2 right-2 z-10 h-7 w-7 rounded-full bg-black/70 border border-white/10 text-white
                                 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-primary/80 cursor-pointer"
                      >
                        <Check size={14} />
                      </button>

                      {item.media_type === "tv" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleHide(item);
                          }}
                          title="Remove from continue watching"
                          className="absolute bottom-2 right-2 z-10 h-6 w-6 rounded-full bg-black/70 border border-white/10 text-white
                                   flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80 cursor-pointer"
                        >
                          <X size={12} />
                        </button>
                      )}

                      <div className={`absolute inset-x-0 bottom-0 bg-linear-to-t from-black via-black/75 to-transparent pl-3 pt-10 pb-3 ${item.media_type === "tv" ? "pr-9" : "pr-3"}`}>
                        <div className="flex items-baseline gap-1.5 overflow-hidden">
                          <h3 className="text-sm font-display font-bold text-white truncate">
                            {item.title}
                          </h3>
                          {item.media_type === "tv" && item.season_number != null && item.episode_number != null && (
                            <span className="shrink-0 text-[11px] font-medium text-white/50 tracking-wide">
                              S{pad2(item.season_number)}E{pad2(item.episode_number)}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-300 line-clamp-1">{subtitle(item)}</p>
                      </div>

                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="h-12 w-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center">
                          <Play size={20} className="fill-current text-white" />
                        </div>
                      </div>

                      {!item.up_next && item.percent > 0 && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.75 bg-black/50">
                          <div className="h-full bg-primary" style={{ width: `${item.percent}%` }} />
                        </div>
                      )}
                    </div>
                  )
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
