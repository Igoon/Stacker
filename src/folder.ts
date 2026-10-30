// folder.ts — auto-backup ke folder pilihan memakai File System Access API.
// Handle folder tidak bisa disimpan di localStorage (bukan JSON), jadi
// disimpan di IndexedDB. Hanya Chrome/Edge/Android yang mendukung API ini;
// di iOS/Safari tombol otomatis nonaktif (unduh manual tetap jalan).

export interface FolderFileHandle {
  createWritable(): Promise<{
    write(data: string | Blob | BufferSource): Promise<void>;
    close(): Promise<void>;
  }>;
}

export interface FolderHandle {
  name: string;
  kind: "directory";
  queryPermission?(d: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(d: { mode: "readwrite" }): Promise<PermissionState>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FolderFileHandle>;
  values?(): AsyncIterableIterator<{ name: string; kind: string }>;
  removeEntry?(name: string): Promise<void>;
}

const DB_NAME = "stacker-fs";
const STORE = "handles";
const KEY = "backup-dir";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandle(h: FolderHandle | null): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    if (h) store.put(h, KEY);
    else store.delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadHandle(): Promise<FolderHandle | null> {
  const db = await openDb();
  const h = await new Promise<FolderHandle | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as FolderHandle) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return h;
}

export function supportsFolderBackup(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

export async function pickFolder(): Promise<FolderHandle> {
  const picker = (window as unknown as {
    showDirectoryPicker: (opts?: object) => Promise<FolderHandle>;
  }).showDirectoryPicker;
  const h = await picker({ id: "stacker-backup", mode: "readwrite", startIn: "documents" });
  await saveHandle(h);
  return h;
}

export function getFolder(): Promise<FolderHandle | null> {
  return loadHandle().catch(() => null);
}

export function forgetFolder(): Promise<void> {
  return saveHandle(null).catch(() => undefined);
}

// Cek izin tanpa memicu dialog. `request` hanya boleh true dari klik user.
export async function folderPermission(h: FolderHandle, request = false): Promise<boolean> {
  if (!h.queryPermission) return true;
  try {
    if ((await h.queryPermission({ mode: "readwrite" })) === "granted") return true;
    if (!request || !h.requestPermission) return false;
    return (await h.requestPermission({ mode: "readwrite" })) === "granted";
  } catch {
    return false;
  }
}

export async function writeBackupFile(
  h: FolderHandle,
  name: string,
  content: string
): Promise<void> {
  const fh = await h.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
}

// Sisakan `keep` file backup terbaru buatan Stacker (auto/manual).
export async function pruneBackups(h: FolderHandle, keep = 30): Promise<number> {
  if (!h.values || !h.removeEntry) return 0;
  const names: string[] = [];
  for await (const e of h.values()) {
    if (e.kind === "file" && /^stacker-(auto|backup)-\d{4}-\d{2}-\d{2}/.test(e.name)) {
      names.push(e.name);
    }
  }
  names.sort().reverse();
  let removed = 0;
  for (const n of names.slice(keep)) {
    try {
      await h.removeEntry(n);
      removed++;
    } catch {
      // file terkunci/dihapus user -> lewati
    }
  }
  return removed;
}
