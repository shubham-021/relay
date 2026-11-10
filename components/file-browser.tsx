"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Film, Tv, FolderOpen, Search, PlusCircle, Loader2, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoviesGrid } from "@/components/movies-grid";
import { TvShowsGrid } from "@/components/tv-shows-grid";
import { TvShowDetail } from "@/components/tv-show-detail";
import { OtherFilesView } from "@/components/other-files-view";
import { AddAccountForm } from "@/components/add-account-form";
import { ContinueWatchingRow } from "@/components/continue-watching-row";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AccountBadge } from "@/components/account-badge";
import { toast } from "sonner";
import { useFileStore } from "@/lib/store";
import { getCachedData, setCachedData, clearLibraryCache } from "@/lib/library-cache";

interface FileBrowserProps {
  userId: number;
  playerProtocol: string;
  hasAccounts: boolean;
  accounts: {
    id: number;
    torbox_email: string;
    is_active: boolean;
    last_synced_at: string | null;
    last_updated_at: string | null;
  }[];
}

export function FileBrowser({ userId, playerProtocol, hasAccounts, accounts: accountsProp }: FileBrowserProps) {
  const { activeAccountId, setActiveAccountId, isAddingAccount, accounts, setAccounts } = useFileStore();

  const [activeTab, setActiveTab] = useState<"movies" | "tv" | "other">(() => {
    if (typeof window !== "undefined") {
      return (sessionStorage.getItem("webdoma_activeTab") as any) || "movies";
    }
    return "movies";
  });
  const [selectedShowTitle, setSelectedShowTitle] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);

  // Save active tab
  useEffect(() => {
    sessionStorage.setItem("webdoma_activeTab", activeTab);
  }, [activeTab]);

  // Restore scroll position
  useEffect(() => {
    if (!isLoading && !selectedShowTitle && scrollRef.current) {
      const savedScroll = sessionStorage.getItem(`webdoma_scroll_${activeTab}`);
      if (savedScroll) {
        // Use requestAnimationFrame to ensure the DOM has painted the list items
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = parseInt(savedScroll, 10);
          }
        });
      }
    }
  }, [isLoading, activeTab, selectedShowTitle]);

  const handleScroll = useCallback(() => {
    // Only save scroll if we are not loading, and have actual scroll height to avoid saving 0 during layout shifts
    if (scrollRef.current && !selectedShowTitle && !isLoading) {
      if (scrollRef.current.scrollHeight > scrollRef.current.clientHeight) {
        sessionStorage.setItem(`webdoma_scroll_${activeTab}`, scrollRef.current.scrollTop.toString());
      }
    }
  }, [activeTab, selectedShowTitle, isLoading]);

  const [movies, setMovies] = useState<any[]>([]);
  const [tvShows, setTvShows] = useState<any[]>([]);
  const [otherFiles, setOtherFiles] = useState<any[]>([]);

  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const activeAccountIdRef = useRef(activeAccountId);
  activeAccountIdRef.current = activeAccountId;

  const applyTabItems = useCallback((tab: "movies" | "tv" | "other", accountId: number | null, items: any[]) => {
    if (activeTabRef.current !== tab || activeAccountIdRef.current !== accountId) return;
    if (tab === "movies") setMovies(items);
    else if (tab === "tv") setTvShows(items);
    else if (tab === "other") setOtherFiles(items);
  }, []);

  const loadLibrary = useCallback(
    async (forceRefresh = false) => {
      if (!hasAccounts) return;
      const currentTab = activeTabRef.current;
      const currentAccountId = activeAccountIdRef.current;
      const baseKey = `${userId}:${currentTab}`;
      const cacheKey = currentAccountId ? `${baseKey}:${currentAccountId}` : baseKey;

      // 1. Instant render from local IndexedDB cache
      const cached = await getCachedData<any[]>(cacheKey);
      if (cached.data !== null && !forceRefresh) {
        applyTabItems(currentTab, currentAccountId, cached.data);
        setIsLoading(false);
      } else {
        setIsLoading(true);
      }

      try {
        // 2. Conditional HTTP fetch using If-None-Match ETag
        const params = new URLSearchParams();
        if (currentAccountId) params.set("account_id", currentAccountId.toString());
        const queryString = params.toString() ? `?${params.toString()}` : "";
        const endpoint = `/api/library/${currentTab}${queryString}`;

        const headers: Record<string, string> = {};
        if (cached.etag && !forceRefresh) {
          headers["If-None-Match"] = cached.etag;
        }

        const res = await fetch(endpoint, {
          headers,
          ...(forceRefresh ? { cache: "no-store" as const } : {}),
        });

        if (res.status === 401) {
          await clearLibraryCache();
          window.location.href = "/login";
          return;
        }

        // 3a. Cache is completely fresh (304 Not Modified) - nothing more to do!
        if (res.status === 304) {
          setIsLoading(false);
          return;
        }

        // 3b. Data has updated (200 OK) - update UI and write fresh data + ETag to IndexedDB
        if (res.ok) {
          const json = await res.json();
          const items = currentTab === "tv" ? json.shows || [] : json.items || [];
          const newEtag = res.headers.get("etag");

          applyTabItems(currentTab, currentAccountId, items);
          await setCachedData(cacheKey, newEtag, items);
        }
      } catch (e) {
        console.error("Library load error:", e);
        toast.error("Failed to load library content");
      } finally {
        setIsLoading(false);
      }
    },
    [userId, hasAccounts, applyTabItems]
  );

  // Load immediately on mount, tab switch, or account filter change
  useEffect(() => {
    loadLibrary();
  }, [activeTab, activeAccountId, loadLibrary]);

  useEffect(() => {
    if (accountsProp.length > 0) setAccounts(accountsProp);
  }, [accountsProp, setAccounts]);

  // Revalidate on window focus (user switches back to tab)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadLibrary();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [loadLibrary]);

  // Force re-fetch on torrent updates
  useEffect(() => {
    const handleFilesUpdated = () => {
      loadLibrary(true);
    };
    window.addEventListener("torrent-files-updated", handleFilesUpdated);
    return () => window.removeEventListener("torrent-files-updated", handleFilesUpdated);
  }, [loadLibrary]);


  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // When inside a TV show detail view, let tv-show-detail handle Tab/Ctrl+N
      if (selectedShowTitle) {
        if (e.key === "Tab" || (e.ctrlKey && (e.key === "1" || e.key === "2" || e.key === "3"))) {
          return;
        }
      }

      // Tab key cycling
      if (e.key === "Tab") {
        e.preventDefault();
        setActiveTab((prev) => {
          if (prev === "movies") return "tv";
          if (prev === "tv") return "other";
          return "movies";
        });
        setSelectedShowTitle(null);
        return;
      }

      // Ctrl + 1, 2, 3 selection
      if (e.ctrlKey && (e.key === "1" || e.key === "2" || e.key === "3")) {
        e.preventDefault();
        if (e.key === "1") setActiveTab("movies");
        if (e.key === "2") setActiveTab("tv");
        if (e.key === "3") setActiveTab("other");
        setSelectedShowTitle(null);
        return;
      }

      if (e.key === "Escape") {
        setSearchQuery("");
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        return;
      }

      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (
        activeTag === "input" ||
        activeTag === "textarea" ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      // Home / End scroll
      if (e.key === "Home") {
        e.preventDefault();
        if (scrollRef.current) scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
        return;
      }

      // Arrow keys grid navigation
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const cards = Array.from(document.querySelectorAll('.navigable-card')) as HTMLElement[];
        if (cards.length > 0) {
          e.preventDefault();
          const active = document.activeElement as HTMLElement;
          const activeIndex = cards.indexOf(active);

          if (activeIndex === -1) {
            cards[0].focus();
            // Optional: immediately scroll it into view properly
            cards[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
          }

          let nextIndex = activeIndex;
          if (e.key === 'ArrowLeft') {
            nextIndex = activeIndex > 0 ? activeIndex - 1 : activeIndex;
          } else if (e.key === 'ArrowRight') {
            nextIndex = activeIndex < cards.length - 1 ? activeIndex + 1 : activeIndex;
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            const firstTop = cards[0].offsetTop;
            let cols = 0;
            for (let i = 0; i < cards.length; i++) {
              if (cards[i].offsetTop === firstTop) cols++;
              else break;
            }
            if (e.key === 'ArrowUp') {
              nextIndex = activeIndex - cols >= 0 ? activeIndex - cols : activeIndex;
            } else {
              nextIndex = activeIndex + cols < cards.length ? activeIndex + cols : activeIndex;
            }
          }

          if (nextIndex !== activeIndex) {
            cards[nextIndex].focus();
            cards[nextIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          return;
        }
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const searchInput = document.getElementById("global-search-input") as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedShowTitle]);

  const handleAddAccountSuccess = () => {
    setIsAddAccountOpen(false);
    window.location.reload();
  };

  // No accounts — show centered add-account CTA
  if (!hasAccounts) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <PlusCircle size={32} className="text-primary" />
          </div>
          <h2 className="text-xl font-bold tracking-tight">No TorBox Accounts</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Add a TorBox account to start browsing your movies, TV shows, and files.
          </p>
        </div>
        <Button
          onClick={() => setIsAddAccountOpen(true)}
          className="gap-2 cursor-pointer"
          size="lg"
          id="add-first-account"
          disabled={isAddingAccount}
        >
          {isAddingAccount ? <Loader2 size={18} className="animate-spin" /> : <PlusCircle size={18} />}
          Add TorBox Account
        </Button>
        <AddAccountForm
          open={isAddAccountOpen}
          onOpenChange={setIsAddAccountOpen}
          onSuccess={handleAddAccountSuccess}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {!selectedShowTitle && (
        <div className="shrink-0 px-4 md:px-6 pt-4 bg-background/40 backdrop-blur-md z-10 relative">
          <ContinueWatchingRow playerProtocol={playerProtocol} />
        </div>
      )}
      {/* Top Navigation Control Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-background/40 backdrop-blur-md shrink-0 z-10 relative">
        {/* Library Category Tabs */}
        <div className="flex items-center gap-1 sm:gap-1.5 bg-muted p-1 rounded-xl shadow-[inset_0_1px_3px_rgba(0,0,0,0.1)] min-w-0 shrink">
          <Button
            variant={activeTab === "movies" ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setActiveTab("movies");
              setSelectedShowTitle(null);
            }}
            className="gap-1.5 sm:gap-2 rounded-lg text-[11px] sm:text-xs font-semibold cursor-pointer px-2.5 sm:px-3 min-w-0 shrink-0"
          >
            <Film size={14} className="shrink-0" />
            <span className="truncate">Movies</span>
          </Button>

          <Button
            variant={activeTab === "tv" ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setActiveTab("tv");
              setSelectedShowTitle(null);
            }}
            className="gap-1.5 sm:gap-2 rounded-lg text-[11px] sm:text-xs font-semibold cursor-pointer px-2.5 sm:px-3 min-w-0 shrink-0"
          >
            <Tv size={14} className="shrink-0" />
            <span className="truncate">TV Shows</span>
          </Button>

          <Button
            variant={activeTab === "other" ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setActiveTab("other");
              setSelectedShowTitle(null);
            }}
            className="gap-1.5 sm:gap-2 rounded-lg text-[11px] sm:text-xs font-semibold cursor-pointer px-2.5 sm:px-3 min-w-0 shrink-0"
          >
            <FolderOpen size={14} className="shrink-0" />
            <span className="hidden [@media(min-width:400px)]:inline truncate">Other Files</span>
            <span className="[@media(min-width:400px)]:hidden truncate">Other</span>
          </Button>
        </div>

        {/* Right action controls */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {!selectedShowTitle && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 gap-2 shrink-0">
                    <Filter size={14} className="text-muted-foreground" />
                    <span className="truncate max-w-[120px]">
                      {activeAccountId
                        ? accounts.find(a => a.id === activeAccountId)?.torbox_email || "Account"
                        : "All Accounts"}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-popover/95 backdrop-blur-xl border-border/60">
                  <DropdownMenuItem onClick={() => setActiveAccountId(null)} className="cursor-pointer font-medium">
                    All Accounts
                  </DropdownMenuItem>
                  {accounts.map(acc => (
                    <DropdownMenuItem
                      key={acc.id}
                      onClick={() => setActiveAccountId(acc.id)}
                      className="cursor-pointer gap-2"
                    >
                      <AccountBadge accountId={acc.id} email={acc.torbox_email} variant="inline" />
                      <span className="truncate">{acc.torbox_email}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="relative flex-1 sm:w-64">
                <Search
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="global-search-input"
                  placeholder={`Search ${activeTab === "movies" ? "movies" : activeTab === "tv" ? "TV shows" : "files"}...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 bg-muted border-0 focus-visible:ring-1 focus-visible:ring-primary/50 text-xs rounded-xl shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)] transition-all"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div
        className="flex-1 overflow-y-auto p-4 md:p-6"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        {selectedShowTitle && activeTab === "tv" ? (
          <TvShowDetail
            showTitle={selectedShowTitle}
            playerProtocol={playerProtocol}
            onBack={() => setSelectedShowTitle(null)}
          />
        ) : activeTab === "movies" ? (
          <MoviesGrid
            movies={movies}
            isLoading={isLoading}
            searchQuery={searchQuery}
            playerProtocol={playerProtocol}
          />
        ) : activeTab === "tv" ? (
          <TvShowsGrid
            shows={tvShows}
            isLoading={isLoading}
            searchQuery={searchQuery}
            onSelectShow={(title) => setSelectedShowTitle(title)}
          />
        ) : (
          <OtherFilesView
            files={otherFiles}
            isLoading={isLoading}
            searchQuery={searchQuery}
            playerProtocol={playerProtocol}
          />
        )}
      </div>
    </div>
  );
}
