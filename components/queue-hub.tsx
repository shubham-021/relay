"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  X,
  Info,
  RotateCcw,
  Zap,
  Sparkles,
  Search,
  Film,
  Tv,
  Check,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { AccountBadge } from "@/components/account-badge";
import { useAddQueueStore, type QueueItem } from "@/lib/queue-store";
import { useFileStore } from "@/lib/store";
import { formatBytes, cn } from "@/lib/utils";

// --- Info Popover Modal ---

function QueueItemInfoModal({
  item,
  accounts,
  onClose,
}: {
  item: QueueItem;
  accounts: any[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
      <div className="bg-zinc-900 border border-zinc-700/80 ring-1 ring-white/10 shadow-[0_30px_70px_rgba(0,0,0,0.95)] rounded-2xl w-[460px] max-w-[94vw] max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-zinc-800/70 border-b border-zinc-700/70 shrink-0">
          <div className="flex items-center gap-2">
            <Info size={16} className="text-primary" />
            <h3 className="text-sm font-semibold text-zinc-100">Request Details</h3>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/60 shrink-0 cursor-pointer"
            onClick={onClose}
          >
            <X size={14} />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 pb-8 space-y-4 min-h-0">
          <div className="p-3 rounded-xl bg-zinc-800/40 border border-zinc-700/50">
            <p className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold mb-1">
              Torrent
            </p>
            <p className="text-sm font-medium text-zinc-100 break-words leading-snug">
              {item.torrentName}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-zinc-800/40 border border-zinc-700/50">
              <p className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold mb-1">
                Size
              </p>
              <p className="text-xs font-medium text-zinc-200">
                {item.sizeBytes > 0 ? formatBytes(item.sizeBytes) : "Unknown"}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-zinc-800/40 border border-zinc-700/50 min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold mb-1">
                Info Hash
              </p>
              <p className="text-xs font-mono text-zinc-300 truncate" title={item.torrentHash}>
                {item.torrentHash}
              </p>
            </div>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold mb-2">
              Target Accounts ({item.accountIds.length})
            </p>
            <div className="space-y-2">
              {item.accountIds.map((accountId) => {
                const email = item.accountEmails[accountId] || "Unknown";
                const result = item.results?.find((r) => r.account_id === accountId);

                return (
                  <div
                    key={accountId}
                    className="p-3 rounded-xl bg-zinc-800/50 border border-zinc-700/50"
                  >
                    <div className="flex items-center gap-2.5">
                      <AccountBadge accountId={accountId} email={email} />
                      <span className="text-xs text-zinc-200 font-medium truncate flex-1">
                        {email}
                      </span>
                      {result && (
                        <span className="shrink-0">
                          {result.success ? (
                            <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                              <CheckCircle2 size={12} />
                              Success
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[11px] font-medium text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">
                              <XCircle size={12} />
                              Failed
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    {result && !result.success && result.error && (
                      <div className="mt-2 pt-2 border-t border-red-500/20 text-[11px] text-red-300 font-mono break-all leading-normal flex items-start gap-1.5">
                        <AlertTriangle size={12} className="shrink-0 text-red-400 mt-0.5" />
                        <span>{result.error}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- TMDB Match Selection Dialog ---

interface SearchCandidate {
  id: number;
  title: string;
  year: string;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string | null;
  mediaType: "movie" | "tv";
}

function QueueTmdbSelectionDialog({
  item,
  onClose,
  onResolve,
}: {
  item: QueueItem;
  onClose: () => void;
  onResolve: (selection?: { tmdbId: number; category: "movie" | "tv" }) => void;
}) {
  const [category, setCategory] = useState<"movie" | "tv">(
    item.actionPayload?.detectedCategory || "movie"
  );
  const [query, setQuery] = useState(
    item.actionPayload?.parsedTitle || item.torrentName
  );
  const [searchResults, setSearchResults] = useState<SearchCandidate[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<SearchCandidate | null>(null);

  const performSearch = useCallback(async (q: string, cat: "movie" | "tv") => {
    if (!q || q.trim().length < 2) return;
    setIsSearching(true);
    try {
      const res = await fetch(
        `/api/metadata?action=search&query=${encodeURIComponent(q.trim())}&category=${cat}`
      );
      const data = await res.json();
      if (res.ok && Array.isArray(data.results)) {
        setSearchResults(data.results);
      } else {
        setSearchResults([]);
      }
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    performSearch(query, category);
  }, [category, performSearch, query]);

  const handleCategorySwitch = (cat: "movie" | "tv") => {
    setCategory(cat);
    setSelectedCandidate(null);
  };

  const handleConfirm = () => {
    if (selectedCandidate) {
      onResolve({ tmdbId: selectedCandidate.id, category });
    } else {
      onResolve(undefined); // Auto fallback
    }
  };

  const handleSkip = () => {
    onResolve(undefined); // Auto fallback per specification #3
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) handleSkip(); }}>
      <DialogContent className="sm:max-w-xl max-h-[88vh] flex flex-col bg-zinc-900 border-zinc-700/80 ring-1 ring-white/10 shadow-2xl p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 bg-zinc-800/40 border-b border-zinc-800">
          <DialogTitle className="text-zinc-100 flex items-center gap-2">
            <Sparkles size={16} className="text-primary" />
            Match Media: <span className="font-normal text-zinc-300 truncate max-w-[340px]">{item.torrentName}</span>
          </DialogTitle>
          <DialogDescription className="text-zinc-400 text-xs">
            Select the correct TMDB entry to link metadata and poster artwork
          </DialogDescription>
        </DialogHeader>

        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
          {/* Category Switcher */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-300">Category</span>
            <div className="inline-flex rounded-lg bg-zinc-950 p-1 border border-zinc-800">
              <button
                type="button"
                onClick={() => handleCategorySwitch("movie")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 text-xs rounded-md font-medium transition-all cursor-pointer",
                  category === "movie"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                )}
              >
                <Film size={13} />
                Movie
              </button>
              <button
                type="button"
                onClick={() => handleCategorySwitch("tv")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 text-xs rounded-md font-medium transition-all cursor-pointer",
                  category === "tv"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                )}
              >
                <Tv size={13} />
                Series
              </button>
            </div>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${category === "movie" ? "movies" : "TV series"}...`}
              className="pl-9 h-9 text-xs bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-primary/40"
            />
            {isSearching && (
              <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-zinc-400" />
            )}
          </div>

          {/* Candidates List */}
          <div className="space-y-1.5 max-h-[36vh] overflow-y-auto pr-1">
            {isSearching && searchResults.length === 0 ? (
              <div className="py-10 text-center text-zinc-500 text-xs">
                Searching TMDB for &quot;{query}&quot;...
              </div>
            ) : searchResults.length === 0 ? (
              <div className="py-10 text-center text-zinc-500 text-xs">
                No matching results found. Try tweaking the search query above.
              </div>
            ) : (
              searchResults.map((cand) => {
                const isSelected = selectedCandidate?.id === cand.id;
                return (
                  <button
                    key={cand.id}
                    type="button"
                    onClick={() => setSelectedCandidate(cand)}
                    className={cn(
                      "w-full flex items-center gap-3 p-2 rounded-xl border text-left transition-all cursor-pointer",
                      isSelected
                        ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                        : "border-zinc-800/80 bg-zinc-950/40 hover:bg-zinc-800/40"
                    )}
                  >
                    {/* Poster */}
                    <div className="w-10 h-14 bg-zinc-800 rounded shrink-0 overflow-hidden border border-zinc-700/50">
                      {cand.posterPath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`https://image.tmdb.org/t/p/w92${cand.posterPath}`}
                          alt={cand.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-600">
                          {category === "movie" ? <Film size={16} /> : <Tv size={16} />}
                        </div>
                      )}
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-semibold text-zinc-100 truncate">
                          {cand.title}
                        </span>
                        {cand.year && (
                          <span className="text-[11px] text-zinc-400 shrink-0">
                            ({cand.year})
                          </span>
                        )}
                      </div>
                      {cand.overview && (
                        <p className="text-[11px] text-zinc-400 line-clamp-1 mt-0.5">
                          {cand.overview}
                        </p>
                      )}
                      <div className="text-[10px] text-zinc-500 mt-1">TMDB ID: {cand.id}</div>
                    </div>

                    {/* Select Indicator */}
                    <div className="shrink-0 pl-1">
                      {isSelected ? (
                        <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
                          <Check size={11} strokeWidth={3} />
                        </div>
                      ) : (
                        <div className="w-5 h-5 rounded-full border border-zinc-700" />
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-3.5 bg-zinc-800/40 border-t border-zinc-800 flex items-center justify-between sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSkip}
            className="text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
          >
            Skip (Use Auto)
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={!selectedCandidate}
            className="text-xs bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer gap-1.5"
          >
            <Check size={13} />
            Confirm & Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Main Queue Hub Component (Bottom Conveyor) ---

export function QueueHub({ accounts: propAccounts }: { accounts?: any[] }) {
  const {
    queue,
    completed,
    activeActionId,
    setActiveActionId,
    resolveActionItem,
    dismissItem,
    cancelQueued,
    retryFailed,
  } = useAddQueueStore();

  const storeAccounts = useFileStore((s) => s.accounts);
  const accounts = propAccounts || storeAccounts || [];

  const [infoItem, setInfoItem] = useState<QueueItem | null>(null);

  // Combine active queue and recent completed items for the horizontal conveyor
  const allItems = [...queue, ...completed];
  const activeActionItem = queue.find((i) => i.id === activeActionId);

  if (allItems.length === 0) return null;

  return (
    <>
      {/* Bottom Horizontal Queue Bar */}
      <div className="fixed bottom-5 inset-x-0 z-50 flex justify-center pointer-events-none px-4">
        <motion.div
          layout
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 30 }}
          transition={{ type: "spring", stiffness: 350, damping: 28 }}
          className="pointer-events-auto flex items-center gap-2 p-1.5 sm:p-2 rounded-2xl bg-zinc-950/90 backdrop-blur-xl border border-zinc-800/90 shadow-[0_20px_50px_rgba(0,0,0,0.85)] ring-1 ring-white/10 max-w-[95vw] overflow-x-auto scrollbar-none"
        >
          {/* Queue Header Badge */}
          <div className="flex items-center gap-2 pl-2 pr-3 border-r border-zinc-800/90 shrink-0">
            <div className="flex items-center justify-center w-7 h-7 rounded-xl bg-primary/20 text-primary">
              <Zap size={14} className="fill-current" />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-bold text-zinc-200 tracking-wide leading-none">
                Queue
              </span>
              <span className="text-[10px] text-zinc-400 font-medium mt-0.5">
                {queue.length} active
              </span>
            </div>
          </div>

          {/* Horizontal Conveyor Track */}
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none py-0.5 px-0.5">
            <AnimatePresence mode="popLayout">
              {allItems.map((item) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, x: 100, scale: 0.9 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: -100, scale: 0.9 }}
                  transition={{ type: "spring", stiffness: 380, damping: 28 }}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-xl border bg-zinc-900/95 shadow-sm min-w-[240px] max-w-[320px] shrink-0 transition-colors",
                    item.status === "action-needed"
                      ? "border-amber-500/70 ring-1 ring-amber-500/30 bg-amber-950/25 hover:bg-amber-950/35 cursor-pointer"
                      : item.status === "failed"
                      ? "border-red-500/40 bg-red-500/5"
                      : item.status === "completed"
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "border-zinc-800 bg-zinc-900/90"
                  )}
                >
                  {/* Status Icon */}
                  <div className="shrink-0 flex items-center justify-center">
                    {item.status === "in-progress" ? (
                      <Loader2 size={14} className="animate-spin text-primary" />
                    ) : item.status === "action-needed" ? (
                      <AlertTriangle size={14} className="text-amber-400 shrink-0 animate-pulse" />
                    ) : item.status === "completed" ? (
                      <CheckCircle2 size={14} className="text-emerald-400" />
                    ) : item.status === "failed" ? (
                      <XCircle size={14} className="text-red-400" />
                    ) : (
                      <Clock size={14} className="text-zinc-400" />
                    )}
                  </div>

                  {/* Title & Status Message */}
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => {
                      if (item.status === "action-needed") {
                        setActiveActionId(item.id);
                      } else {
                        setInfoItem(item);
                      }
                    }}
                    title={item.status === "action-needed" ? "Click to match TMDB metadata" : "Click for details"}
                  >
                    <p className="text-xs font-semibold text-zinc-100 truncate leading-snug">
                      {item.torrentName}
                    </p>
                    <p className="text-[10px] text-zinc-400 truncate leading-tight mt-0.5">
                      {item.status === "action-needed" ? (
                        <span className="text-amber-300 font-medium">Partially Added • Select Metadata</span>
                      ) : (
                        item.message ||
                        (item.status === "queued"
                          ? "Waiting in queue"
                          : item.status === "completed"
                          ? "Added successfully"
                          : "Processing...")
                      )}
                    </p>
                  </div>

                  {/* Actions on Item */}
                  <div className="shrink-0 flex items-center gap-1">
                    {item.status === "action-needed" && (
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveActionId(item.id);
                        }}
                        className="h-6.5 px-2.5 text-[11px] font-bold bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-lg gap-1 cursor-pointer shadow-xs"
                      >
                        <Sparkles size={11} className="fill-zinc-950" />
                        Select
                      </Button>
                    )}

                    {item.status === "failed" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => retryFailed(item.id)}
                        className="h-6 w-6 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-md cursor-pointer"
                        title="Retry"
                      >
                        <RotateCcw size={12} />
                      </Button>
                    )}

                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (item.status === "queued") {
                          cancelQueued(item.id);
                        } else if (item.status === "action-needed") {
                          resolveActionItem(item.id, undefined);
                        } else {
                          dismissItem(item.id);
                        }
                      }}
                      className="h-6 w-6 text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 rounded-md cursor-pointer"
                      title={item.status === "queued" ? "Cancel" : item.status === "action-needed" ? "Skip & Use Auto" : "Dismiss"}
                    >
                      <X size={12} />
                    </Button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>

      {/* Info Popover Modal */}
      {infoItem && (
        <QueueItemInfoModal
          item={infoItem}
          accounts={accounts}
          onClose={() => setInfoItem(null)}
        />
      )}

      {/* TMDB Selection Dialog for Action-Needed item */}
      {activeActionItem && (
        <QueueTmdbSelectionDialog
          item={activeActionItem}
          onClose={() => setActiveActionId(null)}
          onResolve={(selection) => resolveActionItem(activeActionItem.id, selection)}
        />
      )}
    </>
  );
}
