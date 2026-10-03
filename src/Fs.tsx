import type { Chat } from '../src/Store'

// The File System Access API isn't fully typed in lib.dom, so describe what we use.
export type Dir = FileSystemDirectoryHandle & {
  queryPermission(d: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(d: { mode: 'readwrite' }): Promise<PermissionState>
  values(): AsyncIterable<FileSystemHandle>
}
type WritableFile = FileSystemFileHandle & {
  createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }>
}

export const supported = 'showDirectoryPicker' in window

// --- remember the chosen folder across reloads (handles can be stored in IndexedDB) ---
const DB = 'ollama-chat-fs'
const STORE = 'kv'
const KEY = 'dir'

const openDb = () =>
  new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })

async function kv<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise((res, rej) => {
    const r = f(db.transaction(STORE, mode).objectStore(STORE))
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

export const loadHandle = () => kv<Dir | undefined>('readonly', (s) => s.get(KEY))
const saveHandle = (h: Dir) => kv('readwrite', (s) => s.put(h, KEY))

// --- folder access ---
export async function pickFolder(): Promise<Dir> {
  const w = window as unknown as { showDirectoryPicker(o: { mode: 'readwrite' }): Promise<Dir> }
  const h = await w.showDirectoryPicker({ mode: 'readwrite' })
  await saveHandle(h)
  return h
}
export const permission = (h: Dir) => h.queryPermission({ mode: 'readwrite' })
export const ask = (h: Dir) => h.requestPermission({ mode: 'readwrite' })

// --- one JSON file per chat: <id>.json ---
export async function readChats(dir: Dir): Promise<Chat[]> {
  const out: Chat[] = []
  for await (const e of dir.values()) {
    if (e.kind !== 'file' || !e.name.endsWith('.json')) continue
    try {
      const f = await (e as FileSystemFileHandle).getFile()
      const c = JSON.parse(await f.text())
      if (c && typeof c.id === 'string' && Array.isArray(c.messages)) out.push(c)
    } catch {
      /* skip files that aren't valid chats */
    }
  }
  return out
}

export async function writeChat(dir: Dir, c: Chat) {
  const fh = (await dir.getFileHandle(`${c.id}.json`, { create: true })) as WritableFile
  const w = await fh.createWritable()
  await w.write(JSON.stringify(c, null, 2))
  await w.close()
}

export async function removeChat(dir: Dir, id: string) {
  try {
    await dir.removeEntry(`${id}.json`)
  } catch {
    /* already gone */
  }
}