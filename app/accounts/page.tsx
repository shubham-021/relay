"use client";

import { useEffect, useState, useRef } from "react";
import { Sidebar } from "@/components/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { AddAccountForm } from "@/components/add-account-form";
import { toast } from "sonner";
import { Loader2, PlusCircle, RefreshCw, Trash2, User } from "lucide-react";
import type { TorBoxAccount } from "@/lib/types";
import { useFileStore } from "@/lib/store";
import { parseUtcTimestamp } from "@/util/format";

export default function AccountsPage() {
  const { isAddingAccount } = useFileStore();
  const [accounts, setAccounts] = useState<TorBoxAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState<number | null>(null);
  const [syncConfirmAccountId, setSyncConfirmAccountId] = useState<number | null>(null);

  const fetchAccounts = async () => {
    try {
      const res = await fetch("/api/accounts");
      const data = await res.json();
      if (res.ok) {
        setAccounts(data.accounts || []);
      }
    } catch {
      toast.error("Failed to fetch accounts");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const isSyncingRef = useRef(false);

  const handleSyncAccount = async () => {
    if (syncConfirmAccountId === null) return;
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;

    const accountId = syncConfirmAccountId;
    setSyncConfirmAccountId(null);
    setIsSyncing(accountId);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId }),
      });

      const data = await res.json();

      if (res.status === 409) {
        toast.error((data as { error?: string }).error || "A sync is already in progress");
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || "Sync failed");
      }

      toast.success(`Synced ${data.files_synced} files`);
      fetchAccounts();
    } catch (error) {
      toast.error("Failed to sync account");
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(null);
    }
  };

  const handleDeleteAccount = async (accountId: number) => {
    if (!confirm("Are you sure you want to delete this account? Your downloaded media metadata for this account will be removed.")) return;

    setIsDeleting(accountId);
    try {
      const res = await fetch(`/api/accounts?account_id=${accountId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Delete failed");
      }

      toast.success("Account deleted successfully");
      fetchAccounts();
    } catch (error: any) {
      toast.error(error.message || "Failed to delete account");
    } finally {
      setIsDeleting(null);
    }
  };

  const handleAddSuccess = () => {
    setIsAddAccountOpen(false);
    fetchAccounts();
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Account Manager</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Manage your TorBox accounts
              </p>
            </div>
            <Button onClick={() => setIsAddAccountOpen(true)} className="gap-2 shrink-0 self-start sm:self-auto" size="sm" disabled={isAddingAccount}>
              {isAddingAccount ? <Loader2 size={16} className="animate-spin" /> : <PlusCircle size={16} />} Add Account
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="animate-spin text-muted-foreground h-8 w-8" />
                </div>
              ) : accounts.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-muted-foreground">
                  <User className="h-12 w-12 mb-4 opacity-20" />
                  <p>No TorBox accounts found.</p>
                  <p className="text-sm mt-1">Add an account to start syncing media.</p>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {accounts.map((account) => (
                    <div key={account.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-4 gap-3 sm:gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                          <User size={18} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm sm:text-base truncate">{account.torbox_email}</p>
                          <p className="text-[11px] sm:text-xs text-muted-foreground">
                            Last synced: {parseUtcTimestamp(account.last_synced_at)?.toLocaleString() ?? "Never"}
                          </p>
                          <p className="text-[11px] sm:text-xs text-muted-foreground">
                            Last updated: {parseUtcTimestamp(account.last_updated_at)?.toLocaleString() ?? "Never"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSyncConfirmAccountId(account.id)}
                          disabled={isSyncing !== null}
                          className="gap-1.5 text-xs sm:text-sm"
                        >
                          {isSyncing === account.id ? (
                            <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                          )}
                          Sync
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteAccount(account.id)}
                          disabled={isDeleting !== null || isSyncing !== null}
                          className="gap-1.5 text-xs sm:text-sm"
                        >
                          {isDeleting === account.id ? (
                            <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                          )}
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <AddAccountForm
          open={isAddAccountOpen}
          onOpenChange={setIsAddAccountOpen}
          onSuccess={handleAddSuccess}
        />

        <Dialog open={syncConfirmAccountId !== null} onOpenChange={(open) => !open && setSyncConfirmAccountId(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RefreshCw size={18} className="text-primary" />
                Sync Remote Files?
              </DialogTitle>
              <DialogDescription>
                This will <span className="font-semibold text-foreground">clear all stored file data</span> for this account and re-fetch everything fresh from TorBox. All files will be re-parsed and metadata will be fetched from TMDB. This may take a moment depending on how many files you have.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => setSyncConfirmAccountId(null)}
                className="rounded-xl cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSyncAccount}
                className="rounded-xl cursor-pointer"
              >
                Yes, Sync Now
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
