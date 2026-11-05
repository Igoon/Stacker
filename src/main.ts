// main.ts — UI chat di main thread. Semua logika + DB berjalan di worker.
import "./style.css";
import { startsWithCommand } from "./commands";
import type { Tx } from "./db";
import {
  folderPermission,
  forgetFolder,
  getFolder,
  pickFolder,
  pruneBackups,
  supportsFolderBackup,
  writeBackupFile,
  type FolderHandle,
} from "./folder";

interface Reply {
  id: number;
  ok: boolean;
  text?: string;
  txs?: Tx[];
  removedIds?: number[];
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
  // Tampilkan versi baru + catatan rilis (dari version.json hasil build) supaya
  // user tahu apa yang di-update, bukan sekadar "versi baru".
  const showUpdateBar = async (): Promise<void> => {
    const bar = document.getElementById("update");
    if (!bar) return;
    const title = document.getElementById("updateTitle");
    const list = document.getElementById("updateNotes");
    let ver = "";
    try {
      const res = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const v = (await res.json()) as { version?: string; notes?: string[] };
        ver = String(v.version ?? "");
        // Bandingkan dengan versi yang SEDANG berjalan. Kalau sama, berarti
        // sudah memakai versi terbaru → jangan tampilkan notif palsu.
        if (ver && appVersion && ver === appVersion) {
          bar.hidden = true;
          return;
        }
        if (list && Array.isArray(v.notes) && v.notes.length > 0) {
          list.replaceChildren();
          for (const n of v.notes.slice(0, 5)) {
            const li = document.createElement("li");
            li.textContent = n;
            list.appendChild(li);
          }
          list.hidden = false;
        }
      }
    } catch {
      // Offline / version.json tak tersedia: pakai teks umum.
    }
    if (title) {
      title.textContent = ver
        ? `Versi baru ${ver}${appVersion ? ` — kamu di v${appVersion}` : ""}`
        : `Versi baru tersedia${appVersion ? ` (kamu di v${appVersion})` : ""}`;
    }
    bar.hidden = false;
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    void showUpdateBar();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(new URL(/* @vite-ignore */ "../sw.js", import.meta.url), { scope: "./" })
      .then((reg) => {
        // Cek update walau app lama terbuka (tanpa reload/navigasi).
        const check = () => void reg.update().catch(() => undefined);
        window.setInterval(check, 60 * 60 * 1000);
        document.addEventListener("visibilitychange", () => {
          if (!document.hidden) check();
        });
      })
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
const chipsEl = document.getElementById("chips")!;
const suggestEl = document.getElementById("suggest")!;
const undoBtn = document.getElementById("undo") as HTMLButtonElement;
const historyBtn = document.getElementById("history") as HTMLButtonElement;
const histModal = document.getElementById("histModal")!;
const histList = document.getElementById("histList")!;

// App shortcut (manifest ?action=catat|ringkasan|cari).
let launchAction: string | null = null;
try {
  launchAction = new URLSearchParams(location.search).get("action");
} catch {
  launchAction = null;
}
if (launchAction) {
  try {
    history.replaceState({}, "", location.pathname + location.hash);
  } catch {
    // abaikan
  }
}
function runLaunchAction(): void {
  const a = launchAction;
  launchAction = null;
  if (!a) return;
  if (a === "ringkasan") {
    showInfoPane(dashModal);
    void renderDash();
  } else if (a === "cari") {
    input.value = "cari ";
    input.focus();
  } else {
    input.focus();
  }
}

// Riwayat perintah (localStorage) — muncul lewat panah ↑/↓ & saran saat mengetik.
const RECENT_KEY = "stacker-cmd-history";
function readRecent(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(arr)
      ? arr.filter((x): x is string => typeof x === "string").slice(0, 30)
      : [];
  } catch {
    return [];
  }
}
let recentCommands = readRecent();
function rememberCommand(text: string): void {
  const t = text.trim();
  if (!t) return;
  recentCommands = [t, ...recentCommands.filter((x) => x !== t)].slice(0, 30);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentCommands));
  } catch {
    // abaikan
  }
}

// Tanggal pasang/dipakai pertama — disimpan di DB settings (first_use_at).
// Nilai lama (localStorage) dimigrasikan sekali saat app siap.
const LEGACY_FIRST_USE_KEY = "stacker-first-use";
let firstUseAt = "";
function legacyFirstUse(): string | null {
  try {
    return localStorage.getItem(LEGACY_FIRST_USE_KEY);
  } catch {
    return null;
  }
}
const isStandalone =
  (typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches) ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86_400_000)) : 0;
}
function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

// Getar singkat (opsional).
const HAPTIC_KEY = "stacker-haptic";
function readHaptic(): boolean {
  try {
    const v = localStorage.getItem(HAPTIC_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}
let hapticOn = readHaptic();
function haptic(pattern: number | number[] = 12): void {
  if (!hapticOn) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // abaikan
  }
}

// Onboarding: chip contoh perintah saat belum ada transaksi.
for (const c of ["makan siang 50rb", "gaji 5jt", "kopi 18rb", "ringkasan"]) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = c;
  b.onclick = () => {
    input.value = c;
    input.focus();
  };
  chipsEl.appendChild(b);
}

// Toast: feedback untuk aksi di menu (tampil di atas modal, tidak tertutup).
const toastEl = document.getElementById("toast")!;
let toastTimer: number | undefined;
function showToast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 3600);
}

// Saran perintah dari riwayat saat mengetik.
function updateSuggest(): void {
  const q = input.value.trim().toLowerCase();
  suggestEl.replaceChildren();
  if (!q) {
    suggestEl.hidden = true;
    return;
  }
  const matches = recentCommands
    .filter((c) => c.toLowerCase() !== q && c.toLowerCase().includes(q))
    .slice(0, 6);
  if (!matches.length) {
    suggestEl.hidden = true;
    return;
  }
  for (const c of matches) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = c;
    b.onclick = () => {
      input.value = c;
      input.focus();
      suggestEl.hidden = true;
    };
    suggestEl.appendChild(b);
  }
  suggestEl.hidden = false;
}

// Riwayat perintah untuk layar sentuh (tanpa tombol panah).
function renderHistory(): void {
  histList.replaceChildren();
  if (!recentCommands.length) {
    const p = document.createElement("p");
    p.className = "info-note";
    p.textContent = "Belum ada riwayat perintah.";
    histList.appendChild(p);
    return;
  }
  for (const c of recentCommands) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hist-item";
    b.textContent = c;
    b.onclick = () => {
      input.value = c;
      histModal.hidden = true;
      input.focus();
      suggestEl.hidden = true;
    };
    histList.appendChild(b);
  }
}
historyBtn.onclick = () => {
  renderHistory();
  histModal.hidden = false;
};
document.getElementById("histClose")!.onclick = () => {
  histModal.hidden = true;
};

// Ajakan pasang app (Android/desktop). Muncul hanya bila browser menawarkan.
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<unknown>;
};
let deferredInstall: InstallPromptEvent | null = null;
const installAppBtn = document.getElementById("installApp") as HTMLButtonElement;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e as InstallPromptEvent;
  installAppBtn.hidden = false;
});
installAppBtn.onclick = async () => {
  const ev = deferredInstall;
  deferredInstall = null;
  installAppBtn.hidden = true;
  if (!ev) return;
  try {
    await ev.prompt();
    await ev.userChoice;
  } catch {
    // abaikan
  }
};
window.addEventListener("appinstalled", () => {
  deferredInstall = null;
  installAppBtn.hidden = true;
  showToast("App terpasang.");
});

// Privasi saldo: default TERSAMAR. Ketuk pil saldo untuk lihat; auto-samar
// lagi saat app ditinggalkan.
const HIDE_SALDO_KEY = "stacker-hide-saldo";
function readHideSaldo(): boolean {
  try {
    const v = localStorage.getItem(HIDE_SALDO_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}
let hideSaldo = readHideSaldo();
let saldoRevealed = false;
let lastSaldoRupiah = "-";

function toggleSaldo(): void {
  if (!hideSaldo) return;
  saldoRevealed = !saldoRevealed;
  renderSaldo();
}
function renderSaldo(): void {
  saldoEl.textContent = "Saldo: " + (hideSaldo && !saldoRevealed ? "••••" : lastSaldoRupiah);
  saldoEl.title = hideSaldo ? (saldoRevealed ? "Ketuk untuk samarkan" : "Ketuk untuk lihat saldo") : "";
  saldoEl.setAttribute(
    "aria-label",
    !hideSaldo
      ? `Saldo ${lastSaldoRupiah}`
      : saldoRevealed
        ? "Saldo terlihat, ketuk untuk samarkan"
        : "Saldo tersamar, ketuk untuk lihat"
  );
}
saldoEl.addEventListener("click", toggleSaldo);
saldoEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    toggleSaldo();
  }
});

// Bunyi pengingat singkat (Web Audio, tanpa aset & tanpa jaringan).
const SOUND_KEY = "stacker-sound";
function readSound(): boolean {
  try {
    const v = localStorage.getItem(SOUND_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}
let soundOn = readSound();
let audioCtx: AudioContext | null = null;
function unlockAudio(): void {
  try {
    if (!audioCtx) {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === "suspended") void audioCtx.resume();
  } catch {
    // Web Audio tak tersedia; abaikan.
  }
}
// Bel "tiiing": fundamental cerah + partial inharmonik (khas bel) + decay
// panjang, plus transien singkat saat dipukul.
function playTing(): void {
  const ctx = audioCtx;
  if (!soundOn || !ctx || ctx.state !== "running") return;
  try {
    const t0 = ctx.currentTime + 0.005;
    const fund = 1174.66; // D6 — nyaring tapi tidak memekakkan
    const partials: { r: number; g: number; d: number }[] = [
      { r: 1, g: 0.22, d: 1.6 },
      { r: 2.0, g: 0.12, d: 1.2 },
      { r: 2.76, g: 0.08, d: 0.9 },
      { r: 5.4, g: 0.05, d: 0.6 },
      { r: 8.93, g: 0.03, d: 0.4 },
      { r: 13.34, g: 0.015, d: 0.25 },
    ];
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    for (const p of partials) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = fund * p.r;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(p.g, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + p.d);
      o.connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + p.d + 0.05);
    }
    // Transien "tik" (noise) singkat untuk serangan bel.
    const len = Math.ceil(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3000;
    const ng = ctx.createGain();
    ng.gain.value = 0.06;
    src.connect(hp).connect(ng).connect(master);
    src.start(t0);
  } catch {
    // abaikan
  }
}
for (const ev of ["pointerdown", "keydown", "touchstart"] as const) {
  window.addEventListener(ev, unlockAudio, { passive: true });
}

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

function removeTxRows(ids: number[]): void {
  for (const id of ids) {
    chat.querySelectorAll(`.tx[data-tx-id="${id}"]`).forEach((el) => {
      const host = el.closest(".bubble");
      el.remove();
      if (host && !host.querySelector(".tx")) host.remove();
    });
  }
}

function clearTxRows(): void {
  chat.querySelectorAll(".tx").forEach((el) => {
    const host = el.closest(".bubble");
    el.remove();
    if (host && !host.querySelector(".tx")) host.remove();
  });
}

function addBubble(
  text: string,
  side: "me" | "bot",
  txs?: Tx[],
  file?: { name: string; content: string },
  svg?: string,
  pre?: boolean
) {
  const row = document.createElement("div");
  row.className = "row " + side;
  const b = document.createElement("div");
  b.className = "bubble" + (pre ? " pre" : "") + (svg ? " has-chart" : "");
  b.textContent = text;
  if (svg) {
    // SVG dibuat lokal dari angka (tanpa lib, tanpa request keluar).
    const wrap = document.createElement("div");
    wrap.className = "chart";
    wrap.innerHTML = svg;
    b.appendChild(wrap);
  }
  // Transfer = dua baris dengan transfer_id sama. Tampilkan satu baris + satu
  // tombol; keduanya tetap terhapus bersama.
  const doneTransfers = new Set<string>();
  for (const tx of txs || []) {
    if (tx.transfer_id) {
      if (doneTransfers.has(tx.transfer_id)) continue;
      doneTransfers.add(tx.transfer_id);
    }
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
    btn.textContent = tx.transfer_id ? "Hapus (2 baris)" : "Hapus";
    btn.onclick = async () => {
      const res = await call({ type: "delete", txId: tx.id });
      // Transfer = dua baris; hapus semua bubble dengan id yang benar-benar
      // terhapus supaya tampilan tak menyisakan pasangan basi.
      const ids = Array.isArray(res.ids) ? (res.ids as number[]) : [tx.id];
      removeTxRows(ids);
      const removed = Number(res.removed ?? 0);
      if (removed > 0) {
        addBubble(
          removed > 1
            ? `${removed} baris dihapus. Ketik \`undo\` untuk batalkan.`
            : "Transaksi dihapus. Ketik `undo` untuk batalkan.",
          "bot"
        );
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
      if (/^(stacker-backup-|backup-pre-reset-)/.test(file.name)) {
        lastBackupAt = todayStr();
        void call({ type: "markbackup", tanggal: lastBackupAt });
      }
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
    return;
  }
  // Pengguna baru / belum ada transaksi: tampilkan sapaan & contoh.
  addBubble(
    "Halo! Catat transaksi tinggal ketik.\nContoh: `makan siang 50rb` / `gaji 5jt`\nKetik `help` buat perintah.",
    "bot"
  );
}

async function refresh(): Promise<Record<string, unknown>> {
  const r = await call({ type: "state" });
  lastSaldoRupiah = String(r.saldoRupiah ?? "-");
  renderSaldo();
  pinSet = !!r.pinSet;
  txCount = Number(r.txCount ?? 0);
  chipsEl.hidden = txCount > 0;
  undoBtn.disabled = !r.canUndo;
  if (typeof r.firstUseAt === "string" && r.firstUseAt) firstUseAt = r.firstUseAt;
  const navBadge = navigator as Navigator & {
    setAppBadge?: (n: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    const alerts = Number(r.alerts ?? 0);
    if (alerts > 0) void navBadge.setAppBadge?.(alerts);
    else void navBadge.clearAppBadge?.();
  } catch {
    // Badging API tak didukung; abaikan.
  }
  lastBackupAt = typeof r.lastBackupAt === "string" ? r.lastBackupAt : null;
  // Notice dari worker (mis. transaksi berulang yang baru dicatat).
  const notes = Array.isArray(r.notices) ? (r.notices as string[]) : [];
  for (const n of notes) addBubble(n, "bot");
  if (notes.length > 0) playTing();
  return r;
}

async function send(): Promise<void> {
  const text = input.value.trim();
  if (!text || !ready) return;
  // Bersihkan layar chat (bukan hapus data).
  if (/^(cls|clear|bersihkan(?:\s+layar)?)$/i.test(text)) {
    rememberCommand(text);
    input.value = "";
    suggestEl.hidden = true;
    chat.replaceChildren();
    showToast("Layar dibersihkan.");
    return;
  }
  const isReset = /^reset\s+(transaksi|laporan|semua|kategori|akun)$/i.test(text);
  if (/^reset\s+semua$/i.test(text)) {
    if (
      !window.confirm(
        "Reset TOTAL: hapus semua data (transaksi, akun, kategori, anggaran, utang, " +
          "berulang, pengaturan). Backup JSON diunduh otomatis. Lanjut?"
      )
    )
      return;
  } else if (isReset) {
    if (
      !window.confirm(
        "Lanjut hapus? Backup JSON diunduh otomatis (bisa dibatalkan dengan `undo`)."
      )
    )
      return;
  }
  rememberCommand(text);
  addBubble(text, "me");
  input.value = "";
  suggestEl.hidden = true;
  busyEl.hidden = false;
  const r = await call({ type: "chat", text });
  busyEl.hidden = true;
  if (r.ok) {
    addBubble(r.text ?? "", "bot", r.txs, r.file, r.svg, r.pre);
    if (Array.isArray(r.txs) && r.txs.length > 0) haptic(14);
    if (/^Dibatalkan\b/.test(r.text ?? "")) haptic([10, 40, 10]);
    if (isReset && r.file) {
      const f = r.file as { name: string; content: string };
      saveFile(f.name, f.content);
    }
    if (/^reset\s+(transaksi|laporan|semua|akun)$/i.test(text) || /^Dibatalkan\b/.test(r.text ?? "")) {
      clearTxRows();
    } else if (Array.isArray(r.removedIds)) {
      removeTxRows(r.removedIds as number[]);
    }
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
let histIndex = -1;
let histDraft = "";
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    void send();
    return;
  }
  if (e.key === "ArrowUp" && recentCommands.length > 0) {
    e.preventDefault();
    if (histIndex === -1) histDraft = input.value;
    histIndex = Math.min(histIndex + 1, recentCommands.length - 1);
    input.value = recentCommands[histIndex] ?? "";
    updateSuggest();
    return;
  }
  if (e.key === "ArrowDown" && histIndex !== -1) {
    e.preventDefault();
    histIndex -= 1;
    input.value = histIndex < 0 ? histDraft : recentCommands[histIndex] ?? "";
    updateSuggest();
  }
});
input.addEventListener("input", () => {
  histIndex = -1;
  updateSuggest();
});

// Toolbar: backup, restore, undo. (AI/wallpaper/backup terenkripsi via ℹ.)
document.getElementById("export")!.onclick = async () => {
  const r = await call({ type: "export" });
  saveFile(`stacker-backup-${todayStr()}.json`, r.json as string);
  lastBackupAt = todayStr();
  void call({ type: "markbackup", tanggal: lastBackupAt });
};

document.getElementById("exportEnc")!.onclick = () => {
  askPass("", "Kata sandi minimal 8 karakter untuk mengenkripsi backup.", "encrypt");
};

document.getElementById("undo")!.onclick = () => {
  input.value = "undo";
  void send();
};

document.getElementById("import")!.onclick = () => {
  document.getElementById("importFile")!.click();
};

document.getElementById("importFile")!.addEventListener("change", async (e) => {
  const inputEl = e.target as HTMLInputElement;
  const file = inputEl.files?.[0];
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) {
    addBubble("File backup terlalu besar (maks 25 MB).", "bot");
    inputEl.value = "";
    return;
  }
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

document.getElementById("openAI")!.onclick = async () => {
  for (const m of INFO_PANES) m.hidden = true;
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

const hideSaldoEl = document.getElementById("hideSaldo") as HTMLInputElement;
const soundNoticeEl = document.getElementById("soundNotice") as HTMLInputElement;
const hapticNoticeEl = document.getElementById("hapticNotice") as HTMLInputElement;

document.getElementById("openWall")!.onclick = () => {
  for (const m of INFO_PANES) m.hidden = true;
  currentWall = readWall();
  syncWallControls(currentWall);
  hideSaldoEl.checked = hideSaldo;
  soundNoticeEl.checked = soundOn;
  hapticNoticeEl.checked = hapticOn;
  wallModal.hidden = false;
};

hideSaldoEl.onchange = () => {
  hideSaldo = hideSaldoEl.checked;
  saldoRevealed = false;
  try {
    localStorage.setItem(HIDE_SALDO_KEY, hideSaldo ? "1" : "0");
  } catch {
    // localStorage bisa diblokir; abaikan.
  }
  renderSaldo();
  showToast(hideSaldo ? "Saldo disamarkan di header." : "Saldo ditampilkan di header.");
};

soundNoticeEl.onchange = () => {
  soundOn = soundNoticeEl.checked;
  try {
    localStorage.setItem(SOUND_KEY, soundOn ? "1" : "0");
  } catch {
    // abaikan
  }
  if (soundOn) {
    unlockAudio();
    playTing();
  }
  showToast(soundOn ? 'Bunyi pengingat aktif ("ting").' : "Bunyi pengingat dimatikan.");
};

hapticNoticeEl.onchange = () => {
  hapticOn = hapticNoticeEl.checked;
  try {
    localStorage.setItem(HAPTIC_KEY, hapticOn ? "1" : "0");
  } catch {
    // abaikan
  }
  if (hapticOn) haptic(30);
  showToast(hapticOn ? "Getar aktif." : "Getar dimatikan.");
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
const LOCK_KEY = "stacker-lock";
function readLockState(): { fails: number; until: number } {
  try {
    const j = JSON.parse(localStorage.getItem(LOCK_KEY) ?? "null") as {
      fails?: number;
      until?: number;
    } | null;
    if (j && typeof j.until === "number" && j.until > Date.now()) {
      return { fails: Math.max(0, Number(j.fails) || 0), until: j.until };
    }
  } catch {
    // localStorage diblokir / data rusak -> mulai bersih.
  }
  return { fails: 0, until: 0 };
}
function saveLockState(): void {
  try {
    if (lockFails > 0 || lockCooldownUntil > Date.now()) {
      localStorage.setItem(LOCK_KEY, JSON.stringify({ fails: lockFails, until: lockCooldownUntil }));
    } else {
      localStorage.removeItem(LOCK_KEY);
    }
  } catch {
    // abaikan
  }
}
const savedLock = readLockState();
let lockFails = savedLock.fails;
let lockCooldownUntil = savedLock.until;
let idleTimer: number | undefined;
const IDLE_KEY = "stacker-idle";
const IDLE_OPTIONS: { ms: number; label: string }[] = [
  { ms: 30_000, label: "30 detik" },
  { ms: 60_000, label: "1 menit" },
  { ms: 2 * 60_000, label: "2 menit" },
  { ms: 5 * 60_000, label: "5 menit" },
  { ms: 15 * 60_000, label: "15 menit" },
  { ms: 0, label: "Nonaktif" },
];
function readIdleMs(): number {
  try {
    const n = Number(localStorage.getItem(IDLE_KEY));
    return IDLE_OPTIONS.some((o) => o.ms === n) ? n : 2 * 60 * 1000;
  } catch {
    return 2 * 60 * 1000;
  }
}
let idleMs = readIdleMs();

const lockEl = document.getElementById("lock")!;
const lockDots = document.getElementById("lockDots")!;
const lockPad = document.getElementById("lockPad")!;
const lockMsg = document.getElementById("lockMsg")!;
const pinModal = document.getElementById("pinModal")!;
const pinTitle = document.getElementById("pinTitle")!;
const pinHint = document.getElementById("pinHint")!;
const pinDots = document.getElementById("pinDots")!;
const pinPad = document.getElementById("pinPad")!;
const pinMsg = document.getElementById("pinMsg")!;

let pinBuffer = "";
let pinModalBuffer = "";
let pinFlow: {
  mode: PinMode;
  step: number;
  oldPin?: string;
  newPin?: string;
} | null = null;
// Resolver untuk mode "verify" (dipakai sebelum hapus semua data).
let pinVerifyResolve: ((ok: boolean) => void) | null = null;
type PinMode = "set" | "change" | "delete" | "verify";

function renderDots(el: HTMLElement, value: string): void {
  el.replaceChildren();
  const n = Math.max(4, value.length);
  for (let i = 0; i < n; i++) {
    const d = document.createElement("span");
    d.className = "pin-dot" + (i < value.length ? " on" : "");
    el.appendChild(d);
  }
  el.setAttribute("aria-label", `${value.length} digit dimasukkan`);
}

function buildKeypad(el: HTMLElement, onKey: (k: string) => void): void {
  el.replaceChildren();
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "ok"];
  for (const k of keys) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.key = k;
    b.textContent = k === "back" ? "⌫" : k === "ok" ? "✓" : k;
    b.setAttribute(
      "aria-label",
      k === "back" ? "Hapus digit" : k === "ok" ? "Konfirmasi PIN" : `Angka ${k}`
    );
    b.onclick = () => onKey(k);
    el.appendChild(b);
  }
}

function lockKey(k: string): void {
  if (lockEl.hidden) return;
  if (Date.now() < lockCooldownUntil) {
    lockMsg.textContent = `Tunggu ${Math.ceil((lockCooldownUntil - Date.now()) / 1000)} detik.`;
    return;
  }
  if (k === "back") pinBuffer = pinBuffer.slice(0, -1);
  else if (k === "ok") return void tryUnlock();
  else if (/^\d$/.test(k) && pinBuffer.length < 8) pinBuffer += k;
  renderDots(lockDots, pinBuffer);
}

function pinModalKey(k: string): void {
  if (pinModal.hidden) return;
  if (k === "back") pinModalBuffer = pinModalBuffer.slice(0, -1);
  else if (k === "ok") return void submitPinModal();
  else if (/^\d$/.test(k) && pinModalBuffer.length < 8) pinModalBuffer += k;
  renderDots(pinDots, pinModalBuffer);
}

function pinHintText(flow: { mode: PinMode; step: number }): string {
  if (flow.mode === "set") {
    return flow.step === 0 ? "Masukkan PIN baru (4-8 digit)." : "Ulangi PIN baru.";
  }
  if (flow.mode === "change") {
    if (flow.step === 0) return "Masukkan PIN lama.";
    return flow.step === 1 ? "Masukkan PIN baru (4-8 digit)." : "Ulangi PIN baru.";
  }
  if (flow.mode === "verify") return "Masukkan PIN untuk menghapus semua data.";
  return "Masukkan PIN lama untuk menghapus kunci.";
}

function renderPinStep(): void {
  const flow = pinFlow;
  if (!flow) return;
  pinTitle.textContent =
    flow.mode === "set"
      ? "Atur PIN"
      : flow.mode === "change"
        ? "Ubah PIN"
        : flow.mode === "verify"
          ? "Hapus semua data"
          : "Hapus PIN";
  pinHint.textContent = pinHintText(flow);
  renderDots(pinDots, pinModalBuffer);
}

function openPinModal(mode: PinMode): void {
  pinFlow = { mode, step: 0 };
  pinModalBuffer = "";
  pinMsg.textContent = "";
  for (const m of INFO_PANES) m.hidden = true;
  pinModal.hidden = false;
  renderPinStep();
}

function closePinModal(backToSec: boolean): void {
  pinFlow = null;
  pinModalBuffer = "";
  pinModal.hidden = true;
  pinMsg.textContent = "";
  if (pinVerifyResolve) {
    const resolve = pinVerifyResolve;
    pinVerifyResolve = null;
    resolve(false);
  }
  if (backToSec) {
    secModal.hidden = false;
    renderInfo();
  }
}

async function submitPinModal(): Promise<void> {
  const flow = pinFlow;
  if (!flow) return;
  if (pinModalBuffer.length < 4) {
    pinMsg.textContent = "PIN harus 4-8 digit.";
    return;
  }
  const pin = pinModalBuffer;

  if (flow.mode === "verify") {
    const r = await call({ type: "pincheck", pin });
    if (!r.ok) {
      pinMsg.textContent = "PIN salah.";
      pinModalBuffer = "";
      renderDots(pinDots, "");
      return;
    }
    const resolve = pinVerifyResolve;
    pinVerifyResolve = null;
    closePinModal(false);
    resolve?.(true);
    return;
  }

  if (flow.mode === "delete") {
    const r = await call({ type: "pindel", pin });
    if (!r.ok) {
      pinMsg.textContent = String(r.error ?? "PIN salah.");
      pinModalBuffer = "";
      renderDots(pinDots, "");
      return;
    }
    pinSet = false;
    lockFails = 0;
    lockCooldownUntil = 0;
    saveLockState();
    closePinModal(true);
    showToast("PIN dihapus. App tak lagi terkunci.");
    renderInfo();
    return;
  }

  if (flow.mode === "set") {
    if (flow.step === 0) {
      flow.newPin = pin;
      flow.step = 1;
      pinModalBuffer = "";
      pinMsg.textContent = "";
      renderPinStep();
      return;
    }
    if (pin !== flow.newPin) {
      flow.step = 0;
      flow.newPin = undefined;
      pinModalBuffer = "";
      renderPinStep();
      pinMsg.textContent = "PIN tidak sama. Ulangi.";
      return;
    }
    const r = await call({ type: "pinset", pin });
    if (!r.ok) {
      pinMsg.textContent = String(r.error ?? "Gagal menyimpan PIN.");
      pinModalBuffer = "";
      renderDots(pinDots, "");
      return;
    }
    pinSet = true;
    lockFails = 0;
    lockCooldownUntil = 0;
    saveLockState();
    closePinModal(false);
    addBubble("PIN aktif. App mengunci sekarang.", "bot");
    renderInfo();
    lockNow();
    return;
  }

  // change
  if (flow.step === 0) {
    const r = await call({ type: "pincheck", pin });
    if (!r.ok) {
      pinMsg.textContent = "PIN lama salah.";
      pinModalBuffer = "";
      renderDots(pinDots, "");
      return;
    }
    flow.oldPin = pin;
    flow.step = 1;
    pinModalBuffer = "";
    pinMsg.textContent = "";
    renderPinStep();
    return;
  }
  if (flow.step === 1) {
    flow.newPin = pin;
    flow.step = 2;
    pinModalBuffer = "";
    pinMsg.textContent = "";
    renderPinStep();
    return;
  }
  if (pin !== flow.newPin) {
    flow.step = 1;
    flow.newPin = undefined;
    pinModalBuffer = "";
    renderPinStep();
    pinMsg.textContent = "PIN baru tidak sama. Ulangi.";
    return;
  }
  const r = await call({ type: "pinchange", oldPin: flow.oldPin, newPin: pin });
  if (!r.ok) {
    pinMsg.textContent = String(r.error ?? "Gagal mengganti PIN.");
    pinModalBuffer = "";
    renderDots(pinDots, "");
    return;
  }
  pinSet = true;
  lockFails = 0;
  lockCooldownUntil = 0;
  saveLockState();
  closePinModal(false);
  addBubble("PIN diganti. App mengunci sekarang.", "bot");
  renderInfo();
  lockNow();
}

function lockNow(): void {
  if (!pinSet) return;
  if (idleTimer) window.clearTimeout(idleTimer);
  // Jangan biarkan modal (AI/import/PIN) tetap terbuka di belakang lock.
  document.querySelectorAll<HTMLElement>(".modal").forEach((m) => (m.hidden = true));
  document
    .querySelectorAll<HTMLInputElement>('.modal input[type="password"]')
    .forEach((i) => (i.value = ""));
  pendingImport = null;
  pendingAction = "import";
  pinFlow = null;
  pinModalBuffer = "";
  pinBuffer = "";
  renderDots(lockDots, "");
  lockEl.hidden = false;
  lockMsg.textContent = "";
}

function unlockUi(): void {
  lockEl.hidden = true;
  pinBuffer = "";
  renderDots(lockDots, "");
  lockMsg.textContent = "";
  touchIdle();
  void refresh().then((s) => {
    showStartupHint(s);
    handleSharedText();
    runLaunchAction();
    void autoBackup();
  });
}

function touchIdle(): void {
  if (idleTimer) window.clearTimeout(idleTimer);
  if (idleMs > 0 && lockEl.hidden && pinSet) idleTimer = window.setTimeout(lockNow, idleMs);
}

async function tryUnlock(): Promise<void> {
  const now = Date.now();
  if (now < lockCooldownUntil) {
    lockMsg.textContent = `Tunggu ${Math.ceil((lockCooldownUntil - now) / 1000)} detik.`;
    return;
  }
  if (pinBuffer.length < 4) {
    lockMsg.textContent = "PIN harus 4-8 digit.";
    return;
  }
  const pin = pinBuffer;
  pinBuffer = "";
  renderDots(lockDots, "");
  const r = await call({ type: "pincheck", pin });
  if (r.ok) {
    if (!r.pinSet) pinSet = false;
    lockFails = 0;
    lockCooldownUntil = 0;
    saveLockState();
    unlockUi();
    return;
  }
  lockFails++;
  if (lockFails >= 5) {
    lockFails = 0;
    lockCooldownUntil = Date.now() + 30_000;
    lockMsg.textContent = "Terlalu banyak salah. Tunggu 30 detik.";
  } else {
    lockMsg.textContent = `PIN salah (${lockFails}/5).`;
  }
  saveLockState();
}

buildKeypad(lockPad, lockKey);
buildKeypad(pinPad, pinModalKey);
renderDots(lockDots, "");
renderDots(pinDots, "");

document.getElementById("pinCancel")!.onclick = () => closePinModal(true);

window.addEventListener("keydown", (e) => {
  const modalOpen = !pinModal.hidden;
  if (lockEl.hidden && !modalOpen) return;
  const handler = lockEl.hidden ? pinModalKey : lockKey;
  let handled = true;
  if (e.key === "Backspace") handler("back");
  else if (e.key === "Enter") handler("ok");
  else if (/^\d$/.test(e.key)) handler(e.key);
  else handled = false;
  if (handled) e.preventDefault();
});
for (const ev of ["pointerdown", "keydown", "touchstart"] as const) {
  window.addEventListener(ev, touchIdle, { passive: true });
}
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    if (idleTimer) window.clearTimeout(idleTimer);
    saldoRevealed = false;
    renderSaldo();
    return;
  }
  if (pinSet && idleMs > 0 && hiddenAt > 0 && Date.now() - hiddenAt >= idleMs) {
    hiddenAt = 0;
    lockNow();
    return;
  }
  hiddenAt = 0;
  if (lockEl.hidden && ready) {
    touchIdle();
    void refresh();
  }
});
// App lama terbuka tetap mengejar transaksi berulang/notice.
window.setInterval(() => {
  if (!document.hidden && lockEl.hidden && ready) void refresh();
}, 5 * 60 * 1000);

// ---------- Backup terenkripsi: minta kata sandi ----------
const passModal = document.getElementById("passModal")!;
const passInput = document.getElementById("passInput") as HTMLInputElement;
const passMsg = document.getElementById("passMsg")!;
let pendingImport: string | null = null;
let pendingAction: "import" | "encrypt" = "import";

function askPass(text: string, message?: string, action: "import" | "encrypt" = "import"): void {
  pendingImport = text;
  pendingAction = action;
  passInput.value = "";
  passMsg.textContent = message ?? "";
  passMsg.hidden = !message;
  for (const m of INFO_PANES) m.hidden = true;
  passModal.hidden = false;
  passInput.focus();
}

function describeBackup(text: string): string {
  const raw = text.trim();
  if (/^\s*\{\s*"format"\s*:\s*"stacker-enc"/.test(raw)) {
    return "File terenkripsi — isi baru diketahui setelah kata sandi benar.";
  }
  try {
    const j = JSON.parse(raw) as {
      tables?: { transactions?: unknown[]; accounts?: unknown[] };
    };
    if (!j.tables) return "File tidak berisi tabel backup yang dikenali.";
    const tx = j.tables.transactions?.length ?? 0;
    const acc = j.tables.accounts?.length ?? 0;
    return `File berisi ${tx} transaksi & ${acc} akun. Saat ini: ${txCount} transaksi.`;
  } catch {
    return "File bukan JSON backup yang valid.";
  }
}

async function doEncryptedExport(pass: string): Promise<void> {
  if (pass.length < 8) {
    askPass("", "Kata sandi minimal 8 karakter.", "encrypt");
    return;
  }
  const r = await call({ type: "backupenc", pass });
  if (!r.ok) {
    askPass("", r.error ?? "Gagal membuat backup.", "encrypt");
    return;
  }
  addBubble(
    "Backup terenkripsi siap diunduh. Simpan kata sandinya.",
    "bot",
    undefined,
    r.file as { name: string; content: string }
  );
}

async function doImport(text: string, pass?: string): Promise<void> {
  if (
    pass === undefined &&
    !window.confirm(
      `Restore akan MENGGANTI semua data di perangkat ini.\n\n${describeBackup(text)}\n\nData lama bisa dikembalikan dengan \`undo\`. Lanjut?`
    )
  ) {
    return;
  }
  const r = await call({ type: "import", json: text, pass });
  if (r.needPass) {
    askPass(text);
    return;
  }
  if (pass !== undefined && !r.ok && /kata sandi salah|file rusak/i.test(r.error ?? "")) {
    askPass(text, r.error ?? "Kata sandi salah. Coba lagi.");
    return;
  }
  addBubble(
    r.ok
      ? "Backup dimuat. Data sebelum restore bisa dikembalikan dengan ketik `undo`."
      : "Gagal impor: " + (r.error ?? "format salah"),
    "bot"
  );
  void refresh();
}

document.getElementById("passCancel")!.onclick = () => {
  pendingImport = null;
  pendingAction = "import";
  passModal.hidden = true;
};

document.getElementById("passOk")!.onclick = () => {
  const text = pendingImport;
  const action = pendingAction;
  pendingImport = null;
  pendingAction = "import";
  passModal.hidden = true;
  if (action === "encrypt") void doEncryptedExport(passInput.value);
  else if (text) void doImport(text, passInput.value);
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
let folderNeedsPermission = false;
let backupPermWarned = false;
let storageText = "";
let bundleHash = "";
let aiHosts = "tidak ada (AI mati)";

const todayStr = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};
const timeStr = (): string => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(
    2,
    "0"
  )}${String(d.getSeconds()).padStart(2, "0")}`;
};

const RETAIN_KEY = "stacker-retain";
function readRetain(): number {
  const n = Number(localStorage.getItem(RETAIN_KEY));
  return [10, 30, 60, 100].includes(n) ? n : 30;
}
const retainSel = document.getElementById("retain") as HTMLSelectElement;
retainSel.value = String(readRetain());
retainSel.onchange = () => {
  try {
    localStorage.setItem(RETAIN_KEY, retainSel.value);
  } catch {
    // abaikan
  }
  showToast(`Retensi backup: ${retainSel.value} file terbaru.`);
};

const infoModal = document.getElementById("infoModal")!;
const infoSummary = document.getElementById("infoSummary")!;
const secModal = document.getElementById("secModal")!;
const secLines = document.getElementById("secLines")!;
const storeModal = document.getElementById("storeModal")!;
const storeLines = document.getElementById("storeLines")!;
const aboutModal = document.getElementById("aboutModal")!;
const aboutLines = document.getElementById("aboutLines")!;
const resetModal = document.getElementById("resetModal")!;
const katModal = document.getElementById("katModal")!;
const catListEl = document.getElementById("catList")!;
const catNameEl = document.getElementById("catName") as HTMLInputElement;
const catTipeEl = document.getElementById("catTipe") as HTMLSelectElement;
const catKwEl = document.getElementById("catKw") as HTMLInputElement;
const catMsgEl = document.getElementById("catMsg")!;
const budgetModal = document.getElementById("budgetModal")!;
const budgetListEl = document.getElementById("budgetList")!;
const budgetCatEl = document.getElementById("budgetCat") as HTMLSelectElement;
const budgetJumlahEl = document.getElementById("budgetJumlah") as HTMLInputElement;
const budgetPeriodeEl = document.getElementById("budgetPeriode") as HTMLSelectElement;
const budgetRolloverEl = document.getElementById("budgetRollover") as HTMLInputElement;
const budgetMsgEl = document.getElementById("budgetMsg")!;
const dashModal = document.getElementById("dashModal")!;
const dashBodyEl = document.getElementById("dashBody")!;
const accModal = document.getElementById("accModal")!;
const accListEl = document.getElementById("accList")!;
const accNameEl = document.getElementById("accName") as HTMLInputElement;
const accTipeEl = document.getElementById("accTipe") as HTMLSelectElement;
const accSaldoEl = document.getElementById("accSaldo") as HTMLInputElement;
const accMsgEl = document.getElementById("accMsg")!;
const INFO_PANES = [
  infoModal,
  secModal,
  storeModal,
  aboutModal,
  resetModal,
  katModal,
  budgetModal,
  dashModal,
  accModal,
];
// Semantik dialog + tutup dengan Esc.
for (const m of document.querySelectorAll<HTMLElement>(".modal")) {
  m.setAttribute("role", "dialog");
  m.setAttribute("aria-modal", "true");
}
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const open = Array.from(document.querySelectorAll<HTMLElement>(".modal")).filter((m) => !m.hidden);
  const top = open[open.length - 1];
  if (!top) return;
  if (top.id === "pinModal") closePinModal(true);
  else top.hidden = true;
});
const pickDirBtn = document.getElementById("pickDir") as HTMLButtonElement;
const backupNowBtn = document.getElementById("backupNow") as HTMLButtonElement;
const clearDirBtn = document.getElementById("clearDir") as HTMLButtonElement;
const pinSetBtn = document.getElementById("pinSetBtn") as HTMLButtonElement;
const pinChangeBtn = document.getElementById("pinChangeBtn") as HTMLButtonElement;
const pinDeleteBtn = document.getElementById("pinDeleteBtn") as HTMLButtonElement;
const wipeDataBtn = document.getElementById("wipeData") as HTMLButtonElement;
const idleRow = document.getElementById("idleRow")!;
const idleSel = document.getElementById("idleSel") as HTMLSelectElement;

function renderPinButtons(): void {
  pinSetBtn.hidden = pinSet;
  pinChangeBtn.hidden = !pinSet;
  pinDeleteBtn.hidden = !pinSet;
  idleRow.hidden = !pinSet;
  idleSel.value = String(idleMs);
}
pinSetBtn.onclick = () => openPinModal("set");
pinChangeBtn.onclick = () => openPinModal("change");
pinDeleteBtn.onclick = () => openPinModal("delete");
idleSel.onchange = () => {
  idleMs = IDLE_OPTIONS.some((o) => o.ms === Number(idleSel.value)) ? Number(idleSel.value) : 2 * 60 * 1000;
  try {
    localStorage.setItem(IDLE_KEY, String(idleMs));
  } catch {
    // localStorage bisa diblokir; abaikan.
  }
  touchIdle();
  const label = IDLE_OPTIONS.find((o) => o.ms === idleMs)?.label ?? "";
  showToast(idleMs === 0 ? "Kunci otomatis dimatikan." : `Kunci otomatis: ${label} tanpa aktivitas.`);
};

function verifyPinForWipe(): Promise<boolean> {
  return new Promise((resolve) => {
    pinVerifyResolve = resolve;
    openPinModal("verify");
  });
}

async function wipeAllData(): Promise<void> {
  try {
    for (const m of INFO_PANES) m.hidden = true;
    const r = await call({ type: "wipe" });
    if (!r.ok) throw new Error(String(r.error ?? "gagal menghapus database"));
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if (navigator.serviceWorker?.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("stacker-fs");
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
    for (const k of [
      "stacker-wallpaper",
      "stacker-lock",
      "stacker-retain",
      "stacker-idle",
      "stacker-hide-saldo",
      "stacker-sound",
      "stacker-haptic",
      "stacker-first-use",
      "stacker-cmd-history",
    ]) {
      try {
        localStorage.removeItem(k);
      } catch {
        // localStorage bisa diblokir; abaikan.
      }
    }
  } catch (e) {
    addBubble("Gagal menghapus data: " + (e as Error).message, "bot");
    return;
  }
  location.reload();
}

wipeDataBtn.onclick = async () => {
  if (!ready) return;
  const sure = window.confirm(
    "Hapus SEMUA data di perangkat ini?\n\n" +
      "Meliputi transaksi, akun, kategori, anggaran, utang, pengaturan, PIN, " +
      "cache, dan izin folder auto-backup. Tidak bisa dibatalkan.\n\n" +
      "Disarankan backup dulu lewat tombol ⬇ Backup."
  );
  if (!sure) return;
  if (pinSet && !(await verifyPinForWipe())) return;
  if (
    !window.confirm(
      "Konfirmasi terakhir: semua data lokal akan dihapus permanen. " +
        "Setelah ini kamu bisa hapus ikon dari home screen untuk uninstall total. Lanjut?"
    )
  ) {
    return;
  }
  await wipeAllData();
};

async function nowReady(): Promise<void> {
  // Migrasi tanggal pasang lama (localStorage) → DB (sekali). Bila belum ada,
  // isi dengan waktu sekarang. Worker hanya menyimpan bila belum ada.
  const legacy = legacyFirstUse();
  await call({ type: "setfirstuse", at: legacy || new Date().toISOString() });
  if (legacy) {
    try {
      localStorage.removeItem(LEGACY_FIRST_USE_KEY);
    } catch {
      // abaikan
    }
  }
  const s = await refresh();
  if (s.pinSet) {
    lockNow();
  } else {
    showStartupHint(s);
    handleSharedText();
    runLaunchAction();
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
  if (!(await folderPermission(folder, false))) {
    folderNeedsPermission = true;
    if (!backupPermWarned) {
      backupPermWarned = true;
      addBubble(
        "Auto-backup butuh izin folder lagi. Buka ℹ → Backup & penyimpanan → Pilih folder sekali lagi.",
        "bot"
      );
    }
    return;
  }
  folderNeedsPermission = false;
  try {
    const dir = folder;
    const r = await call({ type: "export" });
    const name = force
      ? `stacker-backup-${todayStr()}-${timeStr()}.json`
      : `stacker-auto-${todayStr()}.json`;
    await writeBackupFile(dir, name, r.json as string);
    void pruneBackups(dir, readRetain()).catch(() => 0); // rotasi sesuai retensi
    lastBackupAt = todayStr();
    await call({ type: "markbackup", tanggal: lastBackupAt });
    const msg = `${force ? "Backup disimpan" : "Auto-backup disimpan"}: ${name} (folder ${dir.name}).`;
    addBubble(msg, "bot");
    showToast(msg);
    renderInfo();
  } catch (e) {
    addBubble("Auto-backup gagal: " + (e as Error).message, "bot");
    showToast("Auto-backup gagal: " + (e as Error).message);
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
  infoSummary.textContent =
    `v${appVersion || "-"} · ${txCount} transaksi · backup: ${lastBackupAt ?? "belum"}`;
  secLines.textContent = pinSet
    ? "PIN: aktif."
    : "PIN: nonaktif. PIN hanya mengunci tampilan — data tetap tersimpan di perangkat.";
  storeLines.textContent = [
    `Backup terakhir: ${lastBackupAt ?? "belum pernah"}`,
    `Auto-backup: ${
      folder
        ? folder.name + (folderNeedsPermission ? " (izin perlu diperbarui)" : "")
        : "nonaktif"
    }`,
    `Retensi backup: ${readRetain()} file terbaru`,
    storageText ? "\n" + storageText : "",
  ]
    .filter((x) => x !== "")
    .join("\n");
  aboutLines.textContent = [
    `Versi: v${appVersion || "-"}`,
    `Build: ${__BUILD_SHA__ || "lokal"} (${__BUILD_TIME__.slice(0, 10)})`,
    `Hash bundle SHA-256: ${bundleHash || "menghitung…"}`,
    `Host AI: ${aiHosts}`,
    `Data: lokal di perangkat (OPFS), tanpa server`,
    `Dipakai sejak: ${firstUseAt ? `${fmtDate(firstUseAt)} (${daysSince(firstUseAt)} hari)` : "-"}`,
    `Mode: ${isStandalone ? "terinstall (standalone)" : "browser"}`,
  ].join("\n");
  pickDirBtn.disabled = !supportsFolderBackup();
  backupNowBtn.disabled = !folder;
  clearDirBtn.disabled = !folder;
  renderPinButtons();
}

function showInfoPane(pane: HTMLElement): void {
  for (const m of INFO_PANES) m.hidden = true;
  pane.hidden = false;
  renderInfo();
}

document.getElementById("info")!.onclick = async () => {
  await Promise.all([refreshStorageText(), refresh(), refreshAiHosts()]);
  showInfoPane(infoModal);
  if (!bundleHash) {
    bundleHash = await bundleSha256();
    renderInfo();
  }
};

document.getElementById("infoClose")!.onclick = () => {
  infoModal.hidden = true;
};
document.getElementById("openSecurity")!.onclick = () => showInfoPane(secModal);
document.getElementById("openStorage")!.onclick = () => showInfoPane(storeModal);
document.getElementById("openAbout")!.onclick = () => showInfoPane(aboutModal);
document.getElementById("openReset")!.onclick = () => {
  showInfoPane(resetModal);
  const out = document.getElementById("checkResult");
  if (out) out.hidden = true;
};
document.getElementById("secBack")!.onclick = () => showInfoPane(infoModal);
document.getElementById("storeBack")!.onclick = () => showInfoPane(infoModal);
document.getElementById("aboutBack")!.onclick = () => showInfoPane(infoModal);
document.getElementById("resetBack")!.onclick = () => showInfoPane(infoModal);

// Reset data (jalur utama lewat menu; chat `reset ...` tetap ada sebagai pintasan).
async function runReset(kind: "transaksi" | "kategori" | "akun" | "semua"): Promise<void> {
  if (!ready) return;
  if (kind === "semua") {
    if (pinSet) {
      if (!(await verifyPinForWipe())) return;
    } else {
      const typed = window.prompt("Ketik RESET untuk konfirmasi reset total:");
      if ((typed ?? "").trim().toUpperCase() !== "RESET") return;
    }
  } else if (
    !window.confirm(
      `Reset ${kind}? Backup JSON diunduh otomatis.` +
        (kind === "kategori" ? " Transaksi lama tetap tersimpan." : "")
    )
  ) {
    return;
  }
  for (const m of INFO_PANES) m.hidden = true;
  addBubble(`reset ${kind}`, "me");
  busyEl.hidden = false;
  const r = await call({ type: "chat", text: `reset ${kind}` });
  busyEl.hidden = true;
  if (!r.ok) {
    addBubble("Error: " + (r.error ?? "tidak diketahui"), "bot");
    return;
  }
  addBubble(r.text ?? "", "bot");
  if (r.file) {
    const f = r.file as { name: string; content: string };
    saveFile(f.name, f.content);
  }
  if (kind !== "kategori") clearTxRows();
  void refresh();
}

document.getElementById("resetTxBtn")!.onclick = () => void runReset("transaksi");
document.getElementById("resetCatBtn")!.onclick = () => void runReset("kategori");
document.getElementById("resetAccBtn")!.onclick = () => void runReset("akun");
document.getElementById("resetAllBtn")!.onclick = () => void runReset("semua");
document.getElementById("checkData")!.onclick = async () => {
  const r = await call({ type: "checkdata" });
  const issues = (Array.isArray(r.issues) ? r.issues : []) as string[];
  const out = document.getElementById("checkResult")!;
  out.hidden = false;
  if (!issues.length) {
    out.textContent = "Periksa data selesai: tidak ada masalah ✓";
    showToast("Integritas data: sehat ✓");
  } else {
    out.textContent = `Ditemukan ${issues.length} masalah:\n- ${issues.join("\n- ")}`;
    showToast(`Periksa data: ${issues.length} masalah (lihat detail di sini)`);
  }
};

// ---------- Manajemen kategori (UI) ----------
interface CatRow {
  id: number;
  nama: string;
  tipe: string;
  keywords: string[];
}
let catNames = new Set<string>();

function runCmd(text: string): Promise<Reply & Record<string, unknown>> {
  return call({ type: "chat", text });
}

async function refreshCatList(): Promise<void> {
  const r = await call({ type: "listcat" });
  const cats = (Array.isArray(r.categories) ? r.categories : []) as CatRow[];
  catNames = new Set(cats.map((c) => c.nama.toLowerCase()));
  catListEl.replaceChildren();
  if (!cats.length) {
    const empty = document.createElement("p");
    empty.className = "info-note";
    empty.textContent = "Belum ada kategori.";
    catListEl.appendChild(empty);
    return;
  }
  for (const c of cats) {
    const item = document.createElement("div");
    item.className = "cat-item";
    const head = document.createElement("div");
    head.className = "cat-head";
    const nm = document.createElement("span");
    nm.className = "cat-name";
    nm.textContent = c.nama;
    const badge = document.createElement("span");
    badge.className = "cat-badge";
    badge.textContent = c.tipe;
    head.append(nm, badge);
    const kw = document.createElement("div");
    kw.className = "cat-kw";
    kw.textContent = c.keywords.length ? c.keywords.join(", ") : "(tanpa kata kunci)";
    const actions = document.createElement("div");
    actions.className = "cat-actions";
    const edit = document.createElement("button");
    edit.textContent = "Ubah";
    edit.onclick = () => {
      catNameEl.value = c.nama;
      catTipeEl.value = c.tipe === "masuk" || c.tipe === "keduanya" ? c.tipe : "keluar";
      catKwEl.value = c.keywords.join(", ");
      catMsgEl.hidden = true;
      catNameEl.focus();
    };
    const del = document.createElement("button");
    del.textContent = "Hapus";
    del.onclick = async () => {
      if (!window.confirm(`Hapus kategori "${c.nama}"? Anggarannya ikut terhapus.`)) return;
      const res = await runCmd(`kategori hapus ${c.nama}`);
      showToast(res.text || `Kategori ${c.nama} dihapus.`);
      await refreshCatList();
    };
    actions.append(edit, del);
    item.append(head, kw, actions);
    catListEl.appendChild(item);
  }
}

document.getElementById("openCat")!.onclick = async () => {
  showInfoPane(katModal);
  catMsgEl.hidden = true;
  await refreshCatList();
};
document.getElementById("catBack")!.onclick = () => showInfoPane(infoModal);
document.getElementById("catReset")!.onclick = () => {
  catNameEl.value = "";
  catKwEl.value = "";
  catMsgEl.hidden = true;
};
document.getElementById("catSave")!.onclick = async () => {
  const nama = catNameEl.value.trim();
  const tipe = catTipeEl.value;
  const kws = catKwEl.value.split(",").map((s) => s.trim()).filter(Boolean);
  if (!nama) {
    catMsgEl.hidden = false;
    catMsgEl.textContent = "Nama kategori wajib diisi.";
    return;
  }
  const list = kws.length ? kws.join(", ") : nama.toLowerCase();
  if (catNames.has(nama.toLowerCase())) {
    const r1 = await runCmd(`kategori ubah ${nama} | ${list}`);
    await runCmd(`kategori sisi ${nama} ${tipe}`);
    showToast(r1.text || `Kategori ${nama} diperbarui (${tipe}).`);
  } else {
    const r = await runCmd(`kategori tambah ${tipe} ${nama} | ${list}`);
    showToast(r.text || `Kategori ${nama} ditambah.`);
  }
  catNameEl.value = "";
  catKwEl.value = "";
  catMsgEl.hidden = true;
  await refreshCatList();
};

// ---------- Manajemen anggaran (UI) ----------
function fmtRp(n: number): string {
  return "Rp" + Math.round(n).toLocaleString("id-ID");
}

async function refreshBudgetCats(): Promise<void> {
  const r = await call({ type: "listcat" });
  const cats = (Array.isArray(r.categories) ? r.categories : []) as CatRow[];
  const prev = budgetCatEl.value;
  budgetCatEl.replaceChildren();
  for (const c of cats) {
    const o = document.createElement("option");
    o.value = c.nama;
    o.textContent = c.nama;
    budgetCatEl.appendChild(o);
  }
  if (prev && cats.some((c) => c.nama === prev)) budgetCatEl.value = prev;
}

async function refreshBudgetList(): Promise<void> {
  const r = await call({ type: "listbudget" });
  const rows = (Array.isArray(r.budgets) ? r.budgets : []) as {
    kategori: string;
    jumlah: number;
    periode: string;
    rollover: boolean;
    spent: number;
    effective: number;
    pct: number;
  }[];
  budgetListEl.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "info-note";
    empty.textContent = "Belum ada anggaran. Isi form di bawah.";
    budgetListEl.appendChild(empty);
    return;
  }
  for (const b of rows) {
    const item = document.createElement("div");
    item.className = "cat-item";
    const head = document.createElement("div");
    head.className = "cat-head";
    const nm = document.createElement("span");
    nm.className = "cat-name";
    nm.textContent = b.kategori;
    const badge = document.createElement("span");
    badge.className = "cat-badge";
    badge.textContent = b.periode + (b.rollover ? " ↻" : "");
    head.append(nm, badge);
    const info = document.createElement("div");
    info.className = "cat-kw";
    const sisa = b.effective - b.spent;
    info.textContent =
      `${fmtRp(b.spent)} / ${fmtRp(b.effective)} (${b.pct}%) · ` +
      (sisa < 0 ? `tembus ${fmtRp(-sisa)}` : `sisa ${fmtRp(sisa)}`);
    const bar = document.createElement("div");
    const cls = b.pct >= 100 ? "over" : b.pct >= 80 ? "warn" : "";
    bar.className = "bar" + (cls ? " " + cls : "");
    const fill = document.createElement("span");
    fill.style.width = Math.min(100, Math.max(0, b.pct)) + "%";
    bar.appendChild(fill);
    const actions = document.createElement("div");
    actions.className = "cat-actions";
    const edit = document.createElement("button");
    edit.textContent = "Ubah";
    edit.onclick = () => {
      budgetCatEl.value = b.kategori;
      budgetJumlahEl.value = String(b.jumlah);
      budgetPeriodeEl.value = b.periode === "mingguan" ? "mingguan" : "bulanan";
      budgetRolloverEl.checked = b.rollover;
      budgetMsgEl.hidden = true;
      budgetJumlahEl.focus();
    };
    const del = document.createElement("button");
    del.textContent = "Hapus";
    del.onclick = async () => {
      if (!window.confirm(`Hapus anggaran "${b.kategori}"?`)) return;
      const res = await runCmd(`anggaran hapus ${b.kategori}`);
      showToast(res.text || `Anggaran ${b.kategori} dihapus.`);
      await refreshBudgetList();
    };
    actions.append(edit, del);
    item.append(head, info, bar, actions);
    budgetListEl.appendChild(item);
  }
}

document.getElementById("openBudget")!.onclick = async () => {
  showInfoPane(budgetModal);
  budgetMsgEl.hidden = true;
  await Promise.all([refreshBudgetCats(), refreshBudgetList()]);
};
document.getElementById("budgetBack")!.onclick = () => showInfoPane(infoModal);
document.getElementById("budgetSave")!.onclick = async () => {
  const kat = budgetCatEl.value;
  const jumlah = budgetJumlahEl.value.trim();
  if (!kat || !jumlah) {
    budgetMsgEl.hidden = false;
    budgetMsgEl.textContent = "Pilih kategori dan isi batas anggaran.";
    return;
  }
  const periodArg = budgetPeriodeEl.value === "mingguan" ? " mingguan" : "";
  const r = await runCmd(`anggaran ${kat} ${jumlah}${periodArg}`);
  await runCmd(`anggaran ${budgetRolloverEl.checked ? "rollover" : "no-rollover"} ${kat}`);
  showToast(r.text || `Anggaran ${kat} disimpan.`);
  budgetJumlahEl.value = "";
  budgetMsgEl.hidden = true;
  await refreshBudgetList();
};

// ---------- Dashboard / Ringkasan (UI) ----------
async function renderDash(): Promise<void> {
  const r = await call({ type: "dashboard" });
  dashBodyEl.replaceChildren();
  const card = (k: string, v: string, wide = false): HTMLElement => {
    const d = document.createElement("div");
    d.className = "dash-card" + (wide ? " wide" : "");
    const kk = document.createElement("div");
    kk.className = "k";
    kk.textContent = k;
    const vv = document.createElement("div");
    vv.className = "v";
    vv.textContent = v;
    d.append(kk, vv);
    return d;
  };
  const net = Number(r.net ?? 0);
  const cards = document.createElement("div");
  cards.className = "dash-cards";
  const saldoCard = card(
    "Saldo total",
    hideSaldo && !saldoRevealed ? "••••" : fmtRp(Number(r.totalSaldo ?? 0)),
    true
  );
  if (hideSaldo) {
    saldoCard.style.cursor = "pointer";
    saldoCard.onclick = () => {
      saldoRevealed = !saldoRevealed;
      renderSaldo();
      void renderDash();
    };
  }
  const today = (r.today ?? {}) as { keluar?: number; masuk?: number; count?: number };
  const todayCount = Number(today.count ?? 0);
  const todayKeluar = Number(today.keluar ?? 0);
  const todayMasuk = Number(today.masuk ?? 0);
  cards.append(
    saldoCard,
    card(`Masuk · ${String(r.label ?? "")}`, fmtRp(Number(r.masuk ?? 0))),
    card("Keluar", fmtRp(Number(r.keluar ?? 0))),
    card("Net", (net < 0 ? "-" : "+") + fmtRp(Math.abs(net)), true),
    card(
      `Hari ini · ${todayCount} transaksi`,
      "-" + fmtRp(todayKeluar) + (todayMasuk > 0 ? ` · +${fmtRp(todayMasuk)}` : ""),
      true
    )
  );
  dashBodyEl.appendChild(cards);

  const top = (Array.isArray(r.top) ? r.top : []) as { kategori: string; total: number }[];
  if (top.length) {
    const t = document.createElement("div");
    t.className = "dash-title";
    t.textContent = "Top pengeluaran";
    const list = document.createElement("div");
    list.className = "dash-list";
    for (const c of top) {
      const row = document.createElement("div");
      row.className = "dr";
      const a = document.createElement("span");
      a.textContent = c.kategori;
      const b = document.createElement("span");
      b.textContent = fmtRp(c.total);
      row.append(a, b);
      list.appendChild(row);
    }
    dashBodyEl.append(t, list);
  }
  if (typeof r.svg === "string" && r.svg) {
    const wrap = document.createElement("div");
    wrap.className = "chart";
    wrap.innerHTML = r.svg;
    dashBodyEl.appendChild(wrap);
  }
  const accounts = (Array.isArray(r.accounts) ? r.accounts : []) as { nama: string; saldo: number }[];
  if (accounts.length) {
    const t = document.createElement("div");
    t.className = "dash-title";
    t.textContent = "Saldo akun";
    const list = document.createElement("div");
    list.className = "dash-list";
    for (const a of accounts) {
      const row = document.createElement("div");
      row.className = "dr";
      const x = document.createElement("span");
      x.textContent = a.nama;
      const y = document.createElement("span");
      y.textContent = fmtRp(a.saldo);
      row.append(x, y);
      list.appendChild(row);
    }
    dashBodyEl.append(t, list);
  }
}

document.getElementById("openDash")!.onclick = async () => {
  showInfoPane(dashModal);
  await renderDash();
};
document.getElementById("dashBack")!.onclick = () => showInfoPane(infoModal);

// ---------- Manajemen akun (UI) ----------
interface AccRow {
  id: number;
  nama: string;
  tipe: string;
  saldo: number;
  rupiah: string;
}
let accNames = new Set<string>();

async function refreshAccList(): Promise<void> {
  const r = await call({ type: "listacc" });
  const accs = (Array.isArray(r.accounts) ? r.accounts : []) as AccRow[];
  accNames = new Set(accs.map((a) => a.nama.toLowerCase()));
  accListEl.replaceChildren();
  if (!accs.length) {
    const empty = document.createElement("p");
    empty.className = "info-note";
    empty.textContent = "Belum ada akun.";
    accListEl.appendChild(empty);
    return;
  }
  for (const a of accs) {
    const item = document.createElement("div");
    item.className = "cat-item";
    const head = document.createElement("div");
    head.className = "cat-head";
    const nm = document.createElement("span");
    nm.className = "cat-name";
    nm.textContent = a.nama;
    const badge = document.createElement("span");
    badge.className = "cat-badge";
    badge.textContent = a.tipe;
    head.append(nm, badge);
    const saldo = document.createElement("div");
    saldo.className = "cat-kw";
    saldo.textContent = "Saldo: " + (a.rupiah ?? fmtRp(a.saldo ?? 0));
    const actions = document.createElement("div");
    actions.className = "cat-actions";
    const ren = document.createElement("button");
    ren.textContent = "Ubah nama";
    ren.onclick = async () => {
      const baru = window.prompt(`Nama baru untuk "${a.nama}":`, a.nama);
      if (baru == null || !baru.trim() || baru.trim() === a.nama) return;
      const res = await runCmd(`akun ubah ${a.nama} jadi ${baru.trim()}`);
      showToast(res.text || `Akun ${a.nama} → ${baru.trim()}.`);
      await refreshAccList();
    };
    const adj = document.createElement("button");
    adj.textContent = "Sesuaikan";
    adj.onclick = async () => {
      const val = window.prompt(`Saldo nyata untuk "${a.nama}" (mis. 100jt):`, "");
      if (val == null || !val.trim()) return;
      const res = await runCmd(`sesuaikan ${a.nama} ${val.trim()}`);
      showToast(res.text || `Saldo ${a.nama} disesuaikan.`);
      await refreshAccList();
    };
    const del = document.createElement("button");
    del.textContent = "Hapus";
    del.onclick = async () => {
      if (!window.confirm(`Hapus akun "${a.nama}"? Transaksinya dipindah ke akun lain.`)) return;
      const res = await runCmd(`akun hapus ${a.nama}`);
      showToast(res.text || `Akun ${a.nama} dihapus.`);
      await refreshAccList();
    };
    actions.append(ren, adj, del);
    item.append(head, saldo, actions);
    accListEl.appendChild(item);
  }
}

document.getElementById("openAcc")!.onclick = async () => {
  showInfoPane(accModal);
  accMsgEl.hidden = true;
  await refreshAccList();
};
document.getElementById("accBack")!.onclick = () => showInfoPane(infoModal);
document.getElementById("accResetForm")!.onclick = () => {
  accNameEl.value = "";
  accSaldoEl.value = "";
  accTipeEl.value = "ewallet";
  accMsgEl.hidden = true;
};
document.getElementById("accSave")!.onclick = async () => {
  const nama = accNameEl.value.trim();
  const tipe = accTipeEl.value;
  const saldo = accSaldoEl.value.trim();
  if (!nama) {
    accMsgEl.hidden = false;
    accMsgEl.textContent = "Nama akun wajib diisi.";
    return;
  }
  if (accNames.has(nama.toLowerCase())) {
    if (!saldo) {
      accMsgEl.hidden = false;
      accMsgEl.textContent = `Akun "${nama}" sudah ada. Isi saldo untuk set saldo awal.`;
      return;
    }
    const res = await runCmd(`saldo awal ${nama} ${saldo}`);
    showToast(res.text || `Saldo awal ${nama} disimpan.`);
  } else {
    const cmd = `akun tambah ${nama} ${tipe}${saldo ? ` saldo ${saldo}` : ""}`;
    const res = await runCmd(cmd);
    showToast(res.text || `Akun ${nama} ditambah.`);
  }
  accNameEl.value = "";
  accSaldoEl.value = "";
  accMsgEl.hidden = true;
  await refreshAccList();
};

document.getElementById("updateReload")!.onclick = () => location.reload();

pickDirBtn.onclick = async () => {
  if (!supportsFolderBackup()) {
    showToast("Browser ini tak mendukung auto-backup folder. Pakai tombol ⬇ Backup.");
    return;
  }
  try {
    folder = await pickFolder();
    const ok = await folderPermission(folder, true);
    if (!ok) {
      folder = null;
      await forgetFolder();
      showToast("Izin folder ditolak. Auto-backup tidak aktif.");
      renderInfo();
      return;
    }
    folderNeedsPermission = false;
    backupPermWarned = false;
    await autoBackup(true);
    renderInfo();
  } catch (e) {
    if ((e as Error).name !== "AbortError") {
      showToast("Gagal memilih folder: " + (e as Error).message);
    }
  }
};

backupNowBtn.onclick = async () => {
  if (!folder) return;
  const ok = await folderPermission(folder, true);
  if (!ok) {
    folderNeedsPermission = true;
    showToast("Izin folder ditolak. Pilih folder lagi lewat ℹ → Backup & penyimpanan.");
    return;
  }
  folderNeedsPermission = false;
  backupPermWarned = false;
  await autoBackup(true);
};

clearDirBtn.onclick = async () => {
  folder = null;
  folderNeedsPermission = false;
  backupPermWarned = false;
  await forgetFolder();
  showToast("Auto-backup dimatikan.");
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
  const shared = parts.join(" ").slice(0, 500);
  input.value = shared;
  input.focus();
  if (startsWithCommand(shared)) {
    addBubble("Teks yang dibagikan berisi perintah. Periksa dulu, lalu tekan kirim.", "bot");
    return;
  }
  void send();
}


