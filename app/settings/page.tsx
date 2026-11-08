"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Sidebar } from "@/components/sidebar";
import { PlayerSelector } from "@/components/player-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { LogOut, Info, Save, Loader2, Palette, Check, Plus, Copy, Key } from "lucide-react";
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
  getStoredAccent,
  storeAccent,
  applyAccent,
  normalizeHex,
} from "@/lib/accent";
import { clearLibraryCache } from "@/lib/library-cache";
import { useFileStore } from "@/lib/store";

export default function SettingsPage() {
  const router = useRouter();
  const [playerProtocol, setPlayerProtocol] = useState("vlc");
  const [customTemplate, setCustomTemplate] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [accentHex, setAccentHex] = useState(DEFAULT_ACCENT);
  const [customHex, setCustomHex] = useState("");

  const [mcpApiKey, setMcpApiKey] = useState("");
  const [mcpCopied, setMcpCopied] = useState(false);

  // Load from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("relay-player-protocol");
    const savedTemplate = localStorage.getItem("relay-custom-template");
    if (saved) setPlayerProtocol(saved);
    if (savedTemplate) setCustomTemplate(savedTemplate);

    const storedAccent = getStoredAccent();
    setAccentHex(storedAccent);
    setCustomHex(storedAccent);

    fetch("/api/auth/settings").then((r) => r.json()).then((data) => {
      if (data.mcpApiKey) setMcpApiKey(data.mcpApiKey);
    }).catch(() => { });
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Save to localStorage for fast client-side access
      localStorage.setItem("relay-player-protocol", playerProtocol);
      if (customTemplate) {
        localStorage.setItem("relay-custom-template", customTemplate);
      }

      // Also persist to session cookie for server-side access
      await fetch("/api/auth/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerProtocol }),
      });

      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await clearLibraryCache();
      useFileStore.getState().clearCache();

      await fetch("/api/auth/logout", { method: "POST" });
      toast.success("Logged out");
      router.push("/login");
      router.refresh();
    } catch {
      toast.error("Logout failed");
    }
  };

  const handleSetAccent = (hex: string) => {
    const normalized = normalizeHex(hex);
    if (!normalized) {
      toast.error("Invalid hex color");
      return;
    }
    setAccentHex(normalized);
    setCustomHex(normalized);
    applyAccent(normalized);
    storeAccent(normalized);
    toast.success("Theme accent updated");
  };

  const handleCopyMcpKey = () => {
    navigator.clipboard.writeText(mcpApiKey);
    setMcpCopied(true);
    toast.success("API key copied to clipboard");
    setTimeout(() => setMcpCopied(false), 2000);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto p-6 space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
            <p className="text-muted-foreground mt-1">
              Configure your Relay preferences
            </p>
          </div>

          <Separator />

          {/* Player Configuration */}
          <PlayerSelector
            value={playerProtocol}
            onChange={setPlayerProtocol}
            customTemplate={customTemplate}
            onCustomTemplateChange={setCustomTemplate}
          />

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={isSaving} className="gap-2" id="save-settings">
              {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {isSaving ? "Saving..." : "Save preferences"}
            </Button>
          </div>

          <Separator />

          {/* Theme Accent */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Palette size={18} className="text-primary" />
                Theme Accent
              </CardTitle>
              <CardDescription>
                Pick the accent color used across the app
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2.5">
                {ACCENT_PRESETS.map((preset) => {
                  const active = accentHex === preset.hex;
                  return (
                    <button
                      key={preset.id}
                      title={preset.label}
                      onClick={() => handleSetAccent(preset.hex)}
                      className={`relative w-9 h-9 rounded-full transition-all duration-200 cursor-pointer ${active
                        ? "ring-2 ring-foreground ring-offset-2 ring-offset-background scale-110"
                        : "ring-1 ring-border/60 hover:scale-110"
                        }`}
                      style={{ backgroundColor: preset.hex }}
                      aria-label={`Set accent to ${preset.label}`}
                    >
                      {active && (
                        <Check
                          size={16}
                          className="absolute inset-0 m-auto text-white drop-shadow"
                        />
                      )}
                    </button>
                  );
                })}

                {/* Custom color circle */}
                <label
                  className={`relative w-9 h-9 rounded-full cursor-pointer transition-all duration-200 ${!ACCENT_PRESETS.some((p) => p.hex === accentHex)
                    ? "ring-2 ring-foreground ring-offset-2 ring-offset-background scale-110"
                    : "ring-1 ring-border/60 hover:scale-110"
                    }`}
                  style={{
                    background:
                      "conic-gradient(#ef4444, #f59e0b, #22c55e, #3b82f6, #8b5cf6, #ec4899, #ef4444)",
                  }}
                  title="Custom color"
                >
                  <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/30">
                    <Plus size={14} className="text-foreground" />
                  </span>
                  <input
                    type="color"
                    value={accentHex}
                    onChange={(e) => handleSetAccent(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    aria-label="Pick custom accent color"
                  />
                </label>
              </div>

              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <label
                    htmlFor="custom-accent-hex"
                    className="text-xs text-muted-foreground"
                  >
                    Custom hex
                  </label>
                  <Input
                    id="custom-accent-hex"
                    placeholder="#8b5cf6"
                    value={customHex}
                    onChange={(e) => setCustomHex(e.target.value)}
                    className="font-mono"
                  />
                </div>
                <Button
                  onClick={() => handleSetAccent(customHex)}
                  className="gap-1.5 cursor-pointer"
                >
                  <Check size={14} />
                  Set
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* MCP API Key */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Key size={18} className="text-primary" />
                MCP Integration
              </CardTitle>
              <CardDescription>
                Connect AI assistants to your Relay library via the Model Context Protocol
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {mcpApiKey ? (
                <>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={mcpApiKey}
                      className="font-mono text-xs"
                    />
                    <motion.div whileTap={{ scale: 0.9 }}>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={handleCopyMcpKey}
                        className="shrink-0 cursor-pointer"
                      >
                        <AnimatePresence mode="wait">
                          <motion.span
                            key={mcpCopied ? "check" : "copy"}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.15 }}
                          >
                            {mcpCopied ? <Check size={14} /> : <Copy size={14} />}
                          </motion.span>
                        </AnimatePresence>
                      </Button>
                    </motion.div>
                  </div>
                  <motion.p
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, duration: 0.3 }}
                    className="text-xs text-muted-foreground"
                  >
                    Hover the key to reveal. Use as a Bearer token with endpoint{" "}
                    <code className="bg-muted px-1 rounded">/api/mcp</code>
                  </motion.p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Loading...</p>
              )}
            </CardContent>
          </Card>

          <Separator />

          {/* Account */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Account</CardTitle>
              <CardDescription>
                Manage your TorBox connection
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                variant="destructive"
                onClick={handleLogout}
                className="gap-2"
                id="settings-logout"
              >
                <LogOut size={16} />
                Disconnect &amp; Logout
              </Button>
            </CardContent>
          </Card>

          {/* About */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Info size={18} />
                About
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>
                <strong className="text-foreground">Relay</strong> — Self-hosted TorBox file manager
              </p>
              <p>
                Browse, stream, and download files from your TorBox cloud storage directly.
              </p>
              <p className="text-xs">
                Credentials are stored in an encrypted cookie and never leave your server.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
