"use client";

const DB_NAME = "relay_lib_cache";
const DB_VERSION = 1;
const STORE_NAME = "tab_cache";

export interface AccountCacheData<T = any> {
    lastSyncedAt: string | null;
    items: T[];
}

export type TabCache<T = any> = Record<number, AccountCacheData<T>>;

let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
    if (typeof window === "undefined" || !window.indexedDB) {
        return Promise.resolve(null);
    }

    if (dbInstance) return Promise.resolve(dbInstance);
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve) => {
        try {
            const req = window.indexedDB.open(DB_NAME, DB_VERSION);

            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };

            req.onsuccess = () => {
                dbInstance = req.result;
                dbInstance.onversionchange = () => {
                    dbInstance?.close();
                    dbInstance = null;
                    dbPromise = null;
                };
                resolve(dbInstance);
            };

            req.onerror = () => {
                console.error("[IndexedDB] Open error:", req.error);
                dbPromise = null;
                resolve(null);
            };

            req.onblocked = () => {
                console.warn("[IndexedDB] Database open blocked");
            };
        } catch (e) {
            console.error("[IndexedDB] Open exception:", e);
            dbPromise = null;
            resolve(null);
        }
    });

    return dbPromise;
}

// Retrieves the full cached map for a tab ("movies", "tv", "other").
export async function getTabCache<T = any>(tab: string): Promise<TabCache<T> | null> {
    const db = await openDB();
    if (!db) return null;

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(tab);

            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => {
                console.error(`[IndexedDB] Get error for ${tab}:`, req.error);
                resolve(null);
            };
        } catch (e) {
            console.error(`[IndexedDB] Get exception for ${tab}:`, e);
            resolve(null);
        }
    });
}

// Returns cached items and a map of { [accountId]: lastSyncedAt }.
export async function getTabItems<T = any>(
    tab: string,
    accountId?: number | null
): Promise<{ items: T[]; syncedTimestamps: Record<number, string | null> }> {
    const cache = await getTabCache<T>(tab);
    if (!cache) return { items: [], syncedTimestamps: {} };

    const syncedTimestamps: Record<number, string | null> = {};
    for (const [idStr, data] of Object.entries(cache)) {
        syncedTimestamps[Number(idStr)] = data.lastSyncedAt;
    }

    if (accountId) {
        return {
            items: cache[accountId]?.items || [],
            syncedTimestamps,
        };
    }

    const allItems: T[] = [];
    for (const data of Object.values(cache)) {
        if (Array.isArray(data.items)) {
            allItems.push(...data.items);
        }
    }

    return { items: allItems, syncedTimestamps };
}

// Atomically updates the cached items and lastSyncedAt for an account within a tab.
// Performs read-modify-write inside a single readwrite transaction to prevent race conditions.
export async function setTabAccountData<T = any>(
    tab: string,
    accountId: number,
    lastSyncedAt: string | null,
    items: T[]
): Promise<void> {
    const db = await openDB();
    if (!db) return;

    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);

            const getReq = store.get(tab);

            getReq.onsuccess = () => {
                const current: TabCache<T> = getReq.result || {};
                current[accountId] = {
                    lastSyncedAt,
                    items,
                };

                const putReq = store.put(current, tab);
                putReq.onerror = () => {
                    console.error(`[IndexedDB] Put error for ${tab}:`, putReq.error);
                };
            };

            getReq.onerror = () => {
                console.error(`[IndexedDB] Transaction get error for ${tab}:`, getReq.error);
            };

            tx.oncomplete = () => {
                console.log(`[IndexedDB] Successfully saved ${items.length} items for ${tab} (account: ${accountId})`);
                resolve();
            };

            tx.onerror = () => {
                console.error(`[IndexedDB] Transaction error for ${tab}:`, tx.error);
                reject(tx.error);
            };

            tx.onabort = () => {
                console.error(`[IndexedDB] Transaction aborted for ${tab}`);
                reject(new Error("Transaction aborted"));
            };
        } catch (e) {
            console.error(`[IndexedDB] Set exception for ${tab}:`, e);
            reject(e);
        }
    });
}

// Removes an account from all tabs in the cache
export async function removeAccountFromCache(accountId: number): Promise<void> {
    const tabs = ["movies", "tv", "other"];
    const db = await openDB();
    if (!db) return;

    for (const tab of tabs) {
        await new Promise<void>((resolve) => {
            try {
                const tx = db.transaction(STORE_NAME, "readwrite");
                const store = tx.objectStore(STORE_NAME);
                const getReq = store.get(tab);

                getReq.onsuccess = () => {
                    const current = getReq.result;
                    if (current && current[accountId]) {
                        delete current[accountId];
                        store.put(current, tab);
                    }
                };

                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch {
                resolve();
            }
        });
    }
}

// Clears all cached library data from IndexedDB
export async function clearLibraryCache(): Promise<void> {
    const db = await openDB();
    if (!db) return;

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            store.clear();

            tx.oncomplete = () => {
                console.log("[IndexedDB] Library cache cleared");
                resolve();
            };
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}