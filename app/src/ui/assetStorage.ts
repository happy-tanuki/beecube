/**
 * The autosaved project's assets, in the browser's IndexedDB (the project's
 * JSON is in localStorage). Scratch keeps assets only in memory until the
 * project is saved; this editor saves itself as you go, so it keeps them too.
 */
import { APP_ID } from '../brand'
import type { AssetRef } from '../engine/assets'
import { assetFileName } from '../engine/assets'

const DB_NAME = `${APP_ID}-assets`
const STORE = 'assets'

let db: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return db
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

export async function loadStoredAsset(ref: AssetRef): Promise<Uint8Array | null> {
  const store = (await open()).transaction(STORE).objectStore(STORE)
  const data = (await request(store.get(assetFileName(ref)))) as Uint8Array | undefined
  return data ?? null
}

/** Stores assets (by file name) that aren't stored yet. */
export async function storeAssets(assets: [string, Uint8Array][]): Promise<void> {
  if (assets.length === 0) return
  const tx = (await open()).transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  const stored = new Set((await request(store.getAllKeys())) as string[])
  for (const [name, data] of assets) if (!stored.has(name)) store.put(data, name)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Removes the stored assets the project no longer uses. */
export async function pruneStoredAssets(keep: Set<string>): Promise<void> {
  const store = (await open()).transaction(STORE, 'readwrite').objectStore(STORE)
  for (const name of (await request(store.getAllKeys())) as string[]) if (!keep.has(name)) store.delete(name)
}
