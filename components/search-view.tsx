"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import {
  Search,
  HardDrive,
  Loader2,
  XCircle,
  CheckCircle2,
  Plus,
  Filter,
  ListOrdered,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AccountSelectDialog } from "@/components/account-select-dialog";
import { QueueHub } from "@/components/queue-hub";
import { useFileStore } from "@/lib/store";
import { useAddQueueStore } from "@/lib/queue-store";
import { parseInput } from "@/tor_sources/magnet";
import { formatBytes } from "@/lib/utils";
import { toast } from "sonner";

// --- Types ---

interface CachedFileInfo {
  id: number;
  name: string;
  size: number;
  short_name: string;
  mimetype: string;
}

interface CachedTorrentResult {
  name: string;
  size: number;
  hash: string;
  files: CachedFileInfo[];
}

interface SearchResult {
  infoHash: string;
  name: string;
  sizeBytes: number;
  seeders: number;
  leechers: number;
  numFiles?: number;
  source: string;
  magnet: string;
  added?: number;
  reportsHealth: boolean;
}

type SearchStatus = "idle" | "searching" | "results" | "error";
type CacheStatus = "idle" | "checking" | "cached" | "not-cached";

// --- Helpers ---

function isMagnetInput(value: string): boolean {
  const s = value.trim();
  if (/^magnet:\?/i.test(s)) return true;
  if (/^[a-f0-9]{40}$/i.test(s)) return true;
  if (/^[a-z2-7]{32}$/i.test(s)) return true;
  return false;
}

// --- Component ---

interface SearchViewProps {
  accounts: any[];
  hasAccounts: boolean;
  availableSources?: { id: string; label: string }[];
}

export function SearchView({ accounts, hasAccounts, availableSources = [] }: SearchViewProps) {
  const { activeAccountId } = useFileStore();
  const { getHashStatus, getAccountStatuses } = useAddQueueStore();

  // Search state
  const [query, setQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchErrors, setSearchErrors] = useState<{ sourceId: string; error: string }[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [completedSources, setCompletedSources] = useState(0);
  const [totalSources, setTotalSources] = useState(0);

  const handleCancelSearch = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setSearchStatus("results");
    try {
      await fetch("/api/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search" }),
      });
    } catch (e) {
      // ignore
    }
  };

  // Source selection
  const [enabledSources, setEnabledSources] = useState<string[]>([]);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("enabledSearchSources");
      if (saved) {
        setEnabledSources(JSON.parse(saved));
      } else if (availableSources.length > 0) {
        setEnabledSources(availableSources.map((s) => s.id));
      }
    } catch {
      if (availableSources.length > 0) {
        setEnabledSources(availableSources.map((s) => s.id));
      }
    }
    setSourcesLoaded(true);
  }, [availableSources]);

  const toggleSource = (id: string) => {
    setEnabledSources((prev) => {
      const next = prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id];
      localStorage.setItem("enabledSearchSources", JSON.stringify(next));
      return next;
    });
  };

  const selectAllSources = () => {
    const all = availableSources.map((s) => s.id);
    setEnabledSources(all);
    localStorage.setItem("enabledSearchSources", JSON.stringify(all));
  };

  const clearAllSources = () => {
    setEnabledSources([]);
    localStorage.setItem("enabledSearchSources", JSON.stringify([]));
  };

  // Magnet detection
  const isMagnet = useMemo(() => isMagnetInput(query), [query]);

  // Cache check state (per-result)
  const [cacheStatuses, setCacheStatuses] = useState<Map<string, CacheStatus>>(new Map());
  const [cacheResults, setCacheResults] = useState<Map<string, CachedTorrentResult>>(new Map());

  // Account dialog state
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [pendingMagnet, setPendingMagnet] = useState<{
    hash: string;
    magnet: string;
    cachedFiles: CachedFileInfo[];
  } | null>(null);

  // --- Handlers ---

  const handleSearch = async () => {
    if (!query.trim() || isMagnet) return;
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setSearchStatus("searching");
    setCacheStatuses(new Map());
    setCacheResults(new Map());
    setResults([]);
    setSearchErrors([]);
    setCompletedSources(0);
    setTotalSources(sourcesLoaded && enabledSources.length > 0 ? enabledSources.length : availableSources.length);

    try {
      let url = `/api/search?q=${encodeURIComponent(query.trim())}`;
      if (sourcesLoaded) {
        url += `&sources=${enabledSources.join(",")}`;
      }
      
      const res = await fetch(url, { signal: controller.signal });
      if (res.status === 401) { window.location.href = "/login"; return; }
      if (!res.ok) throw new Error("Search failed");
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const resultsMap = new Map<string, SearchResult>();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || ""; 

        for (const block of lines) {
          if (!block.trim()) continue;
          
          const eventMatch = block.match(/event: (.*)\n/);
          const dataMatch = block.match(/data: (.*)/);
          
          if (eventMatch && dataMatch) {
            const eventType = eventMatch[1].trim();
            const dataStr = dataMatch[1].trim();
            const data = JSON.parse(dataStr);
            
            if (eventType === "source") {
              if (data.error) {
                setSearchErrors(prev => [...prev, { sourceId: data.sourceId, error: data.error }]);
              } else if (data.results && Array.isArray(data.results)) {
                let updated = false;
                for (const item of data.results) {
                  const existing = resultsMap.get(item.infoHash);
                  if (!existing || item.seeders > existing.seeders) {
                    resultsMap.set(item.infoHash, item);
                    updated = true;
                  }
                }
                if (updated) {
                  const newResults = Array.from(resultsMap.values()).sort((a, b) => b.seeders - a.seeders);
                  setResults(newResults);
                }
              }
              setCompletedSources(prev => prev + 1);
            } else if (eventType === "done") {
               // Done
            }
          }
        }
      }
      
      setSearchStatus("results");
    } catch (error: any) {
      if (error.name === "AbortError") {
        return;
      }
      toast.error(error instanceof Error ? error.message : "Search failed");
      setSearchStatus("error");
    } finally {
      if (abortControllerRef.current === controller) {
         abortControllerRef.current = null;
      }
    }
  };

  const handleCheckMagnet = async () => {
    if (!isMagnet) return;
    const parsed = parseInput(query.trim());
    if (!parsed) { toast.error("Invalid magnet link or hash"); return; }

    const { infoHash, magnet } = parsed;
    setCacheStatuses(new Map([[infoHash, "checking"]]));
    setCacheResults(new Map());
    setResults([{
      infoHash,
      name: parsed.name,
      sizeBytes: 0,
      seeders: 0,
      leechers: 0,
      source: "manual",
      magnet,
      reportsHealth: false,
    }]);
    setSearchStatus("results");

    try {
      const params = new URLSearchParams({ hash: infoHash });
      const res = await fetch(`/api/torrent/check-cache?${params}`);
      if (res.status === 401) { window.location.href = "/login"; return; }

      const data = await res.json();
      const cached = data.data?.[infoHash] || null;

      setCacheStatuses(new Map([[infoHash, cached ? "cached" : "not-cached"]]));
      if (cached) {
        setCacheResults(new Map([[infoHash, cached]]));
      }
    } catch {
      setCacheStatuses(new Map([[infoHash, "not-cached"]]));
      toast.error("Failed to check cache");
    }
  };

  const handleCheckCache = async (result: SearchResult) => {
    const hash = result.infoHash;
    setCacheStatuses((prev) => new Map(prev).set(hash, "checking"));

    try {
      const params = new URLSearchParams({ hash });
      const res = await fetch(`/api/torrent/check-cache?${params}`);
      if (res.status === 401) { window.location.href = "/login"; return; }

      const data = await res.json();
      const cached = data.data?.[hash] || null;

      setCacheStatuses((prev) => new Map(prev).set(hash, cached ? "cached" : "not-cached"));
      if (cached) {
        setCacheResults((prev) => new Map(prev).set(hash, cached));
      }
    } catch {
      setCacheStatuses((prev) => new Map(prev).set(hash, "not-cached"));
    }
  };

  const handleAddClick = (result: SearchResult) => {
    const cached = cacheResults.get(result.infoHash);
    if (!cached) return;

    setPendingMagnet({
      hash: result.infoHash,
      magnet: result.magnet,
      cachedFiles: cached.files,
    });
    setAccountDialogOpen(true);
  };

  const handleAccountConfirm = async (selectedAccountIds: number[]) => {
    if (!pendingMagnet || selectedAccountIds.length === 0) return;

    const result = results.find((r) => r.infoHash === pendingMagnet.hash);
    const torrentName = result?.name || pendingMagnet.hash;

    // Build account email map for display in the queue hub
    const accountEmails: Record<number, string> = {};
    for (const id of selectedAccountIds) {
      const acc = accounts.find((a: any) => a.id === id);
      if (acc) accountEmails[id] = acc.torbox_email;
    }

    const enqueued = useAddQueueStore.getState().enqueue({
      torrentName,
      torrentHash: pendingMagnet.hash,
      sizeBytes: result?.sizeBytes || 0,
      magnet: pendingMagnet.magnet,
      cachedFiles: pendingMagnet.cachedFiles,
      accountIds: selectedAccountIds,
      accountEmails,
    });

    if (!enqueued) {
      toast.error("Queue is full (max 10 items). Wait for items to complete.");
      return;
    }

    setAccountDialogOpen(false);
    setPendingMagnet(null);
    toast.success(`"${torrentName.slice(0, 40)}${torrentName.length > 40 ? "..." : ""}" added to queue`);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="px-6 pt-6 pb-2">
        <div className="relative max-w-2xl mx-auto flex items-center gap-2">
          <div className="relative flex-1">
            {isMagnet ? (
              <HardDrive size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            ) : (
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            )}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  isMagnet ? handleCheckMagnet() : handleSearch();
                }
              }}
              placeholder={isMagnet ? "Magnet link detected — click Check Cache" : "Search torrents or paste a magnet link..."}
              className="w-full pl-10 pr-32 py-3 rounded-xl bg-muted/30 border border-border/50 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
              autoFocus
            />
            <Button
              onClick={isMagnet ? handleCheckMagnet : handleSearch}
              disabled={!query.trim() || searchStatus === "searching"}
              className="absolute right-2 top-1/2 -translate-y-1/2 gap-1.5"
              size="sm"
            >
              {searchStatus === "searching" ? (
                <Loader2 size={16} className="animate-spin" />
              ) : isMagnet ? (
                <><HardDrive size={16} /> Check Cache</>
              ) : (
                <><Search size={16} /> Search</>
              )}
            </Button>
          </div>
          {availableSources.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0 h-[46px] w-[46px] rounded-xl border-border/50 bg-muted/30 hover:bg-muted/50">
                  <Filter size={18} className="text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 max-h-[60vh] overflow-y-auto">
                <div className="flex items-center justify-between px-2.5 py-1.5 text-xs border-b border-border/50 mb-1">
                  <span className="font-semibold text-foreground">Sources</span>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        selectAllSources();
                      }}
                      className="hover:text-primary transition-colors cursor-pointer"
                    >
                      All
                    </button>
                    <span>•</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        clearAllSources();
                      }}
                      className="hover:text-primary transition-colors cursor-pointer"
                    >
                      None
                    </button>
                  </div>
                </div>
                {availableSources.map((source) => (
                  <DropdownMenuCheckboxItem
                    key={source.id}
                    checked={enabledSources.includes(source.id)}
                    onCheckedChange={() => toggleSource(source.id)}
                  >
                    {source.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Partial source failure warnings */}
      {searchErrors.length > 0 && searchStatus === "results" && (
        <div className="px-6 pb-2">
          <div className="max-w-2xl mx-auto">
            <p className="text-xs text-amber-500/80">
              {searchErrors.length} source{searchErrors.length > 1 ? "s" : ""} failed:{" "}
              {searchErrors.map((e) => e.sourceId).join(", ")}
            </p>
          </div>
        </div>
      )}

      {/* Idle state */}
      {searchStatus === "idle" && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <Search size={48} className="mx-auto mb-4 opacity-20" />
            <p className="text-sm">Search across 10 torrent sources</p>
            <p className="text-xs mt-1">or paste a magnet link to check its cache status</p>
          </div>
        </div>
      )}

      {/* Loading & Streaming state */}
      {searchStatus === "searching" && (
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col">
          <div className="flex items-center justify-between bg-muted/30 border border-border/50 rounded-2xl p-4 mb-4">
            <div className="flex items-center gap-3">
              <Loader2 size={20} className="animate-spin text-primary" />
              <div>
                <p className="text-sm font-medium">Searching Sources...</p>
                <p className="text-xs text-muted-foreground">
                  {completedSources} / {totalSources} completed
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleCancelSearch} className="gap-1.5 border-red-500/20 text-red-500 hover:bg-red-500/10">
              <XCircle size={14} /> Cancel
            </Button>
          </div>
          
          {/* Show partial results while searching */}
          {results.length > 0 && (
            <div className="max-w-3xl mx-auto space-y-4 w-full">
              <div className="text-sm font-medium text-muted-foreground mb-4">
                Found {results.length} result{results.length !== 1 ? "s" : ""} so far...
              </div>
              {results.map((result) => {
                const status = cacheStatuses.get(result.infoHash) ?? "idle";
                return (
                  <div
                    key={result.infoHash}
                    className="flex items-center gap-4 p-4 border-b border-border/30"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold whitespace-normal break-words leading-snug">
                        {result.name}
                      </p>
                      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
                        <span>{result.source}</span>
                        {result.sizeBytes > 0 && (
                          <span>{formatBytes(result.sizeBytes)}</span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {status === "idle" && (
                        <Button variant="outline" size="sm" onClick={() => handleCheckCache(result)}>
                          Check Cache
                        </Button>
                      )}
                      {status === "checking" && (
                        <Loader2 size={16} className="animate-spin text-muted-foreground" />
                      )}
                      {status === "not-cached" && (
                        <span className="flex items-center gap-1 text-xs text-red-400">
                          <XCircle size={14} /> Not cached
                        </span>
                      )}
                      {status === "cached" && (() => {
                        const hashStatus = getHashStatus(result.infoHash);
                        if (hashStatus === "queued") {
                          return (
                            <span className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 px-2.5 py-1 rounded-full border border-primary/20">
                              <ListOrdered size={13} /> Queued
                            </span>
                          );
                        }
                        if (hashStatus === "in-progress") {
                          return (
                            <span className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 px-2.5 py-1 rounded-full border border-primary/20">
                              <Loader2 size={13} className="animate-spin" /> Adding...
                            </span>
                          );
                        }
                        if (hashStatus === "completed") {
                          return (
                            <div className="flex items-center gap-1.5">
                              <span className="flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                                <CheckCircle2 size={13} /> Added
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleAddClick(result)}
                                className="h-7 px-2.5 text-xs gap-1 hover:bg-muted/40"
                                title="Add to another account"
                              >
                                <Plus size={12} /> Add
                              </Button>
                            </div>
                          );
                        }
                        if (hashStatus === "partial") {
                          return (
                            <div className="flex items-center gap-1.5">
                              <span className="flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                                <AlertTriangle size={13} /> Partial
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleAddClick(result)}
                                className="h-7 px-2.5 text-xs gap-1 hover:bg-muted/40"
                                title="Add to another account"
                              >
                                <Plus size={12} /> Add
                              </Button>
                            </div>
                          );
                        }
                        if (hashStatus === "failed") {
                          return (
                            <div className="flex items-center gap-1.5">
                              <span className="flex items-center gap-1 text-xs font-medium text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">
                                <XCircle size={13} /> Failed
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleAddClick(result)}
                                className="h-7 px-2.5 text-xs gap-1 border-red-500/30 text-red-400 hover:bg-red-500/10"
                                title="Retry or add to another account"
                              >
                                <RotateCcw size={12} /> Retry / Add
                              </Button>
                            </div>
                          );
                        }
                        return (
                          <Button size="sm" onClick={() => handleAddClick(result)} className="gap-1">
                            <Plus size={13} /> Add
                          </Button>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Results list */}
      {searchStatus === "results" && (
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {results.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-muted-foreground">
                <XCircle size={48} className="mx-auto mb-4 opacity-20" />
                <p className="text-sm">No results found</p>
                <p className="text-xs mt-1">Try different search terms</p>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto">
              <div className="text-sm font-medium text-muted-foreground mb-4">
                Found {results.length} result{results.length !== 1 ? "s" : ""}
              </div>
              {results.map((result) => {
                const status = cacheStatuses.get(result.infoHash) ?? "idle";

                return (
                  <div
                    key={result.infoHash}
                    className="flex items-center gap-4 p-4 border-b border-border/30"
                  >
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold whitespace-normal break-words leading-snug">
                        {result.name}
                      </p>
                      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
                        <span>{result.source}</span>
                        {result.sizeBytes > 0 && (
                          <span>{formatBytes(result.sizeBytes)}</span>
                        )}
                      </div>
                    </div>

                    {/* Action */}
                    <div className="shrink-0">
                      {status === "idle" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCheckCache(result)}
                        >
                          Check Cache
                        </Button>
                      )}
                      {status === "checking" && (
                        <Loader2
                          size={16}
                          className="animate-spin text-muted-foreground"
                        />
                      )}
                      {status === "not-cached" && (
                        <span className="flex items-center gap-1 text-xs text-red-400">
                          <XCircle size={14} /> Not cached
                        </span>
                      )}
                      {status === "cached" && (() => {
                        const hashStatus = getHashStatus(result.infoHash);
                        if (hashStatus === "queued") {
                          return (
                            <span className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 px-2.5 py-1 rounded-full border border-primary/20">
                              <ListOrdered size={13} /> Queued
                            </span>
                          );
                        }
                        if (hashStatus === "in-progress") {
                          return (
                            <span className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 px-2.5 py-1 rounded-full border border-primary/20">
                              <Loader2 size={13} className="animate-spin" /> Adding...
                            </span>
                          );
                        }
                        if (hashStatus === "completed") {
                          return (
                            <div className="flex items-center gap-1.5">
                              <span className="flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                                <CheckCircle2 size={13} /> Added
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleAddClick(result)}
                                className="h-7 px-2.5 text-xs gap-1 hover:bg-muted/40"
                                title="Add to another account"
                              >
                                <Plus size={12} /> Add
                              </Button>
                            </div>
                          );
                        }
                        if (hashStatus === "partial") {
                          return (
                            <div className="flex items-center gap-1.5">
                              <span className="flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                                <AlertTriangle size={13} /> Partial
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleAddClick(result)}
                                className="h-7 px-2.5 text-xs gap-1 hover:bg-muted/40"
                                title="Add to another account"
                              >
                                <Plus size={12} /> Add
                              </Button>
                            </div>
                          );
                        }
                        if (hashStatus === "failed") {
                          return (
                            <div className="flex items-center gap-1.5">
                              <span className="flex items-center gap-1 text-xs font-medium text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">
                                <XCircle size={13} /> Failed
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleAddClick(result)}
                                className="h-7 px-2.5 text-xs gap-1 border-red-500/30 text-red-400 hover:bg-red-500/10"
                                title="Retry or add to another account"
                              >
                                <RotateCcw size={12} /> Retry / Add
                              </Button>
                            </div>
                          );
                        }
                        return (
                          <Button
                            size="sm"
                            onClick={() => handleAddClick(result)}
                            className="gap-1"
                          >
                            <Plus size={13} /> Add
                          </Button>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Error state */}
      {searchStatus === "error" && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <XCircle size={48} className="mx-auto mb-4 opacity-20 text-red-400" />
            <p className="text-sm">Search failed</p>
            <p className="text-xs mt-1">Please try again</p>
          </div>
        </div>
      )}

      {/* Account selection dialog */}
      {hasAccounts && (
        <AccountSelectDialog
          open={accountDialogOpen}
          onOpenChange={setAccountDialogOpen}
          accounts={accounts}
          activeAccountId={activeAccountId}
          torrentName={
            pendingMagnet
              ? results.find((r) => r.infoHash === pendingMagnet.hash)?.name ||
                pendingMagnet.hash
              : ""
          }
          accountStatuses={pendingMagnet ? getAccountStatuses(pendingMagnet.hash) : {}}
          onConfirm={handleAccountConfirm}
        />
      )}

      {/* Queue Hub — floating bottom-right dock */}
      <QueueHub accounts={accounts} />
    </div>
  );
}
