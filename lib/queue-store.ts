import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// --- Types ---

export type AccountStatus = "completed" | "failed" | "queued" | "in-progress";

export interface AccountStatusEntry {
  status: AccountStatus;
  error?: string;
}

export type AccountStatusByHash = Record<string, Record<number, AccountStatusEntry>>;

export interface AccountResult {
  account_id: number;
  account_email: string;
  success: boolean;
  files_inserted: number;
  torrent_id?: number;
  error?: string;
}

export interface QueueItem {
  id: string;
  torrentName: string;
  torrentHash: string;
  sizeBytes: number;
  magnet: string;
  cachedFiles: any[];
  accountIds: number[];
  accountEmails: Record<number, string>;
  status: "queued" | "in-progress" | "completed" | "failed" | "partial";
  message?: string;
  error?: string;
  results?: AccountResult[];
  totalInserted?: number;
  createdAt: number;
  completedAt?: number;
}

const QUEUE_LIMIT = 10;

interface AddQueueState {
  // Active queue (queued + in-progress items)
  queue: QueueItem[];
  // Completed items (success, failed, partial — stay until manually dismissed)
  completed: QueueItem[];
  // Whether the hub panel is expanded
  hubExpanded: boolean;
  // Currently processing flag
  isProcessing: boolean;
  // Per-torrent, per-account status map (persisted across page reloads)
  accountStatusByHash: AccountStatusByHash;

  // Actions
  enqueue: (item: Omit<QueueItem, "id" | "status" | "createdAt">) => boolean;
  dismissCompleted: (id: string) => void;
  clearAllCompleted: () => void;
  clearPassedCompleted: () => void;
  setHubExpanded: (expanded: boolean) => void;
  toggleHub: () => void;
  cancelQueued: (id: string) => void;
  retryFailed: (id: string) => void;

  // Status lookups
  getHashStatus: (hash: string) => "queued" | "in-progress" | "completed" | "failed" | "partial" | null;
  getAccountStatuses: (hash: string) => Record<number, AccountStatusEntry>;

  // Internal — called by the queue runner
  _processNext: () => void;
  _isHashQueued: (hash: string) => boolean;
}

const dummyStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export const useAddQueueStore = create<AddQueueState>()(
  persist(
    (set, get) => ({
      queue: [],
      completed: [],
      hubExpanded: false,
      isProcessing: false,
      accountStatusByHash: {},

      getHashStatus: (hash: string) => {
        const { queue, accountStatusByHash } = get();
        // 1. Check active queue (highest priority)
        const active = queue.find((item) => item.torrentHash === hash);
        if (active) return active.status;

        // 2. Check per-account status map for this hash
        const statuses = accountStatusByHash[hash];
        if (!statuses) return null;

        const entries = Object.values(statuses);
        if (entries.length === 0) return null;

        const hasCompleted = entries.some((e) => e.status === "completed");
        const hasFailed = entries.some((e) => e.status === "failed");
        const hasQueued = entries.some((e) => e.status === "queued" || e.status === "in-progress");

        if (hasQueued) return "queued";
        if (hasCompleted && hasFailed) return "partial";
        if (hasCompleted) return "completed";
        if (hasFailed) return "failed";

        return null;
      },

      getAccountStatuses: (hash: string) => {
        const { queue, accountStatusByHash } = get();
        const result: Record<number, AccountStatusEntry> = {
          ...(accountStatusByHash[hash] || {}),
        };

        // Overlay active queue status if currently in queue or in-progress
        for (const item of queue) {
          if (item.torrentHash === hash) {
            for (const accId of item.accountIds) {
              result[accId] = { status: item.status as AccountStatus };
            }
          }
        }

        return result;
      },

      enqueue: (item) => {
        const { queue, accountStatusByHash } = get();
        if (queue.length >= QUEUE_LIMIT) return false;

        const newItem: QueueItem = {
          ...item,
          id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          status: "queued",
          createdAt: Date.now(),
        };

        const nextStatusByHash = { ...accountStatusByHash };
        const currentForHash = { ...(nextStatusByHash[item.torrentHash] || {}) };
        for (const accId of item.accountIds) {
          currentForHash[accId] = { status: "queued" };
        }
        nextStatusByHash[item.torrentHash] = currentForHash;

        set((state) => ({
          queue: [...state.queue, newItem],
          accountStatusByHash: nextStatusByHash,
          hubExpanded: true,
        }));

        // Kick off processing if idle
        setTimeout(() => get()._processNext(), 0);
        return true;
      },

      cancelQueued: (id) => {
        const { queue, accountStatusByHash } = get();
        const item = queue.find((i) => i.id === id);
        if (item) {
          const nextStatusByHash = { ...accountStatusByHash };
          const currentForHash = { ...(nextStatusByHash[item.torrentHash] || {}) };
          for (const accId of item.accountIds) {
            delete currentForHash[accId];
          }
          nextStatusByHash[item.torrentHash] = currentForHash;
          set({
            queue: queue.filter((i) => i.id !== id),
            accountStatusByHash: nextStatusByHash,
          });
        }
      },

      retryFailed: (id) => {
        const { completed, queue, accountStatusByHash } = get();
        const item = completed.find((c) => c.id === id);
        if (!item || queue.length >= QUEUE_LIMIT) return;

        const retryItem: QueueItem = {
          ...item,
          id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          status: "queued",
          message: undefined,
          error: undefined,
          results: undefined,
          totalInserted: undefined,
          completedAt: undefined,
          createdAt: Date.now(),
        };

        const nextStatusByHash = { ...accountStatusByHash };
        const currentForHash = { ...(nextStatusByHash[item.torrentHash] || {}) };
        for (const accId of item.accountIds) {
          currentForHash[accId] = { status: "queued" };
        }
        nextStatusByHash[item.torrentHash] = currentForHash;

        set((state) => ({
          completed: state.completed.filter((c) => c.id !== id),
          queue: [...state.queue, retryItem],
          accountStatusByHash: nextStatusByHash,
        }));

        setTimeout(() => get()._processNext(), 0);
      },

      dismissCompleted: (id) => {
        set((state) => ({
          completed: state.completed.filter((item) => item.id !== id),
        }));
      },

      clearAllCompleted: () => {
        set({ completed: [] });
      },

      clearPassedCompleted: () => {
        set((state) => ({
          completed: state.completed.filter((item) => item.status !== "completed"),
        }));
      },

      setHubExpanded: (expanded) => set({ hubExpanded: expanded }),

      toggleHub: () => set((state) => ({ hubExpanded: !state.hubExpanded })),

      _isHashQueued: (hash) => {
        const { queue } = get();
        return queue.some((item) => item.torrentHash === hash);
      },

      _processNext: async () => {
        const { queue, isProcessing, accountStatusByHash } = get();
        if (isProcessing) return;

        const nextItem = queue.find((item) => item.status === "queued");
        if (!nextItem) return;

        set({ isProcessing: true });

        // Update item status and per-account status to in-progress
        const inProgressStatusByHash = { ...accountStatusByHash };
        const currentInProg = { ...(inProgressStatusByHash[nextItem.torrentHash] || {}) };
        for (const accId of nextItem.accountIds) {
          currentInProg[accId] = { status: "in-progress" };
        }
        inProgressStatusByHash[nextItem.torrentHash] = currentInProg;

        set((state) => ({
          queue: state.queue.map((item) =>
            item.id === nextItem.id
              ? { ...item, status: "in-progress" as const, message: "Adding to TorBox..." }
              : item
          ),
          accountStatusByHash: inProgressStatusByHash,
        }));

        try {
          const res = await fetch("/api/torrent/create-multiple", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              magnet: nextItem.magnet,
              account_ids: nextItem.accountIds,
              cached_files: nextItem.cachedFiles,
              torrent_hash: nextItem.torrentHash,
            }),
          });

          if (res.status === 401) {
            window.location.href = "/login";
            return;
          }

          const data = await res.json();

          let finalStatus: QueueItem["status"];
          let message: string;
          let error: string | undefined;

          if (res.status === 409) {
            // User lock conflict — re-queue item so it retries after current one finishes
            const retryStatusByHash = { ...get().accountStatusByHash };
            const currentRetry = { ...(retryStatusByHash[nextItem.torrentHash] || {}) };
            for (const accId of nextItem.accountIds) {
              currentRetry[accId] = { status: "queued" };
            }
            retryStatusByHash[nextItem.torrentHash] = currentRetry;

            set((state) => ({
              queue: state.queue.map((item) =>
                item.id === nextItem.id
                  ? { ...item, status: "queued" as const, message: undefined }
                  : item
              ),
              accountStatusByHash: retryStatusByHash,
              isProcessing: false,
            }));
            setTimeout(() => get()._processNext(), 2000);
            return;
          }

          if (!res.ok) {
            finalStatus = "failed";
            error = data.error || "Unknown error";
            message = `Failed (${error})`;
          } else if (data.status === "completed") {
            finalStatus = "completed";
            const totalFiles = data.total_inserted || 0;
            const accountCount = nextItem.accountIds.length;
            message =
              accountCount > 1
                ? `Added to ${accountCount} accounts` +
                  (totalFiles > 0
                    ? ` • ${totalFiles} file${totalFiles > 1 ? "s" : ""} indexed`
                    : "")
                : totalFiles > 0
                ? `Added • ${totalFiles} file${totalFiles > 1 ? "s" : ""} indexed`
                : "Added successfully";
          } else if (data.status === "partial") {
            finalStatus = "partial";
            const succeeded = (data.results as AccountResult[]).filter(
              (r: AccountResult) => r.success
            ).length;
            const total = nextItem.accountIds.length;
            message = `Added to ${succeeded}/${total} account${total > 1 ? "s" : ""}`;
            error = (data.results as AccountResult[])
              .filter((r: AccountResult) => !r.success)
              .map((r: AccountResult) => r.error)
              .join("; ");
          } else {
            finalStatus = "failed";
            const errDetails = (data.results as AccountResult[])
              ?.map((r: AccountResult) => r.error)
              .filter(Boolean)
              .join("; ");
            error = errDetails || data.error || "Unknown error";
            message = `Failed (${error})`;
          }

          const completedItem: QueueItem = {
            ...nextItem,
            status: finalStatus,
            message,
            error,
            results: data.results,
            totalInserted: data.total_inserted,
            completedAt: Date.now(),
          };

          // Update per-account statuses
          const updatedStatusByHash = { ...get().accountStatusByHash };
          const finalForHash = { ...(updatedStatusByHash[nextItem.torrentHash] || {}) };

          if (Array.isArray(data.results)) {
            for (const r of data.results as AccountResult[]) {
              if (r.success) {
                finalForHash[r.account_id] = { status: "completed" };
              } else {
                finalForHash[r.account_id] = { status: "failed", error: r.error || "Failed" };
              }
            }
          } else if (!res.ok) {
            for (const accId of nextItem.accountIds) {
              finalForHash[accId] = { status: "failed", error: error || "Failed" };
            }
          }
          updatedStatusByHash[nextItem.torrentHash] = finalForHash;

          set((state) => ({
            queue: state.queue.filter((item) => item.id !== nextItem.id),
            completed: [completedItem, ...state.completed],
            accountStatusByHash: updatedStatusByHash,
            isProcessing: false,
          }));

          // Notify the app that files were updated
          if (finalStatus === "completed" || finalStatus === "partial") {
            window.dispatchEvent(new CustomEvent("torrent-files-updated"));
          }
        } catch (err) {
          const errorMsg =
            err instanceof Error ? err.message : "Failed to add torrent";
          const completedItem: QueueItem = {
            ...nextItem,
            status: "failed",
            message: `Failed (${errorMsg})`,
            error: errorMsg,
            completedAt: Date.now(),
          };

          const updatedStatusByHash = { ...get().accountStatusByHash };
          const finalForHash = { ...(updatedStatusByHash[nextItem.torrentHash] || {}) };
          for (const accId of nextItem.accountIds) {
            finalForHash[accId] = { status: "failed", error: errorMsg };
          }
          updatedStatusByHash[nextItem.torrentHash] = finalForHash;

          set((state) => ({
            queue: state.queue.filter((item) => item.id !== nextItem.id),
            completed: [completedItem, ...state.completed],
            accountStatusByHash: updatedStatusByHash,
            isProcessing: false,
          }));
        }

        // Process next in queue
        setTimeout(() => get()._processNext(), 0);
      },
    }),
    {
      name: "relay-add-queue",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : (dummyStorage as any)
      ),
      partialize: (state) => ({
        queue: state.queue,
        completed: state.completed,
        accountStatusByHash: state.accountStatusByHash,
      }),
    }
  )
);
