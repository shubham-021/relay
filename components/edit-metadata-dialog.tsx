"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import { Search, Loader2, Film, Tv, Check, AlertCircle } from "lucide-react";
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
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface SearchCandidate {
  id: number;
  title: string;
  year: string;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string | null;
  mediaType: "movie" | "tv";
}

interface EditMetadataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: number;
  torrentId: number;
  fileId?: number | null;
  currentTmdbId?: number | null;
  currentTitle?: string;
  currentCategory?: "movie" | "tv" | "other";
  allFilesInTorrent?: boolean;
  onSaved?: () => void;
}

export function EditMetadataDialog({
  open,
  onOpenChange,
  accountId,
  torrentId,
  fileId,
  currentTmdbId,
  currentTitle = "",
  currentCategory = "movie",
  allFilesInTorrent = false,
  onSaved,
}: EditMetadataDialogProps) {
  const [category, setCategory] = useState<"movie" | "tv">(
    currentCategory === "tv" ? "tv" : "movie"
  );
  const [tmdbIdInput, setTmdbIdInput] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<SearchCandidate[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<SearchCandidate | null>(null);

  // Reset / initialize state on open
  useEffect(() => {
    if (open) {
      const initialCat = currentCategory === "tv" ? "tv" : "movie";
      setCategory(initialCat);
      setTmdbIdInput(currentTmdbId ? String(currentTmdbId) : "");
      setSearchQuery(currentTitle || "");
      setSearchResults([]);
      setSelectedCandidate(null);

      // Trigger automatic initial search if title is provided
      if (currentTitle && currentTitle.trim().length >= 2) {
        handleSearch(currentTitle.trim(), initialCat);
      }
    }
  }, [open, currentTmdbId, currentTitle, currentCategory]);

  const handleSearch = useCallback(async (query: string, searchCat: "movie" | "tv") => {
    if (!query || query.trim().length < 2) return;
    setIsSearching(true);
    try {
      const res = await fetch(
        `/api/metadata?action=search&query=${encodeURIComponent(query.trim())}&category=${searchCat}`
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

  const handleCategoryChange = (newCat: "movie" | "tv") => {
    setCategory(newCat);
    setSelectedCandidate(null);
    if (searchQuery.trim().length >= 2) {
      handleSearch(searchQuery.trim(), newCat);
    }
  };

  const handleSelectCandidate = (cand: SearchCandidate) => {
    setSelectedCandidate(cand);
    setTmdbIdInput(String(cand.id));
  };

  const handleSave = async () => {
    const parsedId = Number(tmdbIdInput.trim());
    if (!parsedId || isNaN(parsedId) || parsedId <= 0) {
      toast.error("Please enter a valid numeric TMDB ID");
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch("/api/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          torrent_id: torrentId,
          file_id: fileId ?? null,
          tmdb_id: parsedId,
          category,
          all_files_in_torrent: allFilesInTorrent,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update metadata");
      }

      toast.success("Metadata updated successfully!", {
        description: `${data.media?.title || "Resource"} (${category === "tv" ? "Series" : "Movie"})`,
      });

      // Broadcast update to all library views to refresh cache
      window.dispatchEvent(new CustomEvent("torrent-files-updated"));
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to save metadata");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[88vh] flex flex-col bg-zinc-900 border-zinc-700/80 ring-1 ring-white/10 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-zinc-100 flex items-center gap-2">
            <span>Edit Metadata</span>
            <span className="text-xs font-normal text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded-full border border-zinc-700">
              {allFilesInTorrent ? "Entire Torrent" : "Single File"}
            </span>
          </DialogTitle>
          <DialogDescription className="truncate text-zinc-400">
            {currentTitle || "Search TMDB or enter a TMDB ID directly"}
          </DialogDescription>
        </DialogHeader>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
          {/* Category Toggle & TMDB ID Input */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-zinc-800/40 border border-zinc-800">
            <div>
              <label className="text-xs font-medium text-zinc-300 mb-1.5 block">
                Category:
              </label>
              <div className="inline-flex rounded-lg bg-zinc-900 p-0.5 border border-zinc-700 w-full">
                <button
                  type="button"
                  onClick={() => handleCategoryChange("movie")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs rounded-md font-medium transition-all cursor-pointer",
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
                  onClick={() => handleCategoryChange("tv")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs rounded-md font-medium transition-all cursor-pointer",
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

            <div>
              <label className="text-xs font-medium text-zinc-300 mb-1.5 block">
                TMDB ID:
              </label>
              <Input
                placeholder="e.g. 550"
                value={tmdbIdInput}
                onChange={(e) => {
                  setTmdbIdInput(e.target.value);
                  setSelectedCandidate(null);
                }}
                className="h-8 text-xs bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 font-mono"
              />
            </div>
          </div>

          {/* Built-in TMDB Live Search */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-300">
                Search TMDB:
              </label>
              <span className="text-[11px] text-zinc-500">
                Select a match to auto-fill TMDB ID
              </span>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
                />
                <Input
                  placeholder={`Search ${category === "tv" ? "series" : "movies"} by title...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSearch(searchQuery, category);
                    }
                  }}
                  className="h-9 pl-8 text-xs bg-zinc-800/60 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => handleSearch(searchQuery, category)}
                disabled={isSearching || !searchQuery.trim()}
                className="h-9 px-3 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700"
              >
                {isSearching ? <Loader2 size={13} className="animate-spin" /> : "Search"}
              </Button>
            </div>
          </div>

          {/* Search Results List */}
          <div className="space-y-2">
            {isSearching && (
              <div className="flex items-center justify-center py-8 text-zinc-400 gap-2 text-xs">
                <Loader2 size={16} className="animate-spin text-primary" />
                <span>Searching TMDB...</span>
              </div>
            )}

            {!isSearching && searchResults.length > 0 && (
              <div className="space-y-1.5 max-h-[36vh] overflow-y-auto pr-1">
                {searchResults.map((cand) => {
                  const isSelected =
                    selectedCandidate?.id === cand.id ||
                    tmdbIdInput.trim() === String(cand.id);

                  return (
                    <button
                      key={cand.id}
                      type="button"
                      onClick={() => handleSelectCandidate(cand)}
                      className={cn(
                        "w-full flex items-start gap-3 p-2.5 rounded-xl border text-left transition-all cursor-pointer",
                        isSelected
                          ? "border-primary bg-primary/10 shadow-sm"
                          : "border-zinc-800 bg-zinc-800/40 hover:bg-zinc-800/70"
                      )}
                    >
                      {/* Poster thumbnail */}
                      <div className="w-10 h-14 bg-zinc-800 rounded shrink-0 overflow-hidden border border-zinc-700/50">
                        {cand.posterPath ? (
                          <img
                            src={`https://image.tmdb.org/t/p/w185${cand.posterPath}`}
                            alt={cand.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-zinc-600">
                            {category === "tv" ? <Tv size={16} /> : <Film size={16} />}
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-zinc-200 truncate">
                            {cand.title}
                          </p>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 shrink-0">
                            ID: {cand.id}
                          </span>
                        </div>

                        <p className="text-[11px] text-zinc-400 mt-0.5">
                          {cand.year ? cand.year : "Unknown year"}
                        </p>

                        {cand.overview && (
                          <p className="text-[11px] text-zinc-500 line-clamp-1 mt-1 leading-snug">
                            {cand.overview}
                          </p>
                        )}
                      </div>

                      {/* Selected check */}
                      {isSelected && (
                        <div className="shrink-0 text-primary mt-1">
                          <Check size={16} className="stroke-[3]" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {!isSearching && searchQuery.trim() && searchResults.length === 0 && (
              <div className="text-center py-6 text-zinc-500 text-xs">
                No TMDB {category === "tv" ? "series" : "movies"} found matching &quot;{searchQuery}&quot;. You can still enter a TMDB ID directly.
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="border-t border-zinc-800 pt-3">
          <Button
            variant="outline"
            className="border-zinc-700 hover:bg-zinc-800 text-zinc-300"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!tmdbIdInput.trim() || isSaving}
            className="gap-1.5"
          >
            {isSaving ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Check size={15} />
            )}
            Save &amp; Update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
