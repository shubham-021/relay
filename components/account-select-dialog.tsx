"use client";

import { useState, useEffect } from "react";
import { Check, Plus, Loader2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { AccountBadge } from "@/components/account-badge";
import { formatRelative, parseUtcTimestamp } from "@/util/format";
import { cn } from "@/lib/utils";
import type { AccountStatusEntry } from "@/lib/queue-store";

interface AccountSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: any[];
  activeAccountId: number | null;
  torrentName: string;
  accountStatuses?: Record<number, AccountStatusEntry>;
  onConfirm: (selectedAccountIds: number[]) => Promise<void>;
}

export function AccountSelectDialog({
  open,
  onOpenChange,
  accounts,
  activeAccountId,
  torrentName,
  accountStatuses = {},
  onConfirm,
}: AccountSelectDialogProps) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isAdding, setIsAdding] = useState(false);

  // Empty selection on open
  useEffect(() => {
    if (open) {
      setSelectedIds([]);
    }
  }, [open]);

  const toggleAccount = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleConfirm = async () => {
    setIsAdding(true);
    try {
      await onConfirm(selectedIds);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col bg-zinc-900 border-zinc-700/80 ring-1 ring-white/10 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">Add to Account</DialogTitle>
          <DialogDescription className="truncate text-zinc-400">{torrentName}</DialogDescription>
        </DialogHeader>

        {/* Scrollable account cards */}
        <div className="flex-1 overflow-y-auto space-y-2.5 py-2 pr-1">
          {accounts.map((account) => {
            const isSelected = selectedIds.includes(account.id);
            const statusInfo = accountStatuses[account.id];
            const isAdded = statusInfo?.status === "completed";
            const isFailed = statusInfo?.status === "failed";
            const isQueued = statusInfo?.status === "queued" || statusInfo?.status === "in-progress";
            const syncedDate = parseUtcTimestamp(account.last_synced_at);

            return (
              <button
                key={account.id}
                type="button"
                onClick={() => toggleAccount(account.id)}
                className={cn(
                  "w-full flex flex-col p-3 rounded-xl border transition-all text-left cursor-pointer",
                  isSelected
                    ? "border-primary/60 bg-primary/10 shadow-sm"
                    : isAdded
                    ? "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10"
                    : isFailed
                    ? "border-red-500/30 bg-red-500/5 hover:bg-red-500/10"
                    : "border-zinc-800 bg-zinc-800/40 hover:bg-zinc-800/70"
                )}
              >
                <div className="flex items-center gap-3 w-full">
                  {/* Checkbox */}
                  <div
                    className={cn(
                      "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors",
                      isSelected
                        ? "bg-primary border-primary"
                        : isAdded
                        ? "border-emerald-500/50 bg-emerald-500/15"
                        : "border-zinc-600 bg-zinc-800"
                    )}
                  >
                    {isSelected ? (
                      <Check size={12} className="text-primary-foreground stroke-[3]" />
                    ) : isAdded ? (
                      <Check size={12} className="text-emerald-400 stroke-[3]" />
                    ) : null}
                  </div>

                  {/* Account info */}
                  <AccountBadge accountId={account.id} email={account.torbox_email} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate text-zinc-200">
                      {account.torbox_email}
                    </p>
                    {syncedDate && (
                      <p className="text-[11px] text-zinc-400">
                        Last synced: {formatRelative(syncedDate.getTime() / 1000)}
                      </p>
                    )}
                  </div>

                  {/* Status Badges */}
                  <div className="shrink-0">
                    {isAdded && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                        <Check size={11} className="stroke-[3]" /> Added
                      </span>
                    )}
                    {isFailed && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-red-400 bg-red-500/15 border border-red-500/30 px-2 py-0.5 rounded-full">
                        <XCircle size={11} /> Failed
                      </span>
                    )}
                    {isQueued && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-primary bg-primary/15 border border-primary/30 px-2 py-0.5 rounded-full">
                        <Clock size={11} /> In Queue
                      </span>
                    )}
                  </div>
                </div>

                {/* Inline error if this account failed previously */}
                {isFailed && statusInfo?.error && (
                  <div className="mt-2 pt-2 border-t border-red-500/20 text-[11px] text-red-300 font-mono break-all leading-normal pl-8 flex items-start gap-1">
                    <AlertTriangle size={12} className="shrink-0 text-red-400 mt-0.5" />
                    <span>{statusInfo.error}</span>
                  </div>
                )}
              </button>
            );
          })}
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
            onClick={handleConfirm}
            disabled={selectedIds.length === 0 || isAdding}
            className="gap-1.5"
          >
            {isAdding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            Add to {selectedIds.length} account{selectedIds.length !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
