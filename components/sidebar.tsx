"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FolderOpen, Settings, LogOut, Loader2, Users, ChevronLeft, ChevronRight, TextAlignJustify, LayoutGrid, List, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useFileStore } from "@/lib/store";
import { clearLibraryCache } from "@/lib/library-cache";

interface SidebarProps {
  username?: string;
}

export function Sidebar({ username = "User" }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { viewMode, setViewMode, setSidebarCollapsed } = useFileStore();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isCollapsed, setIsCollapsedLocal] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [fetchedUsername, setFetchedUsername] = useState<string>("User");

  useEffect(() => {
    setIsMounted(true);
    if (username === "User") {
      fetch("/api/auth/me")
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.username) {
            setFetchedUsername(data.username);
          }
        })
        .catch(console.error);
    } else {
      setFetchedUsername(username);
    }
  }, [username]);

  const displayUsername = username !== "User" ? username : fetchedUsername;

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await clearLibraryCache();
      useFileStore.getState().clearCache();

      await fetch("/api/auth/logout", { method: "POST" });
      toast.success("Logged out");
      router.push("/login");
      router.refresh();
    } catch {
      toast.error("Logout failed");
    } finally {
      setIsLoggingOut(false);
    }
  };

  const navItems = [
    { href: "/", label: "Browse", icon: FolderOpen },
    { href: "/search", label: "Search", icon: Search },
    { href: "/accounts", label: "Accounts", icon: Users },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  // Prevent layout shift during SSR
  if (!isMounted) {
    return (
      <aside className="w-16 lg:w-56 h-full flex flex-col glass-panel shrink-0 z-20 relative border-r border-dashed border-black/25 dark:border-white/25">
        <div className="p-3 lg:p-4 flex items-center justify-center lg:justify-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-linear-to-br from-primary/80 to-primary/40 flex items-center justify-center shrink-0 shadow-inner">
            <span className="text-lg font-bold font-display text-primary-foreground uppercase">
              {displayUsername[0]}
            </span>
          </div>
        </div>
      </aside>
    );
  }

  const renderContent = (isMobile: boolean) => {
    const showContent = !isCollapsed || isMobile;
    const collapsedStyle = isMobile;

    return (
      <>
        {/* Toggle Button (Desktop only) */}
        {!isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute -right-3 top-6 h-6 w-6 rounded-full shadow-sm bg-background hover:bg-accent z-10 flex items-center justify-center"
            onClick={() => {
              const next = !isCollapsed;
              setIsCollapsedLocal(next);
              setSidebarCollapsed(next);
            }}
          >
            <TextAlignJustify className="size-4" />
          </Button>
        )}

        <AnimatePresence>
          {showContent && (
            <motion.div
              initial={isMobile ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className={`flex flex-col h-full shrink-0 ${isMobile ? 'w-16' : 'w-56'} overflow-hidden`}
            >
              {/* Logo */}
              <div className={`p-3 lg:p-4 flex items-center ${collapsedStyle ? 'justify-center' : 'gap-3'} overflow-hidden`}>
                <div className="w-9 h-9 rounded-lg bg-primary/60 flex items-center justify-center shrink-0 shadow-inner">
                  <span className="text-lg font-bold font-display text-primary-foreground uppercase">
                    {displayUsername[0]}
                  </span>
                </div>
                {!collapsedStyle && (
                  <div className="whitespace-nowrap flex flex-col justify-center">
                    <h1 className="text-sm font-bold tracking-tight truncate max-w-32.5">
                      {displayUsername}
                    </h1>
                  </div>
                )}
              </div>

              <Separator className="opacity-90" />

              {/* Navigation */}
              <nav className="flex-1 p-2 space-y-1 overflow-hidden">
                {navItems.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <Tooltip key={item.href} delayDuration={0}>
                      <TooltipTrigger asChild>
                        <Link
                          href={item.href}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${isActive
                            ? "bg-primary/20 text-primary shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                            } ${collapsedStyle ? 'justify-center px-0' : ''}`}
                          id={`nav-${item.label.toLowerCase()}`}
                        >
                          <item.icon size={18} className="shrink-0" />
                          {!collapsedStyle && (
                            <span className="whitespace-nowrap">
                              {item.label}
                            </span>
                          )}
                        </Link>
                      </TooltipTrigger>
                      {collapsedStyle && (
                        <TooltipContent side="right">
                          {item.label}
                        </TooltipContent>
                      )}
                    </Tooltip>
                  );
                })}
              </nav>

              <Separator className="opacity-90" />

              {/* Bottom actions */}
              <div className="p-2 space-y-1 overflow-hidden">
                <div className={`flex items-center px-1 mb-2 ${collapsedStyle ? 'justify-center flex-col gap-2' : 'justify-between'}`}>
                  <div className={`flex items-center bg-muted/50 rounded-lg p-0.5 ${collapsedStyle ? 'flex-col' : ''}`}>
                    <Button
                      variant={viewMode === "grid" ? "secondary" : "ghost"}
                      size="icon"
                      className="h-7 w-7 rounded-md cursor-pointer"
                      onClick={() => setViewMode("grid")}
                      title="Grid View"
                    >
                      <LayoutGrid size={14} />
                    </Button>
                    <Button
                      variant={viewMode === "list" ? "secondary" : "ghost"}
                      size="icon"
                      className="h-7 w-7 rounded-md cursor-pointer"
                      onClick={() => setViewMode("list")}
                      title="List View"
                    >
                      <List size={14} />
                    </Button>
                  </div>
                  <ThemeToggle />
                </div>

                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      onClick={handleLogout}
                      disabled={isLoggingOut}
                      className={`w-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 ${collapsedStyle ? 'justify-center px-0' : 'justify-start'}`}
                      id="sidebar-logout"
                    >
                      {isLoggingOut ? (
                        <Loader2 size={18} className="animate-spin shrink-0" />
                      ) : (
                        <LogOut size={18} className="shrink-0" />
                      )}
                      {!collapsedStyle && (
                        <span className="whitespace-nowrap ml-2">
                          Logout
                        </span>
                      )}
                    </Button>
                  </TooltipTrigger>
                  {collapsedStyle && (
                    <TooltipContent side="right">
                      Logout
                    </TooltipContent>
                  )}
                </Tooltip>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  };

  return (
    <>
      {/* Desktop Sidebar (Animated with Motion) */}
      <motion.aside
        initial={false}
        animate={{ width: isCollapsed ? 24 : 224 }}
        className="hidden lg:flex h-full flex-col glass-panel shrink-0 relative z-20 border-r border-dashed border-black/25 dark:border-white/25"
        style={{ overflow: "visible" }}
      >
        {renderContent(false)}
      </motion.aside>

      {/* Mobile Sidebar (Static width 64px) */}
      <aside className="lg:hidden w-16 h-full flex flex-col glass-panel shrink-0 z-20 relative border-r border-dashed border-black/25 dark:border-white/25">
        {renderContent(true)}
      </aside>
    </>
  );
}
