"use client";

const DB_NAME = "relay_lib_cache";
const DB_VERSION = 1;
const STORE_NAME = "tab_cache";

interface CacheRecord<T = any> {
    etag: string | null;
    data: T;
}

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
                console.warn("[IndexedDB] Open blocked");
            };
        } catch (e) {
            console.error("[IndexedDB] Open exception:", e);
            dbPromise = null;
            resolve(null);
        }
    });

    return dbPromise;
}

// retrieves cached data and its associated ETag
export async function getCachedData<T = any>(
    key: string
): Promise<{ etag: string | null; data: T | null }> {
    const db = await openDB();
    if (!db) return { etag: null, data: null };

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(key);

            req.onsuccess = () => {
                const record = req.result as CacheRecord<T> | undefined;
                resolve({
                    etag: record?.etag || null,
                    data: record?.data || null,
                });
            };

            req.onerror = () => {
                console.error(`[IndexedDB] Get error for ${key}:`, req.error);
                resolve({ etag: null, data: null });
            };
        } catch (e) {
            console.error(`[IndexedDB] Get exception for ${key}:`, e);
            resolve({ etag: null, data: null });
        }
    });
}

// Stores data alongside its ETag in IndexedDB
export async function setCachedData<T = any>(
    key: string,
    etag: string | null,
    data: T
): Promise<void> {
    const db = await openDB();
    if (!db) return;

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const record: CacheRecord<T> = { etag, data };
            store.put(record, key);

            tx.oncomplete = () => {
                console.log(`[IndexedDB] Stored '${key}' (ETag: ${etag || "none"})`);
                resolve();
            };

            tx.onerror = () => {
                console.error(`[IndexedDB] Put error for ${key}:`, tx.error);
                resolve();
            };
        } catch (e) {
            console.error(`[IndexedDB] Set exception for ${key}:`, e);
            resolve();
        }
    });
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
                console.log("[IndexedDB] Cache cleared");
                resolve();
            };
            tx.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}