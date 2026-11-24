interface LockEntry {
    controller: AbortController;
    timeoutId?: ReturnType<typeof setTimeout>;
}

const DEFAULT_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const globalForInFlight = globalThis as unknown as {
    inFlightLocks: Map<string, LockEntry>;
}

export const inFlightLocks = (globalForInFlight.inFlightLocks ??= new Map<string, LockEntry>());

if (process.env.NODE_ENV !== "production") {
    globalForInFlight.inFlightLocks = inFlightLocks;
}

export function acquireLock(key: string, timeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS): AbortController | null {
    if (inFlightLocks.has(key)) return null;

    const controller = new AbortController();
    const timeoutId = timeoutMs > 0 ? setTimeout(() => {
        console.warn(`[in-flight] Lock timed out after ${timeoutMs}ms for key: ${key}. Forcing release.`);
        controller.abort();
        inFlightLocks.delete(key);
    }, timeoutMs) : undefined;

    if (timeoutId && typeof timeoutId === "object" && "unref" in timeoutId) {
        (timeoutId as any).unref();
    }

    inFlightLocks.set(key, { controller, timeoutId });
    return controller;
}

export function releaseLock(key: string, controller: AbortController): void {
    const entry = inFlightLocks.get(key);
    if (entry?.controller === controller) {
        if (entry.timeoutId) {
            clearTimeout(entry.timeoutId);
        }
        inFlightLocks.delete(key);
    }
}

export function abortLock(key: string): boolean {
    const entry = inFlightLocks.get(key);
    if (!entry) return false;
    if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
    }
    entry.controller.abort();
    inFlightLocks.delete(key);
    return true;
}

export function isLocked(key: string): boolean {
    return inFlightLocks.has(key);
}

export function isAccountSyncing(accountId: number): boolean {
    return inFlightLocks.has(`account:${accountId}:sync`);
}
