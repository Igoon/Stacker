// main.ts — UI chat di main thread. Semua logika + DB berjalan di worker.
import "./style.css";
import type { Tx } from "./db";
import {
  folderPermission,
  forgetFolder,
  getFolder,
  pickFolder,
  supportsFolderBackup,
  writeBackupFile,
  type FolderHandle,
} from "./folder";

interface Reply {
  id: number;
  ok: boolean;
  text?: string;
  txs?: Tx[];
  file?: { name: string; content: string };
  pre?: boolean;
  svg?: string;
  error?: string;
}

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

// Service worker: cache app shell. Kalau SW baru mengambil alih, tampilkan bar
// "Muat ulang" — jangan reload otomatis supaya input user tak hilang.
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    const bar = document.getElementById("update");
    if (bar) bar.hidden = false;
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(new URL(/* @vite-ignore */ "../sw.js", import.meta.url), { scope: "./" })
      .catch((e) => console.warn("[sw] gagal registrasi:", e));
  });
}

let ready = false;
let reqId = 0;
const pending = new Map<number, (r: Reply & Record<string, unknown>) => void>();

function call(msg: Record<string, unknown>): Promise<Reply & Record<string, unknown>> {
  const id = ++reqId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ id, ...msg });
  });
}

worker.onmessage = (ev: MessageEvent<{ id: number } & Record<string, unknown>>) => {
  const m = ev.data;
  if (m.id === -1) {
    if (m.type === "ready") {
      ready = true;
      appVersion = String(m.version ?? "");
      setSub(`v${m.version}`);
      void nowReady();
    } else if (m.type === "error") {
      setSub("gagal inisialisasi DB");
      addBubble(
        "Gagal buka database: " + (m.message ?? "tidak diketahui") +
          "\n\nKemungkinan penyebab:\n" +
          "• iOS/iPadOS < 16.4 — OPFS belum didukung (update iOS).\n" +
          "• Tab/app lain masih terbuka — tutup dulu (hanya 1 tab).\n" +
          "• Mode incognito/private — storage dibatasi, pakai tab normal.",
        "bot"
      );
    }
    return;
  }
  const resolve = pending.get(m.id);
  if (resolve) {
    pending.delete(m.id);
    resolve(m as Reply & Record<string, unknown>);
  }
};

const chat = document.getElementById("chat")!;
const input = document.getElementById("input") as HTMLInputElement;
const saldoEl = document.getElementById("saldo")!;
const subEl = document.getElementById("sub")!;
const busyEl = document.getElementById("busy")!;

function setSub(text: string): void {
  subEl.textContent = text;
}

// Simpan file ke perangkat. Di iOS/Android, `<a download>` sering cuma membuka
// preview — pakai Web Share API bila tersedia supaya bisa "Simpan ke Files"
// atau dibagikan langsung.
function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function saveFile(name: string, content: string): void {
  const isJson = /\.json$/i.test(name);
  const type = isJson ? "application/json" : "text/csv";
  const body = isJson ? content : "\ufeff" + content;
  const blob = new Blob([body], { type });
  try {
    const share = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
      share?: (data?: ShareData) => Promise<void>;
    };
    const f = new File([blob], name, { type });
    if (share.canShare && share.canShare({ files: [f] }) && share.share) {
      void share.share({ files: [f], title: name }).catch(() => downloadBlob(blob, name));
      return;
    }
  } catch {
    // jatuh ke unduhan biasa
  }
  downloadBlob(blob, name);
}

function addBubble(
  text: string,
  side: "me" | "bot",
  txs?: Tx[],
  file?: { name: string; content: string },
  svg?: string
) {
  const row = document.createElement("div");
  row.className = "row " + side;
  const b = document.createElement("div");
  b.className = "bubble";
  b.textContent = text;
  if (svg) {
    // SVG dibuat lokal dari angka (tanpa lib, tanpa request keluar).
    const wrap = document.createElement("div");
    wrap.className = "chart";
    wrap.innerHTML = svg;
    b.appendChild(wrap);
  }
  for (const tx of txs || []) {
    const d = document.createElement("div");
    d.className = "tx";
    d.dataset.txId = String(tx.id);
    const sign = tx.tipe === "masuk" ? "+" : "-";
    const strong = document.createElement("b");
    strong.textContent = sign + tx.rupiah;
    d.appendChild(strong);
    d.appendChild(
      document.createTextNode(
        " · " + tx.kategori + (tx.akun ? " · " + tx.akun : "") + " · #" + tx.id
      )
    );
    const btn = document.createElement("button");
    btn.textContent = "Hapus";
    btn.onclick = async () => {
      const res = await call({ type: "delete", txId: tx.id });
      // Transfer = dua baris; hapus semua bubble dengan id yang benar-benar
      // terhapus supaya tampilan tak menyisakan pasangan basi.
      const ids = Array.isArray(res.ids) ? (res.ids as number[]) : [tx.id];
      for (const id of ids) {
        chat.querySelectorAll(`.tx[data-tx-id="${id}"]`).forEach((el) => {
          const host = el.closest(".bubble");
          el.remove();
          if (host && !host.querySelector(".tx")) host.remove();
        });
      }
      void refresh();
    };
    d.appendChild(document.createElement("br"));
    d.appendChild(btn);
    b.appendChild(d);
  }
  if (file) {
    const a = document.createElement("a");
    a.className = "dl";
    a.href = "#";
    a.download = file.name;
    a.textContent = "⬇ " + file.name;
    a.onclick = (ev) => {
      ev.preventDefault();
      saveFile(file.name, file.content);
    };
    b.appendChild(document.createElement("br"));
    b.appendChild(a);
  }
  row.appendChild(b);
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

// Chat ephemeral: jangan render riwayat, cukup hint sekali di awal.
let hintShown = false;
function showStartupHint(s: Record<string, unknown>): void {
  if (hintShown) return;
  hintShown = true;
  const n = Number(s.txCount ?? 0);
  if (n > 0) {
    addBubble(
      `${n} transaksi tersimpan di perangkat ini.\n` +
        "Ketik `riwayat` untuk melihat, `help` untuk daftar perintah.",
      "bot"
    );
  }
}

async function refresh(): Promise<Record<string, unknown>> {
  const r = await call({ type: "state" });
  saldoEl.textContent = "Saldo: " + r.saldoRupiah;
  pinSet = !!r.pinSet;
  txCount = Number(r.txCount ?? 0);
  lastBackupAt = typeof r.lastBackupAt === "string" ? r.lastBackupAt : null;
  // Notice dari worker (mis. transaksi berulang yang baru dicatat).
  const notes = Array.isArray(r.notices) ? (r.notices as string[]) : [];
  for (const n of notes) addBubble(n, "bot");
  return r;
}

async function send(): Promise<void> {
  const text = input.value.trim();
  if (!text || !ready) return;
  addBubble(text, "me");
  input.value = "";
  busyEl.hidden = false;
  const r = await call({ type: "chat", text });
  busyEl.hidden = true;
  if (r.ok) {
    addBubble(r.text ?? "", "bot", r.txs, r.file, r.svg);
    if (r.lock) {
      pinSet = true;
      lockNow();
      return;
    }
  } else {
    addBubble("Error: " + (r.error ?? "tidak diketahui"), "bot");
  }
  void refresh();
}

document.getElementById("send")!.onclick = send;
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") send();
});

// Toolbar: export backup, import backup, set AI key.
document.getElementById("export")!.onclick = async () => {
  const r = await call({ type: "export" });
  saveFile(`stacker-backup-${new Date().toISOString().slice(0, 10)}.json`, r.json as string);
};

document.getElementById("import")!.onclick = () => {
  document.getElementById("importFile")!.click();
};

document.getElementById("importFile")!.addEventListener("change", async (e) => {
  const inputEl = e.target as HTMLInputElement;
  const file = inputEl.files?.[0];
  if (!file) return;
  const text = await file.text();
  inputEl.value = "";
  await doImport(text);
});

// Modal pengaturan AI.
const aiModal = document.getElementById("aiModal")!;
const aiProvider = document.getElementById("aiProvider") as HTMLSelectElement;
const aiBase = document.getElementById("aiBase") as HTMLInputElement;
const aiModel = document.getElementById("aiModel") as HTMLInputElement;
const aiKey = document.getElementById("aiKey") as HTMLInputElement;

function toggleBaseRow(): void {
  const isOpenai = aiProvider.value === "openai";
  aiBase.closest("label")!.style.display = isOpenai ? "" : "none";
  if (!aiModel.value) aiModel.placeholder = isOpenai ? "llama3.2" : "gemini-2.0-flash";
}

aiProvider.addEventListener("change", toggleBaseRow);

document.getElementById("aikey")!.onclick = async () => {
  const r = await call({ type: "getai" });
  const c = (r.config ?? {}) as {
    provider?: string;
    model?: string;
    baseUrl?: string;
    key?: string;
  };
  aiProvider.value = c.provider === "openai" ? "openai" : "gemini";
  aiBase.value = c.baseUrl ?? "";
  aiModel.value = c.model ?? "";
  aiKey.value = c.key ?? "";
  toggleBaseRow();
  aiModal.hidden = false;
};

document.getElementById("aiCancel")!.onclick = () => {
  aiModal.hidden = true;
};

document.getElementById("aiSave")!.onclick = async () => {
  aiModal.hidden = true;
  await call({
    type: "setai",
    provider: aiProvider.value,
    model: aiModel.value.trim(),
    baseUrl: aiBase.value.trim(),
    key: aiKey.value.trim(),
  });
  void refresh();
};

// ---------- Wallpaper chat (preset + gambar sendiri, ala WA) ----------
// Disimpan di localStorage (kosmetik, bukan data keuangan) supaya tak
// memperbesar file backup dan tak menyentuh DB.
interface WallPreset {
  id: string;
  label: string;
  css: string;
}

const WALL_PRESETS: WallPreset[] = [
  { id: "default", label: "Default", css: "" },
  { id: "teal", label: "Teal", css: "linear-gradient(160deg,#0b141a,#12403d)" },
  { id: "forest", label: "Hutan", css: "linear-gradient(160deg,#07160f,#145c3a)" },
  { id: "ocean", label: "Laut", css: "linear-gradient(160deg,#061421,#124a6b)" },
  { id: "plum", label: "Plum", css: "linear-gradient(160deg,#140b1a,#4a1a5c)" },
  { id: "sand", label: "Pasir", css: "linear-gradient(160deg,#1a1410,#5c4326)" },
  { id: "night", label: "Malam", css: "linear-gradient(160deg,#000000,#1f2c33)" },
  { id: "rose", label: "Rose", css: "linear-gradient(160deg,#1a0b12,#6b2440)" },
];

const WALL_KEY = "stacker-wallpaper";

type Wall =
  | { kind: "default" }
  | { kind: "preset"; id: string }
  | { kind: "image"; image: string; dim: number };

const wallModal = document.getElementById("wallModal")!;
const wallSwatches = document.getElementById("wallSwatches")!;
const wallFile = document.getElementById("wallFile") as HTMLInputElement;
const wallDim = document.getElementById("wallDim") as HTMLInputElement;
const wallDimVal = document.getElementById("wallDimVal")!;

function readWall(): Wall {
  try {
    const raw = localStorage.getItem(WALL_KEY);
    if (!raw) return { kind: "default" };
    const w = JSON.parse(raw) as Wall;
    if (w && w.kind === "image" && typeof w.image === "string") {
      return { kind: "image", image: w.image, dim: Number(w.dim) || 0 };
    }
    if (w && w.kind === "preset" && WALL_PRESETS.some((p) => p.id === w.id)) {
      return { kind: "preset", id: w.id };
    }
  } catch {
    // localStorage diblokir / data rusak -> pakai default.
  }
  return { kind: "default" };
}

function saveWall(w: Wall): boolean {
  try {
    localStorage.setItem(WALL_KEY, JSON.stringify(w));
    return true;
  } catch {
    return false;
  }
}

function applyWall(w: Wall): void {
  const s = chat.style;
  s.backgroundRepeat = "no-repeat";
  s.backgroundPosition = "center";
  if (w.kind === "image") {
    s.backgroundColor = "#0b141a";
    s.backgroundImage = `linear-gradient(rgba(0,0,0,${w.dim}), rgba(0,0,0,${w.dim})), url("${w.image}")`;
    s.backgroundSize = "cover, cover";
    return;
  }
  s.backgroundColor = "";
  if (w.kind === "preset") {
    const p = WALL_PRESETS.find((x) => x.id === w.id);
    s.backgroundImage = p?.css || "";
    s.backgroundSize = "";
    return;
  }
  s.backgroundImage = "";
  s.backgroundSize = "";
}

let currentWall: Wall = readWall();

function syncWallControls(w: Wall): void {
  const activeId = w.kind === "preset" ? w.id : w.kind === "default" ? "default" : "";
  for (const btn of Array.from(wallSwatches.querySelectorAll<HTMLButtonElement>(".swatch"))) {
    btn.setAttribute("aria-pressed", String(btn.dataset.preset === activeId));
  }
  const dim = w.kind === "image" ? w.dim : 45;
  wallDim.value = String(Math.round(dim * 100));
  wallDimVal.textContent = `${Math.round(dim * 100)}%`;
}

for (const p of WALL_PRESETS) {
  const btn = document.createElement("button");
  btn.className = "swatch";
  btn.type = "button";
  btn.dataset.preset = p.id;
  btn.textContent = p.label;
  if (p.css) btn.style.background = p.css;
  btn.onclick = () => {
    currentWall = p.id === "default" ? { kind: "default" } : { kind: "preset", id: p.id };
    applyWall(currentWall);
    saveWall(currentWall);
    syncWallControls(currentWall);
  };
  wallSwatches.appendChild(btn);
}

document.getElementById("wall")!.onclick = () => {
  currentWall = readWall();
  syncWallControls(currentWall);
  wallModal.hidden = false;
};

document.getElementById("wallClose")!.onclick = () => {
  wallModal.hidden = true;
};

document.getElementById("wallReset")!.onclick = () => {
  currentWall = { kind: "default" };
  applyWall(currentWall);
  saveWall(currentWall);
  wallFile.value = "";
  syncWallControls(currentWall);
};

wallDim.addEventListener("input", () => {
  const dim = Number(wallDim.value) / 100;
  wallDimVal.textContent = `${Math.round(dim * 100)}%`;
  if (currentWall.kind === "image") {
    currentWall = { kind: "image", image: currentWall.image, dim };
    applyWall(currentWall);
    saveWall(currentWall);
  }
});

// Resize + kompres gambar di perangkat: maks 1280 px sisi terpanjang, JPEG q0.8.
async function fileToWallImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("gagal muat gambar"));
      img.src = url;
    });
    const max = 1280;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d");
    if (!ctx) throw new Error("canvas tidak tersedia");
    // Latar gelap supaya PNG transparan tak jadi putih menyala.
    ctx.fillStyle = "#0b141a";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return cv.toDataURL("image/jpeg", 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

wallFile.addEventListener("change", async () => {
  const file = wallFile.files?.[0];
  if (!file) return;
  try {
    const image = await fileToWallImage(file);
    if (image.length > 3_000_000) {
      addBubble("Gambar terlalu besar setelah dikompres. Pilih gambar lain.", "bot");
      wallFile.value = "";
      return;
    }
    const dim = Number(wallDim.value) / 100;
    currentWall = { kind: "image", image, dim };
    applyWall(currentWall);
    if (!saveWall(currentWall)) {
      addBubble("Gagal menyimpan wallpaper (penyimpanan browser penuh).", "bot");
    }
    syncWallControls(currentWall);
  } catch {
    addBubble("Gagal membaca gambar. Coba file lain (JPG/PNG).", "bot");
  } finally {
    wallFile.value = "";
  }
});

applyWall(currentWall);
syncWallControls(currentWall);

// ---------- PIN & auto-lock ----------
// PIN hanya mengunci tampilan (bukan enkripsi disk): hash PBKDF2 + salt
// disimpan di tabel settings dan tak ikut file backup.
let pinSet = false;
let lockFails = 0;
let lockCooldownUntil = 0;
let idleTimer: number | undefined;
const IDLE_MS = 2 * 60 * 1000;

const lockEl = document.getElementById("lock")!;
const lockPin = document.getElementById("lockPin") as HTMLInputElement;
const lockMsg = document.getElementById("lockMsg")!;

function lockNow(): void {
  if (!pinSet) return;
  if (idleTimer) window.clearTimeout(idleTimer);
  lockEl.hidden = false;
  lockPin.value = "";
  lockMsg.textContent = "";
  window.setTimeout(() => lockPin.focus(), 60);
}

function unlockUi(): void {
  lockEl.hidden = true;
  lockPin.value = "";
  lockMsg.textContent = "";
  touchIdle();
  void refresh().then((s) => {
    showStartupHint(s);
    handleSharedText();
    void autoBackup();
  });
}

function touchIdle(): void {
  if (idleTimer) window.clearTimeout(idleTimer);
  if (lockEl.hidden && pinSet) idleTimer = window.setTimeout(lockNow, IDLE_MS);
}

async function tryUnlock(): Promise<void> {
  const now = Date.now();
  if (now < lockCooldownUntil) {
    lockMsg.textContent = `Tunggu ${Math.ceil((lockCooldownUntil - now) / 1000)} detik.`;
    return;
  }
  const pin = lockPin.value.trim();
  if (!pin) return;
  const r = await call({ type: "pincheck", pin });
  if (r.ok) {
    lockFails = 0;
    unlockUi();
    return;
  }
  lockFails++;
  lockPin.value = "";
  if (lockFails >= 5) {
    lockFails = 0;
    lockCooldownUntil = Date.now() + 30_000;
    lockMsg.textContent = "Terlalu banyak salah. Tunggu 30 detik.";
  } else {
    lockMsg.textContent = `PIN salah (${lockFails}/5).`;
  }
  lockPin.focus();
}

document.getElementById("lockBtn")!.onclick = () => void tryUnlock();
lockPin.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void tryUnlock();
});
for (const ev of ["pointerdown", "keydown", "touchstart"] as const) {
  window.addEventListener(ev, touchIdle, { passive: true });
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) lockNow();
});

// ---------- Backup terenkripsi: minta kata sandi ----------
const passModal = document.getElementById("passModal")!;
const passInput = document.getElementById("passInput") as HTMLInputElement;
let pendingImport: string | null = null;

function askPass(text: string): void {
  pendingImport = text;
  passInput.value = "";
  passModal.hidden = false;
  passInput.focus();
}

async function doImport(text: string, pass?: string): Promise<void> {
  const r = await call({ type: "import", json: text, pass });
  if (r.needPass) {
    askPass(text);
    return;
  }
  addBubble(r.ok ? "Backup dimuat." : "Gagal impor: " + (r.error ?? "format salah"), "bot");
  void refresh();
}

document.getElementById("passCancel")!.onclick = () => {
  pendingImport = null;
  passModal.hidden = true;
};

document.getElementById("passOk")!.onclick = () => {
  const text = pendingImport;
  pendingImport = null;
  passModal.hidden = true;
  if (text) void doImport(text, passInput.value);
};

passInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("passOk")!.click();
});

// ---------- Info, storage permanen, auto-backup folder ----------
let appVersion = "";
let txCount = 0;
let lastBackupAt: string | null = null;
let persisted = false;
let folder: FolderHandle | null = null;
let storageText = "";
let bundleHash = "";
let aiHosts = "tidak ada (AI mati)";

const todayStr = (): string => new Date().toISOString().slice(0, 10);

const infoModal = document.getElementById("infoModal")!;
const infoLines = document.getElementById("infoLines")!;
const pickDirBtn = document.getElementById("pickDir") as HTMLButtonElement;
const backupNowBtn = document.getElementById("backupNow") as HTMLButtonElement;
const clearDirBtn = document.getElementById("clearDir") as HTMLButtonElement;

async function nowReady(): Promise<void> {
  const s = await refresh();
  if (s.pinSet) {
    lockNow();
  } else {
    showStartupHint(s);
    handleSharedText();
  }
  await initStorage();
}

async function initStorage(): Promise<void> {
  try {
    const st = navigator.storage;
    if (st) {
      persisted = (await st.persisted?.()) ?? false;
      // Minta storage permanen supaya OPFS tak dibersihkan browser saat
      // penyimpanan menipis. Bisa ditolak (mis. mode privat) — abaikan.
      if (!persisted && st.persist) persisted = await st.persist();
    }
  } catch {
    // Storage API dibatasi; lanjut tanpa status permanen.
  }
  folder = await getFolder();
  if (!lockEl.hidden) return; // tunggu dibuka dulu kalau PIN aktif
  await autoBackup();
}

async function autoBackup(force = false): Promise<void> {
  if (!folder) return;
  if (!force && lastBackupAt === todayStr()) return;
  if (!(await folderPermission(folder, false))) return;
  try {
    const dir = folder;
    const r = await call({ type: "export" });
    const name = `stacker-${force ? "backup" : "auto"}-${todayStr()}.json`;
    await writeBackupFile(dir, name, r.json as string);
    lastBackupAt = todayStr();
    addBubble(
      `${force ? "Backup disimpan" : "Auto-backup disimpan"}: ${name} (folder ${dir.name}).`,
      "bot"
    );
    renderInfo();
  } catch (e) {
    addBubble("Auto-backup gagal: " + (e as Error).message, "bot");
  }
}

async function refreshStorageText(): Promise<void> {
  try {
    const est = await navigator.storage?.estimate?.();
    const mb = (n?: number) => (n && n > 0 ? (n / 1048576).toFixed(1) + " MB" : "?");
    storageText =
      `Pemakaian storage: ${mb(est?.usage)} / ${mb(est?.quota)}\n` +
      `Penyimpanan permanen: ${persisted ? "ya" : "belum"}`;
  } catch {
    storageText = "";
  }
}

// SHA-256 dari bundle utama. Pengguna bisa mencocokkan nilainya dengan release
// notes sehingga kode yang berjalan bisa diverifikasi.
async function bundleSha256(): Promise<string> {
  try {
    const res = await fetch(import.meta.url, { cache: "no-store" });
    if (!res.ok) return "";
    const buf = await res.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "";
  }
}

async function refreshAiHosts(): Promise<void> {
  try {
    const r = await call({ type: "getai" });
    const c = (r.config ?? {}) as { provider?: string; baseUrl?: string; key?: string };
    if (c.provider === "openai") {
      const base = (c.baseUrl ?? "").trim();
      if (!base) {
        aiHosts = "belum diatur";
      } else {
        try {
          aiHosts = new URL(base).host;
        } catch {
          aiHosts = base;
        }
      }
    } else {
      aiHosts = (c.key ?? "").trim()
        ? "generativelanguage.googleapis.com"
        : "tidak ada (AI mati)";
    }
  } catch {
    aiHosts = "?";
  }
}

function renderInfo(): void {
  infoLines.textContent = [
    `Versi: v${appVersion || "-"}`,
    `Build: ${__BUILD_SHA__ || "lokal"} (${__BUILD_TIME__.slice(0, 10)})`,
    `Hash bundle SHA-256: ${bundleHash || "menghitung…"}`,
    `Host AI: ${aiHosts}`,
    `Data: lokal di perangkat (OPFS), tanpa server`,
    "",
    `Transaksi: ${txCount}`,
    `Backup terakhir: ${lastBackupAt ?? "belum pernah"}`,
    `Auto-backup: ${folder ? folder.name : "nonaktif"}`,
    storageText ? "\n" + storageText : "",
  ]
    .filter((x) => x !== "")
    .join("\n");
  pickDirBtn.disabled = !supportsFolderBackup();
  backupNowBtn.disabled = !folder;
  clearDirBtn.disabled = !folder;
}

document.getElementById("info")!.onclick = async () => {
  await Promise.all([refreshStorageText(), refresh(), refreshAiHosts()]);
  infoModal.hidden = false;
  renderInfo();
  bundleHash = await bundleSha256();
  renderInfo();
};

document.getElementById("infoClose")!.onclick = () => {
  infoModal.hidden = true;
};

document.getElementById("updateReload")!.onclick = () => location.reload();

pickDirBtn.onclick = async () => {
  if (!supportsFolderBackup()) {
    addBubble("Browser ini tak mendukung auto-backup folder. Pakai tombol ⬇ Backup.", "bot");
    return;
  }
  try {
    folder = await pickFolder();
    const ok = await folderPermission(folder, true);
    if (!ok) {
      folder = null;
      await forgetFolder();
      addBubble("Izin folder ditolak. Auto-backup tidak aktif.", "bot");
      renderInfo();
      return;
    }
    await autoBackup(true);
    renderInfo();
  } catch (e) {
    if ((e as Error).name !== "AbortError") {
      addBubble("Gagal memilih folder: " + (e as Error).message, "bot");
    }
  }
};

backupNowBtn.onclick = async () => {
  if (!folder) return;
  const ok = await folderPermission(folder, true);
  if (!ok) {
    addBubble("Izin folder ditolak. Pilih folder lagi lewat ℹ.", "bot");
    return;
  }
  await autoBackup(true);
};

clearDirBtn.onclick = async () => {
  folder = null;
  await forgetFolder();
  addBubble("Auto-backup dimatikan.", "bot");
  renderInfo();
};

// Share target (PWA): teks yang dibagikan dari app lain (notifikasi SMS,
// WhatsApp, dsb.) langsung diisi ke kolom chat lalu dikirim.
function handleSharedText(): void {
  const sp = new URLSearchParams(location.search);
  const parts = [sp.get("text"), sp.get("title"), sp.get("url")].filter(
    (x): x is string => !!x && x.trim().length > 0
  );
  if (parts.length === 0) return;
  history.replaceState({}, "", location.pathname + location.hash);
  input.value = parts.join(" ").slice(0, 500);
  input.focus();
  void send();
}

addBubble(
  "Halo! Catat transaksi tinggal ketik.\nContoh: `makan siang 50rb` / `gaji 5jt`\nKetik `help` buat perintah.",
  "bot"
);
