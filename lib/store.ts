import { create } from "zustand";
import type { FileItem, BreadcrumbItem, TorBoxAccount } from "@/lib/types";

export type SortKey = "name" | "size" | "date";
export type SortOrder = "asc" | "desc";

export interface DirectoryData {
  items: FileItem[];
  breadcrumbs: BreadcrumbItem[];
  lastRefreshed: Date;
}

interface FileStoreState {
  // Directory cache: maps path to its contents
  directoryCache: Record<string, DirectoryData>;
  currentPath: string;
  isLoading: boolean;
  isAddingAccount: boolean;
  error: string | null;
  activeAccountId: number | null;

  // UI State
  viewMode: "grid" | "list";
  searchQuery: string;
  sortKey: SortKey;
  sortOrder: SortOrder;
  sidebarCollapsed: boolean;
  continueWatchingCollapsed: boolean;
  accounts: TorBoxAccount[];
  setAccounts: (accounts: TorBoxAccount[]) => void;

  // Actions
  setActiveAccountId: (accountId: number | null) => void;
  setIsAddingAccount: (isAdding: boolean) => void;
  setCurrentPath: (path: string) => void;
  setViewMode: (mode: "grid" | "list") => void;
  setSearchQuery: (query: string) => void;
  setSortKey: (key: SortKey) => void;
  setSortOrder: (order: SortOrder) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setContinueWatchingCollapsed: (collapsed: boolean) => void;
  toggleSort: () => void;
  fetchFiles: (path: string, forceRefresh?: boolean) => Promise<void>;
  clearCache: () => void;
}

export const useFileStore = create<FileStoreState>((set, get) => ({
  directoryCache: {},
  currentPath: "/",
  isLoading: false,
  isAddingAccount: false,
  error: null,
  activeAccountId: null,

  viewMode: "grid",
  searchQuery: "",
  sortKey: "name",
  sortOrder: "asc",
  sidebarCollapsed: false,
  continueWatchingCollapsed: false,
  accounts: [],
  setAccounts: (accounts) => set({ accounts }),

  setActiveAccountId: (accountId) => set({ activeAccountId: accountId, currentPath: "/" }),
  setIsAddingAccount: (isAdding) => set({ isAddingAccount: isAdding }),
  setCurrentPath: (path) => set({ currentPath: path, searchQuery: "" }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSortKey: (key) => set({ sortKey: key }),
  setSortOrder: (order) => set({ sortOrder: order }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setContinueWatchingCollapsed: (collapsed) => set({ continueWatchingCollapsed: collapsed }),
  toggleSort: () => {
    const { sortKey, sortOrder } = get();
    const keys: SortKey[] = ["name", "size", "date"];
    const currentIndex = keys.indexOf(sortKey);

    if (sortOrder === "desc") {
      set({ sortKey: keys[(currentIndex + 1) % keys.length], sortOrder: "asc" });
    } else {
      set({ sortOrder: "desc" });
    }
  },

  fetchFiles: async (path: string, forceRefresh = false) => {
    const { directoryCache, activeAccountId } = get();
    const cacheKey = activeAccountId ? `${activeAccountId}:${path}` : path;

    // If we have cached data and aren't forcing a refresh, just set current path and return
    if (!forceRefresh && directoryCache[cacheKey]) {
      set({ currentPath: path, error: null, isLoading: false });
      return;
    }

    // Otherwise fetch
    set({ isLoading: true, error: null, currentPath: path });

    try {
      const params = new URLSearchParams();
      if (activeAccountId) params.set("account_id", activeAccountId.toString());
      if (forceRefresh) params.set("refresh", "true");

      const res = await fetch(`/api/files?${params.toString()}`);

      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }

      if (!res.ok) {
        throw new Error("Failed to fetch files");
      }

      const data = await res.json();

      const newDirData: DirectoryData = {
        items: data.items,
        breadcrumbs: data.breadcrumbs,
        lastRefreshed: new Date(),
      };

      set((state) => {
        const currentCacheKey = state.activeAccountId ? `${state.activeAccountId}:${path}` : path;
        return {
          directoryCache: {
            ...state.directoryCache,
            [currentCacheKey]: newDirData,
          },
          isLoading: false,
        };
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to load files",
        isLoading: false
      });
    }
  },

  clearCache: () => set({ directoryCache: {}, currentPath: "/" }),
}));