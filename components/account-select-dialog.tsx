"use client";

import { useState, useEffect } from "react";
import { Check, Plus, Loader2 } from "lucide-react";
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

interface AccountSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: any[];
  activeAccountId: number | null;
  torrentName: string;
  onConfirm: (selectedAccountIds: number[]) => Promise<void>;
}

export function AccountSelectDialog({
  open,
  onOpenChange,
  accounts,
  activeAccountId,
  torrentName,
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
      <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add to Account</DialogTitle>
          <DialogDescription className="truncate">{torrentName}</DialogDescription>
        </DialogHeader>

        {/* Scrollable account cards */}
        <div className="flex-1 overflow-y-auto space-y-2 py-2">
          {accounts.map((account) => {
            const isSelected = selectedIds.includes(account.id);
            const syncedDate = parseUtcTimestamp(account.last_synced_at);
            const updatedDate = parseUtcTimestamp(account.last_updated_at);
            return (
              <button
                key={account.id}
                onClick={() => toggleAccount(account.id)}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left cursor-pointer",
                  isSelected
                    ? "border-primary/50 bg-primary/5"
                    : "border-border/50 hover:bg-muted/30"
                )}
              >
                {/* Checkbox */}
                <div className={cn(
                  "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors",
                  isSelected ? "bg-primary border-primary" : "border-border"
                )}>
                  {isSelected && <Check size={12} className="text-primary-foreground" />}
                </div>

                {/* Account info */}
                <AccountBadge accountId={account.id} email={account.torbox_email} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{account.torbox_email}</p>
                  {syncedDate && (
                    <p className="text-xs text-muted-foreground">
                      Last synced: {formatRelative(syncedDate.getTime() / 1000)}
                    </p>
                  )}
                  {updatedDate && (
                    <p className="text-xs text-muted-foreground">
                      Last updated: {formatRelative(updatedDate.getTime() / 1000)}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
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
