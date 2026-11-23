"use client";

import { useState } from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ChevronUp,
  ChevronDown,
  X,
  Info,
  RotateCcw,
  Trash2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AccountBadge } from "@/components/account-badge";
import { useAddQueueStore, type QueueItem } from "@/lib/queue-store";
import { formatBytes, cn } from "@/lib/utils";

// --- Info Popover ---

function QueueItemInfo({
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
            className="h-6 w-6 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/60 shrink-0"
            onClick={onClose}
          >
            <X size={14} />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 pb-8 space-y-4 min-h-0">
          {/* Torrent Name */}
          <div className="p-3 rounded-xl bg-zinc-800/40 border border-zinc-700/50">
            <p className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold mb-1">
              Torrent
            </p>
            <p className="text-sm font-medium text-zinc-100 break-words leading-snug">
              {item.torrentName}
            </p>
          </div>

          {/* Size & Hash */}
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

          {/* Accounts */}
          <div>
            <p className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold mb-2">
              Target Accounts ({item.accountIds.length})
            </p>
            <div className="space-y-2">
              {item.accountIds.map((accountId) => {
                const email = item.accountEmails[accountId] || "Unknown";
                const result = item.results?.find(
                  (r) => r.account_id === accountId
                );

                return (
                  <div
                    key={accountId}
                    className="p-3 rounded-xl bg-zinc-800/50 border border-zinc-700/50"
                  >
                    <div className="flex items-center gap-2.5">
                      <AccountBadge accountId={accountId} email={email} />
                      <span className="text-xs text-zinc-200 font-medium truncate flex-1">{email}</span>
                      {result && (
                        <span className="shrink-0">
                          {result.success ? (
                            <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                              <CheckCircle2 size={12} />
                              {result.files_inserted > 0
                                ? `${result.files_inserted} files`
                                : "Success"}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[11px] font-medium text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">
                              <XCircle size={12} />
                              Failed
                            </span>
                          )}
                        </span>
                      )}
                      {!result && item.status === "in-progress" && (
                        <Loader2
                          size={13}
                          className="animate-spin text-primary shrink-0"
                        />
                      )}
                      {!result && item.status === "queued" && (
                        <span className="text-[11px] text-zinc-400">Waiting</span>
                      )}
                    </div>
                    {/* Inline error for this specific account if failed */}
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

          {/* Overall Error Details (styled box, no cut-off!) */}
          {item.error && (
            <div className="rounded-xl bg-red-950/40 border border-red-500/30 p-3.5 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-red-400">
                <AlertTriangle size={14} className="shrink-0 text-red-400" />
                <span>Error Details</span>
              </div>
              <div className="text-xs text-red-200/95 font-mono break-all leading-relaxed select-text bg-red-950/60 p-2.5 rounded-lg border border-red-500/20 max-h-48 overflow-y-auto">
                {item.error}
              </div>
            </div>
          )}

          {/* Timing Footer */}
          <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-3 border-t border-zinc-800">
            <span>Queued: {new Date(item.createdAt).toLocaleTimeString()}</span>
            {item.completedAt && (
              <span>Completed: {new Date(item.completedAt).toLocaleTimeString()}</span>
            )}
          </div>
          <div className="h-1" />
        </div>
      </div>
    </div>
  );
}

// --- Queue Item Row ---

function QueueItemRow({
  item,
  accounts,
  variant,
}: {
  item: QueueItem;
  accounts: any[];
  variant: "active" | "completed";
}) {
  const [showInfo, setShowInfo] = useState(false);
  const { cancelQueued, dismissCompleted, retryFailed } = useAddQueueStore();

  const statusIcon =
    item.status === "in-progress" ? (
      <Loader2 size={15} className="animate-spin text-primary shrink-0" />
    ) : item.status === "queued" ? (
      <Clock size={15} className="text-zinc-400 shrink-0" />
    ) : item.status === "completed" ? (
      <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
    ) : item.status === "partial" ? (
      <AlertTriangle size={15} className="text-amber-400 shrink-0" />
    ) : (
      <XCircle size={15} className="text-red-400 shrink-0" />
    );

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2.5 px-3.5 py-3 group transition-colors",
          "hover:bg-zinc-800/40"
        )}
      >
        {/* Status icon */}
        {statusIcon}

        {/* Name + subtitle */}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-zinc-200 truncate leading-tight">
            {item.torrentName}
          </p>
          <p
            className={cn(
              "text-[11px] truncate mt-0.5",
              item.status === "failed"
                ? "text-red-400/90 font-medium"
                : item.status === "completed"
                ? "text-emerald-400/90 font-medium"
                : item.status === "partial"
                ? "text-amber-400/90 font-medium"
                : item.status === "in-progress"
                ? "text-primary font-medium"
                : "text-zinc-400"
            )}
            title={item.status === "failed" ? item.error || item.message : undefined}
          >
            {item.status === "queued" && "Waiting in queue..."}
            {item.status === "in-progress" && (item.message || "Adding to TorBox...")}
            {item.status === "completed" && (item.message || "Added successfully")}
            {item.status === "partial" && (item.message || "Partially added")}
            {item.status === "failed" && (item.error ? `Failed: ${item.error}` : item.message || "Failed")}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Info button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/50"
                onClick={() => setShowInfo(true)}
              >
                <Info size={13} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs">
              Details
            </TooltipContent>
          </Tooltip>

          {/* Cancel (queued only) */}
          {item.status === "queued" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-zinc-400 hover:text-red-400 hover:bg-red-500/10"
                  onClick={() => cancelQueued(item.id)}
                >
                  <X size={13} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">
                Cancel
              </TooltipContent>
            </Tooltip>
          )}

          {/* Retry (failed / partial) */}
          {variant === "completed" &&
            (item.status === "failed" || item.status === "partial") && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-zinc-400 hover:text-primary hover:bg-primary/10"
                    onClick={() => retryFailed(item.id)}
                  >
                    <RotateCcw size={13} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs">
                  Retry
                </TooltipContent>
              </Tooltip>
            )}

          {/* Dismiss (completed items) */}
          {variant === "completed" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/50"
                  onClick={() => dismissCompleted(item.id)}
                >
                  <X size={13} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">
                Dismiss
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Info Modal */}
      {showInfo && (
        <QueueItemInfo
          item={item}
          accounts={accounts}
          onClose={() => setShowInfo(false)}
        />
      )}
    </>
  );
}

// --- Main Queue Hub ---

export function QueueHub({ accounts }: { accounts: any[] }) {
  const {
    queue,
    completed,
    hubExpanded,
    toggleHub,
    clearAllCompleted,
    clearPassedCompleted,
  } = useAddQueueStore();

  const totalActive = queue.length;
  const totalCompleted = completed.length;
  const hasItems = totalActive > 0 || totalCompleted > 0;
  const inProgress = queue.find((item) => item.status === "in-progress");
  const failedCount = completed.filter(
    (c) => c.status === "failed" || c.status === "partial"
  ).length;

  // Don't render anything if there are no items at all
  if (!hasItems) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
      {/* Expanded Hub — High contrast elevated panel */}
      {hubExpanded && (
        <div className="w-[400px] max-h-[480px] bg-zinc-900/98 border border-zinc-700/80 ring-1 ring-white/10 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] rounded-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-3 fade-in duration-200">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-zinc-800/80 border-b border-zinc-700/70 shrink-0">
            <div className="flex items-center gap-2">
              <Zap size={15} className="text-primary" />
              <h3 className="text-sm font-semibold text-zinc-100">Transfer Queue</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-300 bg-zinc-800 px-2 py-0.5 rounded-full border border-zinc-700/60 font-medium">
                {totalActive} / 10
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/60"
                onClick={toggleHub}
              >
                <ChevronDown size={14} />
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <Tabs
            defaultValue={totalActive > 0 ? "queue" : "completed"}
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="px-3 pt-2.5 pb-1">
              <TabsList className="w-full h-9 bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-1">
                <TabsTrigger
                  value="queue"
                  className="text-xs gap-1.5 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-400 hover:text-zinc-200 font-medium"
                >
                  Queue
                  {totalActive > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full bg-primary/20 text-primary">
                      {totalActive}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="completed"
                  className="text-xs gap-1.5 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-400 hover:text-zinc-200 font-medium"
                >
                  Completed
                  {totalCompleted > 0 && (
                    <span
                      className={cn(
                        "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full",
                        failedCount > 0
                          ? "bg-red-500/20 text-red-400"
                          : "bg-emerald-500/20 text-emerald-400"
                      )}
                    >
                      {totalCompleted}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Queue Tab */}
            <TabsContent
              value="queue"
              className="flex-1 overflow-y-auto min-h-0 m-0"
            >
              {totalActive === 0 ? (
                <div className="flex items-center justify-center py-12 text-zinc-500">
                  <p className="text-xs">Queue is empty</p>
                </div>
              ) : (
                <div className="divide-y divide-zinc-800/50">
                  {queue.map((item) => (
                    <QueueItemRow
                      key={item.id}
                      item={item}
                      accounts={accounts}
                      variant="active"
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Completed Tab */}
            <TabsContent
              value="completed"
              className="flex-1 overflow-y-auto min-h-0 m-0"
            >
              {totalCompleted === 0 ? (
                <div className="flex items-center justify-center py-12 text-zinc-500">
                  <p className="text-xs">No completed items</p>
                </div>
              ) : (
                <>
                  {/* Clear actions */}
                  <div className="flex items-center justify-end gap-1.5 px-3 py-1.5 border-b border-zinc-800/50 bg-zinc-900/60">
                    {completed.some((c) => c.status === "completed") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px] text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 gap-1 px-2"
                        onClick={clearPassedCompleted}
                      >
                        Clear passed
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[11px] text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 gap-1 px-2"
                      onClick={clearAllCompleted}
                    >
                      <Trash2 size={11} />
                      Clear all
                    </Button>
                  </div>
                  <div className="divide-y divide-zinc-800/50">
                    {completed.map((item) => (
                      <QueueItemRow
                        key={item.id}
                        item={item}
                        accounts={accounts}
                        variant="completed"
                      />
                    ))}
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* Collapsed Capsule — Elevated pill with clear contrast */}
      <button
        onClick={toggleHub}
        className={cn(
          "flex items-center gap-2.5 px-4 py-2.5 rounded-full border shadow-[0_12px_35px_rgba(0,0,0,0.7)] transition-all cursor-pointer",
          "bg-zinc-900/95 hover:bg-zinc-800/95 border-zinc-700/80 ring-1 ring-white/10 backdrop-blur-md text-zinc-200 hover:scale-[1.02]",
          failedCount > 0 && "border-red-500/40 ring-red-500/10"
        )}
      >
        {inProgress ? (
          <Loader2 size={14} className="animate-spin text-primary" />
        ) : failedCount > 0 ? (
          <XCircle size={14} className="text-red-400" />
        ) : totalCompleted > 0 ? (
          <CheckCircle2 size={14} className="text-emerald-400" />
        ) : (
          <Clock size={14} className="text-zinc-400" />
        )}

        <span className="text-xs font-medium max-w-[210px] truncate text-zinc-200">
          {inProgress
            ? `Adding "${inProgress.torrentName.slice(0, 25)}${inProgress.torrentName.length > 25 ? "..." : ""}"`
            : totalActive > 0
              ? `${totalActive} in queue`
              : `${totalCompleted} completed`}
          {totalActive > 0 && totalCompleted > 0 && !inProgress
            ? ` • ${totalCompleted} done`
            : ""}
        </span>

        {failedCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
            {failedCount}
          </span>
        )}

        {hubExpanded ? (
          <ChevronDown size={13} className="text-zinc-400" />
        ) : (
          <ChevronUp size={13} className="text-zinc-400" />
        )}
      </button>
    </div>
  );
}
