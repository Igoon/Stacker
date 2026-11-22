// main.ts — UI chat di main thread. Semua logika + DB berjalan di worker.
import "./style.css";
import { startsWithCommand } from "./commands";
import { shortRp } from "./chart";
import {
  addHistoryEntry,
  HISTORY_LIMIT,
  normalizeHistoryEntry,
  shouldRememberCommand,
} from "./history";
import {
  DEFAULT_THEME,
  isThemeId,
  THEMES,
  themeById,
  themeVars,
  type ThemeId,
} from "./themes";
import type { Tx } from "./db";
import {
  folderAction,
  folderButtonLabel,
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

// True saat user menekan "Muat ulang": SW baru diaktifkan lalu halaman reload.
let swReloading = false;
// Cegah banner update tampil sebelum versi app yang berjalan diketahui
// (menghindari "update" palsu saat app sudah di versi terbaru).
let pendingUpdateCheck = false;
let checkUpdateWhenReady: (() => void) | null = null;
let latestVersion = "";

// true bila `remote` lebih baru dari `local` (semver sederhana x.y.z).
function isNewer(remote: string, local: string): boolean {
  const a = remote.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const b = local.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

// Service worker: cache app shell. Kalau SW baru mengambil alih, tampilkan bar
// "Muat ulang" — jangan reload otomatis supaya input user tak hilang.
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  // Tampilkan versi baru + catatan rilis (dari version.json hasil build) supaya
  // user tahu apa yang di-update, bukan sekadar "versi baru".
  const showUpdateBar = async (): Promise<void> => {
    // Tunggu sampai versi app yang berjalan diketahui; kalau dipanggil lebih
    // awal, tandai pending dan ulangi setelah worker "ready".
    if (!appVersion) {
      pendingUpdateCheck = true;
      return;
    }
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
        if (ver) latestVersion = ver;
        // Hanya tampilkan bila server benar-benar lebih baru (hindari notif
        // palsu saat versi sama, atau saat server rollback ke versi lama).
        if (ver && appVersion && !isNewer(ver, appVersion)) {
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
  // Dipanggil setelah worker siap (appVersion diketahui) untuk memutuskan
  // apakah banner update perlu ditampilkan.
  checkUpdateWhenReady = () => {
    if (pendingUpdateCheck) {
      pendingUpdateCheck = false;
      void showUpdateBar();
    }
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (swReloading) {
      window.location.reload();
      return;
    }
    if (!hadController) return;
    void showUpdateBar();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(new URL(/* @vite-ignore */ "../sw.js", import.meta.url), {
        scope: "./",
        // Selalu ambil sw.js dari jaringan, bukan cache HTTP (GitHub Pages
        // meng-cache sw.js 10 menit) -> update terdeteksi tiap app dibuka.
        updateViaCache: "none",
      })
      .then((reg) => {
        // Cek update segera, lalu berkala; juga saat kembali ke foreground.
        const check = () => {
          void reg.update().catch(() => undefined);
          if (reg.waiting && navigator.serviceWorker.controller) void showUpdateBar();
        };
        check();
        window.setInterval(check, 30 * 60 * 1000);
        document.addEventListener("visibilitychange", () => {
          if (!document.hidden) check();
        });
        // SW baru sudah menunggu (belum aktif) → tawarkan Muat ulang.
        if (reg.waiting && navigator.serviceWorker.controller) void showUpdateBar();
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) {
              void showUpdateBar();
            }
          });
        });
      })
      .catch((e) => console.warn("[sw] gagal registrasi:", e));
  });
}

// Perbarui paksa (tombol "Periksa pembaruan"): cek SW baru, bila ada aktifkan +
// muat ulang. Berguna saat banner update tak muncul pada PWA yang terinstall.
function waitInstalled(reg: ServiceWorkerRegistration, timeoutMs = 8000): Promise<ServiceWorker | null> {
  return new Promise((resolve) => {
    if (reg.waiting) return resolve(reg.waiting);
    const watch = (w: ServiceWorker | null): void => {
      if (!w) {
        resolve(null);
        return;
      }
      w.addEventListener("statechange", function h() {
        if (w.state === "installed") {
          w.removeEventListener("statechange", h);
          resolve(w);
        } else if (w.state === "redundant") {
          w.removeEventListener("statechange", h);
          resolve(null);
        }
      });
    };
    if (reg.installing) {
      watch(reg.installing);
      return;
    }
    const onFound = () => {
      reg.removeEventListener("updatefound", onFound);
      watch(reg.installing);
    };
    reg.addEventListener("updatefound", onFound);
    window.setTimeout(() => {
      reg.removeEventListener("updatefound", onFound);
      resolve(reg.waiting ?? null);
    }, timeoutMs);
  });
}

async function forceUpdate(silent = false, target = ""): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    if (!silent) window.location.reload();
    return;
  }
  if (!silent) showToast("Memeriksa pembaruan…");
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    if (!silent) window.location.reload();
    return;
  }
  try {
    await reg.update();
  } catch {
    if (!silent) showToast("Tak bisa memeriksa (offline?).");
    return;
  }
  const w = await waitInstalled(reg, silent ? 5000 : 8000);
  if (w) {
    swReloading = true;
    showToast(target ? `Memperbarui ke v${target}…` : "Memperbarui…");
    w.postMessage({ type: "SKIP_WAITING" });
    window.setTimeout(() => window.location.reload(), 1200);
  } else if (!silent) {
    showToast("Sudah versi terbaru.");
  }
}

// Saat app dibuka: kalau server sudah punya versi lebih baru, terapkan otomatis
// (aktifkan SW baru + reload) sekali per versi. Mencegah PWA "terjebak" lama.
let autoUpdateTried = false;
async function maybeAutoUpdate(): Promise<void> {
  if (autoUpdateTried) return;
  autoUpdateTried = true;
  let ver = "";
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    ver = String(((await res.json()) as { version?: string }).version ?? "");
    if (ver) latestVersion = ver;
  } catch {
    return; // offline
  }
  if (!ver || !appVersion || !isNewer(ver, appVersion)) return;
  try {
    if (sessionStorage.getItem("stacker-auto-updated") === ver) return;
    sessionStorage.setItem("stacker-auto-updated", ver);
  } catch {
    // sessionStorage bisa diblokir; tetap coba.
  }
  await forceUpdate(true, ver);
}

// Ambil versi terbaru dari server untuk ditampilkan di Info/Tentang.
async function refreshLatestVersion(): Promise<void> {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) latestVersion = String(((await res.json()) as { version?: string }).version ?? "");
  } catch {
    // offline / tak tersedia
  }
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
      checkUpdateWhenReady?.();
      void maybeAutoUpdate();
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
const saldoTotEl = document.getElementById("saldoTot")!;
const saldoIoEl = document.getElementById("saldoIo")!;
const subEl = document.getElementById("sub")!;
const busyEl = document.getElementById("busy")!;
const chipsEl = document.getElementById("chips")!;
const suggestEl = document.getElementById("suggest")!;
const quickEl = document.getElementById("quick");
if (quickEl) {
  for (const b of quickEl.querySelectorAll<HTMLButtonElement>("button[data-cmd]")) {
    b.onclick = () => {
      input.value = b.dataset.cmd ?? "";
      void send();
    };
  }
  for (const b of quickEl.querySelectorAll<HTMLButtonElement>("button[data-fill]")) {
    b.onclick = () => {
      input.value = b.dataset.fill ?? "";
      input.focus();
      updateSuggest();
    };
  }
}
const undoBar = document.getElementById("undoBar");
const undoBtn = document.getElementById("undo") as HTMLButtonElement;
const redoBtn = document.getElementById("redo") as HTMLButtonElement;
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
      ? arr
          .filter((x): x is string => typeof x === "string")
          .map(normalizeHistoryEntry)
          .filter((x) => x !== "")
          .slice(0, HISTORY_LIMIT)
      : [];
  } catch {
    return [];
  }
}
let recentCommands = readRecent();
function rememberCommand(text: string): void {
  if (!shouldRememberCommand(text)) return;
  recentCommands = addHistoryEntry(recentCommands, text);
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

let cachedAccountNames: string[] = [];

// Saran perintah dari riwayat + autocomplete @akun saat mengetik.
function updateSuggest(): void {
  const raw = input.value;
  suggestEl.replaceChildren();
  const atMatch = raw.match(/(?:^|\s)@([^\s]*)$/);
  if (atMatch && cachedAccountNames.length > 0) {
    const prefix = atMatch[1].toLowerCase();
    const accMatches = cachedAccountNames
      .filter((a) => !prefix || a.toLowerCase().includes(prefix))
      .slice(0, 8);
    if (accMatches.length > 0) {
      for (const acc of accMatches) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = "@" + acc;
        b.onclick = () => {
          const cut = raw.slice(0, raw.length - atMatch[1].length - 1);
          input.value = `${cut}@${acc} `;
          input.focus();
          suggestEl.hidden = true;
        };
        suggestEl.appendChild(b);
      }
      suggestEl.hidden = false;
      return;
    }
  }
  const q = raw.trim().toLowerCase();
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
  const clearBtn = document.getElementById("histClear") as HTMLButtonElement | null;
  if (clearBtn) clearBtn.disabled = recentCommands.length === 0;
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
    b.title = c;
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

document.getElementById("histClear")!.onclick = () => {
  if (!window.confirm("Hapus semua riwayat perintah?")) return;
  recentCommands = [];
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    // abaikan
  }
  renderHistory();
};

// Ajakan pasang app (Android/desktop). Muncul hanya bila browser menawarkan.
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<unknown>;
};
let deferredInstall: InstallPromptEvent | null = null;
const installAppBtn = document.getElementById("installApp") as HTMLButtonElement;
// Bila sudah terpasang (standalone), menu "Pasang aplikasi" tidak ditampilkan.
if (isStandalone) installAppBtn.hidden = true;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  if (isStandalone) return;
  deferredInstall = e as InstallPromptEvent;
  installAppBtn.hidden = false;
});
// Jika kelak menjadi standalone, sembunyikan lagi.
window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", (ev) => {
  if (ev.matches) {
    deferredInstall = null;
    installAppBtn.hidden = true;
  }
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
let lastSaldoNum = NaN;
let lastMasuk = 0;
let lastKeluar = 0;

// Format ringkas untuk header (mis. 10.000.000 -> "Rp10jt").
function fmtShortRp(n: number): string {
  if (!Number.isFinite(n)) return "-";
  return (n < 0 ? "-" : "") + "Rp" + shortRp(n);
}

function toggleSaldo(): void {
  if (!hideSaldo) return;
  saldoRevealed = !saldoRevealed;
  renderSaldo();
}
function renderSaldo(): void {
  const hidden = hideSaldo && !saldoRevealed;
  saldoTotEl.textContent = "Saldo " + (hidden ? "••••" : fmtShortRp(lastSaldoNum));
  saldoIoEl.textContent = hidden ? "••••" : `+${shortRp(lastMasuk)} · −${shortRp(lastKeluar)}`;
  saldoEl.title = hideSaldo ? (saldoRevealed ? "Ketuk untuk samarkan" : "Ketuk untuk lihat saldo") : "";
  saldoEl.setAttribute(
    "aria-label",
    !hideSaldo
      ? `Saldo ${fmtShortRp(lastSaldoNum)}, masuk ${shortRp(lastMasuk)}, keluar ${shortRp(lastKeluar)} bulan ini`
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

// Opsi "samarkan nominal di chat" DIHAPUS: nominal transaksi selalu ditampilkan.
const hideChat = false;
const RUPIAH_RE = /Rp[\d.,]+/g;
function maskRp(s: string): string {
  return s.replace(RUPIAH_RE, "Rp••••");
}
function applyChatMask(): void {
  chat.querySelectorAll<HTMLElement>(".bubble").forEach((b) => {
    const orig = b.dataset.text;
    const node = b.firstChild;
    if (orig != null && node && node.nodeType === Node.TEXT_NODE) {
      node.nodeValue = hideChat ? maskRp(orig) : orig;
    }
  });
  chat.querySelectorAll<HTMLElement>(".tx b[data-full]").forEach((el) => {
    const full = el.dataset.full ?? "";
    el.textContent = hideChat ? maskRp(full) : full;
  });
}

// Panic blur: samarkan seluruh layar saat app ditinggal (pindah app/tab, minimize)
// ATAU saat menganggur beberapa lama (mengatasi OS yang menangkap snapshot lebih
// dulu dari visibilitychange).
const PANIC_KEY = "stacker-panic";
const PANIC_IDLE_KEY = "stacker-panic-idle";
function readPanic(): boolean {
  try {
    const v = localStorage.getItem(PANIC_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}
function readPanicIdle(): number {
  try {
    const raw = localStorage.getItem(PANIC_IDLE_KEY);
    if (raw === null) return 120;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 120;
  } catch {
    return 120;
  }
}
let panicOn = readPanic();
let panicIdle = readPanicIdle();
let lastActivity = Date.now();
let idleBlurred = false;
const panicEl = document.getElementById("panic")!;
function applyPanic(): void {
  panicEl.hidden = !(panicOn && (document.hidden || idleBlurred));
}
function noteActivity(): void {
  lastActivity = Date.now();
  if (idleBlurred) {
    idleBlurred = false;
    applyPanic();
  }
}
for (const ev of ["pointerdown", "keydown", "touchstart", "scroll", "input"] as const) {
  window.addEventListener(ev, noteActivity, { passive: true });
}
panicEl.addEventListener("pointerdown", (e) => {
  e.stopPropagation();
  noteActivity();
});
window.setInterval(() => {
  if (!panicOn || panicIdle <= 0 || document.hidden) return;
  if (!idleBlurred && Date.now() - lastActivity >= panicIdle * 1000) {
    idleBlurred = true;
    applyPanic();
  }
}, 2000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) lastActivity = Date.now();
  applyPanic();
});
applyPanic();

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

const CAT_ICON_SVG: Record<string, string> = {
  makanan:
    '<path d="M5 3v6a2 2 0 0 0 4 0V3"/><path d="M7 3v18"/><path d="M18 3c-1.7 0-3 2.2-3 5s1.3 4 3 4 3-1 3-4-1.3-5-3-5z"/><path d="M18 12v9"/>',
  transportasi:
    '<rect x="4" y="4" width="16" height="11" rx="2"/><path d="M4 10h16"/><circle cx="8" cy="18" r="1.5"/><circle cx="16" cy="18" r="1.5"/>',
  belanja: '<path d="M6 7h12l-1 13H7L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  tagihan: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6"/><path d="M9 12h6"/>',
  kesehatan: '<path d="M12 20s-7-4.5-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.5-7 9-7 9z"/>',
  hiburan: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 9l5 3-5 3z"/>',
  gaji: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/><circle cx="16" cy="14" r="1"/>',
  tabungan: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/>',
  investasi: '<path d="M4 20V12"/><path d="M10 20V6"/><path d="M16 20v-6"/><path d="M2 20h20"/>',
  transfer:
    '<path d="M4 8h13"/><path d="M13 4l4 4-4 4"/><path d="M20 16H7"/><path d="M11 12l-4 4 4 4"/>',
};
const CAT_ICON_DEFAULT =
  '<path d="M20.6 12.6 12.6 20.6a2 2 0 0 1-2.8 0l-6.4-6.4A2 2 0 0 1 3 12.8V5a2 2 0 0 1 2-2h7.8a2 2 0 0 1 1.4.6l6.4 6.4a2 2 0 0 1 0 2.6z"/><circle cx="7.5" cy="7.5" r="1.2"/>';
const ICON_OPTIONS: [string, string][] = [
  ["makanan", "Makanan"],
  ["transportasi", "Transportasi"],
  ["belanja", "Belanja"],
  ["tagihan", "Tagihan"],
  ["kesehatan", "Kesehatan"],
  ["hiburan", "Hiburan"],
  ["gaji", "Gaji"],
  ["tabungan", "Tabungan"],
  ["investasi", "Investasi"],
  ["transfer", "Transfer"],
  ["tag", "Lainnya"],
];
function catIconSvg(name: string, iconId?: string): string {
  let inner: string | undefined;
  const id = iconId?.toLowerCase().trim();
  if (id === "tag") inner = CAT_ICON_DEFAULT;
  else if (id) inner = CAT_ICON_SVG[id];
  if (!inner) inner = CAT_ICON_SVG[name.toLowerCase().trim()];
  if (!inner) inner = CAT_ICON_DEFAULT;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
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
  b.textContent = hideChat ? maskRp(text) : text;
  b.dataset.text = text;
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
    d.className = "tx " + (tx.tipe === "masuk" ? "in" : "out");
    d.dataset.txId = String(tx.id);
    const sign = tx.tipe === "masuk" ? "+" : "-";
    const full = sign + tx.rupiah;
    const head = document.createElement("div");
    head.className = "tx-head";
    const icon = document.createElement("span");
    icon.className = "tx-icon";
    icon.innerHTML = catIconSvg(tx.kategori, tx.ikon ?? undefined);
    const cat = document.createElement("span");
    cat.className = "tx-cat";
    cat.textContent = tx.kategori;
    const strong = document.createElement("b");
    strong.className = "tx-amt";
    strong.textContent = hideChat ? maskRp(full) : full;
    strong.dataset.full = full;
    head.append(icon, cat, strong);
    const meta = document.createElement("div");
    meta.className = "tx-meta";
    meta.textContent = (tx.akun ? `${tx.akun} · ` : "") + `#${tx.id}`;
    d.append(head, meta);
    const txActions = document.createElement("div");
    txActions.className = "tx-actions";
    const editBtn = document.createElement("button");
    editBtn.className = "tx-edit";
    editBtn.type = "button";
    editBtn.textContent = "Ubah";
    editBtn.onclick = () => void openEditTxModal(tx, d);
    const btn = document.createElement("button");
    btn.className = "tx-del";
    btn.type = "button";
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
    txActions.append(editBtn, btn);
    d.appendChild(txActions);
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
let chatGeneration = 0;
function showStartupHint(s: Record<string, unknown>): void {
  if (hintShown) return;
  hintShown = true;
  const n = Number(s.txCount ?? 0);
  if (n > 0) {
    const recent = Array.isArray(s.recentTxs) ? (s.recentTxs as Tx[]) : [];
    addBubble(
      recent.length
        ? `${n} transaksi tersimpan · ${recent.length} terakhir:`
        : `${n} transaksi tersimpan di perangkat ini.\nKetik \`riwayat\` untuk melihat, \`help\` untuk daftar perintah.`,
      "bot",
      recent.length ? recent : undefined
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
  const gen = chatGeneration;
  const r = await call({ type: "state" });
  lastSaldoNum = Number(r.saldo ?? NaN);
  lastMasuk = Number(r.monthMasuk ?? 0);
  lastKeluar = Number(r.monthKeluar ?? 0);
  renderSaldo();
  pinSet = !!r.pinSet;
  txCount = Number(r.txCount ?? 0);
  if (Array.isArray(r.accounts)) {
    cachedAccountNames = (r.accounts as { nama?: string }[])
      .map((a) => String(a.nama ?? ""))
      .filter(Boolean);
  }
  chipsEl.hidden = txCount > 0;
  const hasUndo = !!r.canUndo;
  const hasRedo = !!r.canRedo;
  undoBtn.disabled = !hasUndo;
  redoBtn.disabled = !hasRedo;
  undoBtn.hidden = !hasUndo;
  redoBtn.hidden = !hasRedo;
  if (undoBar) undoBar.hidden = !(hasUndo || hasRedo);
  const undoCount = Number(r.undoCount ?? 0);
  const redoCount = Number(r.redoCount ?? 0);
  const undoName = typeof r.undoLabel === "string" ? r.undoLabel : "";
  const redoName = typeof r.redoLabel === "string" ? r.redoLabel : "";
  undoBtn.title = undoCount
    ? `Batalkan: ${undoName} (${undoCount} langkah)`
    : "Tidak ada aksi untuk dibatalkan";
  redoBtn.title = redoCount
    ? `Ulangi: ${redoName} (${redoCount} langkah)`
    : "Tidak ada aksi untuk diulang";
  undoBtn.setAttribute("aria-label", undoBtn.title);
  redoBtn.setAttribute("aria-label", redoBtn.title);
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
  // Jangan tambahkan bila layar sudah dibersihkan saat request masih berjalan.
  const notes = Array.isArray(r.notices) ? (r.notices as string[]) : [];
  if (gen === chatGeneration) {
    for (const n of notes) addBubble(n, "bot");
    if (notes.length > 0) playTing();
  }
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
    chatGeneration++;
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
  const gen = chatGeneration;
  const r = await call({ type: "chat", text });
  busyEl.hidden = true;
  if (gen !== chatGeneration) {
    // Layar dibersihkan saat perintah masih diproses: jangan munculkan bubble.
    void refresh();
    return;
  }
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
  if (
    (e.ctrlKey || e.metaKey) &&
    (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))
  ) {
    e.preventDefault();
    input.value = "redo";
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

// Aksi backup/restore JSON ada di Info -> Backup & penyimpanan.
document.getElementById("export")!.onclick = async () => {
  const r = await call({ type: "export" });
  saveFile(`stacker-backup-${todayStr()}.json`, r.json as string);
  lastBackupAt = todayStr();
  void call({ type: "markbackup", tanggal: lastBackupAt });
};

document.getElementById("exportCsvAll")!.onclick = async () => {
  const r = await call({ type: "exportcsv" });
  if (!r.ok || !r.file) {
    showToast(String(r.error ?? "Tidak ada transaksi untuk diekspor."));
    return;
  }
  const f = r.file as { name: string; content: string };
  saveFile(f.name, f.content);
  showToast(`CSV ${Number(r.count ?? 0)} transaksi siap diunduh.`);
};

document.getElementById("exportEnc")!.onclick = () => {
  askPass("", "Kata sandi minimal 8 karakter untuk mengenkripsi backup.", "encrypt");
};

document.getElementById("undo")!.onclick = () => {
  input.value = "undo";
  void send();
};

document.getElementById("redo")!.onclick = () => {
  input.value = "redo";
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

const WALL_PRESETS: WallPreset[] = THEMES.map((theme) => ({
  id: theme.id,
  label: theme.label,
  css: theme.wallpaper === "none" ? "" : theme.wallpaper,
}));

const WALL_KEY = "stacker-wallpaper";
const THEME_KEY = "stacker-theme";

// "auto" = tema otomatis: terang (Langit) saat siang, Default (gelap) saat malam.
type ThemePref = ThemeId | "auto";
const AUTO_LIGHT_THEME: ThemeId = "sky";
const AUTO_DAY_START = 6; // 06:00
const AUTO_DAY_END = 18; // 18:00

function resolveAutoTheme(now = new Date()): ThemeId {
  const h = now.getHours();
  return h >= AUTO_DAY_START && h < AUTO_DAY_END ? AUTO_LIGHT_THEME : DEFAULT_THEME;
}

function readTheme(): ThemePref {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "auto") return "auto";
    if (isThemeId(saved)) return saved;
  } catch {
    // localStorage diblokir; lanjut ke migrasi wallpaper.
  }
  try {
    const raw = localStorage.getItem(WALL_KEY);
    const w = JSON.parse(raw ?? "null") as { kind?: string; id?: string } | null;
    if (w?.kind === "preset" && isThemeId(w.id)) return w.id;
  } catch {
    // data rusak -> default
  }
  return DEFAULT_THEME;
}

let currentPref: ThemePref = readTheme();
let currentTheme: ThemeId = currentPref === "auto" ? resolveAutoTheme() : currentPref;

function applyTheme(pref: ThemePref, persist = true): void {
  const resolved: ThemeId = pref === "auto" ? resolveAutoTheme() : pref;
  const theme = themeById(resolved);
  const root = document.documentElement;
  for (const [name, value] of Object.entries(themeVars(theme))) {
    root.style.setProperty(name, value);
  }
  root.dataset.theme = theme.id;
  currentPref = pref;
  currentTheme = theme.id;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme.metaColor);
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, pref);
    } catch {
      // abaikan
    }
  }
}

function maybeAutoTheme(): void {
  if (currentPref !== "auto") return;
  if (resolveAutoTheme() !== currentTheme) applyTheme("auto", false);
}

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
    s.backgroundColor = "var(--app-bg)";
    s.backgroundImage = `linear-gradient(rgba(0,0,0,${w.dim}), rgba(0,0,0,${w.dim})), url("${w.image}")`;
    s.backgroundSize = "cover, cover";
    return;
  }
  // Mode tema/default: biarkan CSS memakai --wallpaper dari tema aktif.
  s.backgroundColor = "";
  s.backgroundImage = "";
  s.backgroundSize = "";
}

let currentWall: Wall = readWall();

function syncWallControls(w: Wall): void {
  const activeId = currentPref;
  for (const btn of Array.from(wallSwatches.querySelectorAll<HTMLButtonElement>(".swatch"))) {
    btn.setAttribute("aria-pressed", String(btn.dataset.preset === activeId));
  }
  const dim = w.kind === "image" ? w.dim : 0.45;
  wallDim.value = String(Math.round(dim * 100));
  wallDimVal.textContent = `${Math.round(dim * 100)}%`;
  const themeLabel = document.getElementById("wallThemeLabel");
  if (themeLabel) {
    const visual = themeById(currentTheme).label;
    themeLabel.textContent = `Tema aktif: ${
      currentPref === "auto" ? `Otomatis (${visual})` : visual
    }${w.kind === "image" ? " - wallpaper kustom" : ""}`;
  }
}

// Tombol Otomatis: terang saat siang, default saat malam.
{
  const btn = document.createElement("button");
  btn.className = "swatch";
  btn.type = "button";
  btn.dataset.preset = "auto";
  btn.textContent = "Otomatis";
  btn.title = "Tema otomatis: terang saat siang, default saat malam";
  btn.setAttribute("aria-label", "Tema otomatis");
  btn.style.background = "linear-gradient(90deg,#eef4fb 50%,#111b21 50%)";
  btn.onclick = () => {
    applyTheme("auto");
    if (currentWall.kind !== "image") {
      currentWall = { kind: "default" };
      applyWall(currentWall);
      saveWall(currentWall);
    }
    syncWallControls(currentWall);
  };
  wallSwatches.appendChild(btn);
}

for (const p of WALL_PRESETS) {
  const btn = document.createElement("button");
  btn.className = "swatch";
  btn.type = "button";
  btn.dataset.preset = p.id;
  btn.textContent = p.label;
  btn.title = `Tema ${p.label}`;
  btn.setAttribute("aria-label", `Tema ${p.label}`);
  btn.style.background = p.id === "default" ? "#0b141a" : p.css;
  btn.onclick = () => {
    if (isThemeId(p.id)) applyTheme(p.id);
    if (currentWall.kind !== "image") {
      currentWall = { kind: "default" };
      applyWall(currentWall);
      saveWall(currentWall);
    }
    syncWallControls(currentWall);
  };
  wallSwatches.appendChild(btn);
}

const hideSaldoEl = document.getElementById("hideSaldo") as HTMLInputElement;
const panicOnEl = document.getElementById("panicOn") as HTMLInputElement;
const panicIdleEl = document.getElementById("panicIdle") as HTMLSelectElement;
const soundNoticeEl = document.getElementById("soundNotice") as HTMLInputElement;
const hapticNoticeEl = document.getElementById("hapticNotice") as HTMLInputElement;

document.getElementById("openWall")!.onclick = () => {
  for (const m of INFO_PANES) m.hidden = true;
  currentWall = readWall();
  syncWallControls(currentWall);
  hideSaldoEl.checked = hideSaldo;
  panicOnEl.checked = panicOn;
  panicIdleEl.value = String(panicIdle);
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

panicOnEl.onchange = () => {
  panicOn = panicOnEl.checked;
  idleBlurred = false;
  lastActivity = Date.now();
  try {
    localStorage.setItem(PANIC_KEY, panicOn ? "1" : "0");
  } catch {
    // abaikan
  }
  applyPanic();
  showToast(panicOn ? "Panic blur aktif saat app ditinggal." : "Panic blur dimatikan.");
};

panicIdleEl.onchange = () => {
  panicIdle = Number(panicIdleEl.value) || 0;
  idleBlurred = false;
  lastActivity = Date.now();
  try {
    localStorage.setItem(PANIC_IDLE_KEY, String(panicIdle));
  } catch {
    // abaikan
  }
  applyPanic();
  showToast(
    panicIdle > 0
      ? `Blur otomatis setelah ${panicIdle} dtk menganggur.`
      : "Blur otomatis saat menganggur dimatikan."
  );
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
    ctx.fillStyle =
      getComputedStyle(document.documentElement).getPropertyValue("--app-bg").trim() || "#0b141a";
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

applyTheme(currentPref, false);
setInterval(maybeAutoTheme, 60_000);
document.addEventListener("visibilitychange", maybeAutoTheme);
window.addEventListener("focus", maybeAutoTheme);
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
const catIkonEl = document.getElementById("catIkon") as HTMLSelectElement;
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
const recModal = document.getElementById("recModal")!;
const recListEl = document.getElementById("recList")!;
const recNoteEl = document.getElementById("recNote") as HTMLInputElement;
const recJumlahEl = document.getElementById("recJumlah") as HTMLInputElement;
const recAccEl = document.getElementById("recAcc") as HTMLSelectElement;
const recHariEl = document.getElementById("recHari") as HTMLInputElement;
const recMsgEl = document.getElementById("recMsg")!;
const debtModal = document.getElementById("debtModal")!;
const debtTotalsEl = document.getElementById("debtTotals")!;
const debtListEl = document.getElementById("debtList")!;
const debtArahEl = document.getElementById("debtArah") as HTMLSelectElement;
const debtNamaEl = document.getElementById("debtNama") as HTMLInputElement;
const debtJumlahEl = document.getElementById("debtJumlah") as HTMLInputElement;
const debtMsgEl = document.getElementById("debtMsg")!;
const searchModal = document.getElementById("searchModal")!;
const searchQEl = document.getElementById("searchQ") as HTMLInputElement;
const searchAccEl = document.getElementById("searchAcc") as HTMLSelectElement;
const searchCatEl = document.getElementById("searchCat") as HTMLSelectElement;
const searchFromEl = document.getElementById("searchFrom") as HTMLInputElement;
const searchToEl = document.getElementById("searchTo") as HTMLInputElement;
const searchMinEl = document.getElementById("searchMin") as HTMLInputElement;
const searchMaxEl = document.getElementById("searchMax") as HTMLInputElement;
const searchSummaryEl = document.getElementById("searchSummary")!;
const searchListEl = document.getElementById("searchList")!;
const subsModal = document.getElementById("subsModal")!;
const subsListEl = document.getElementById("subsList")!;
const goalModal = document.getElementById("goalModal")!;
const goalListEl = document.getElementById("goalList")!;
const goalNamaEl = document.getElementById("goalNama") as HTMLInputElement;
const goalTargetEl = document.getElementById("goalTarget") as HTMLInputElement;
const goalTempoEl = document.getElementById("goalTempo") as HTMLInputElement;
const goalMsgEl = document.getElementById("goalMsg")!;
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
  recModal,
  debtModal,
  searchModal,
  subsModal,
  goalModal,
];
// Semantik dialog + tutup dengan Esc.
for (const m of document.querySelectorAll<HTMLElement>(".modal")) {
  m.setAttribute("role", "dialog");
  m.setAttribute("aria-modal", "true");
  m.addEventListener("click", (e) => {
    if (e.target !== m) return;
    if (m.id === "pinModal") closePinModal(true);
    else if (m.id === "promptModal") closePromptModal(null);
    else m.hidden = true;
  });
}
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const open = Array.from(document.querySelectorAll<HTMLElement>(".modal")).filter((m) => !m.hidden);
  const top = open[open.length - 1];
  if (!top) return;
  if (top.id === "pinModal") closePinModal(true);
  else if (top.id === "promptModal") closePromptModal(null);
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
      "stacker-theme",
      "stacker-lock",
      "stacker-retain",
      "stacker-idle",
      "stacker-hide-saldo",
      "stacker-sound",
      "stacker-haptic",
      "stacker-first-use",
      "stacker-cmd-history",
      "stacker-panic",
      "stacker-panic-idle",
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
        "Auto-backup butuh izin folder lagi (browser meminta ulang). Buka ℹ → Backup & penyimpanan → Izinkan folder tersimpan.",
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
        ? folder.name + (folderNeedsPermission ? " - izin perlu diperbarui" : " - aktif")
        : "nonaktif"
    }`,
    folder
      ? "Izin folder bisa diminta ulang browser setelah app ditutup; folder tidak perlu dipilih ulang."
      : "Auto-backup folder: pilih folder sekali (Chrome/Edge/Android).",
    `Retensi backup: ${readRetain()} file terbaru`,
    storageText ? "\n" + storageText : "",
  ]
    .filter((x) => x !== "")
    .join("\n");
  aboutLines.textContent = [
    `Versi: v${appVersion || "-"}`,
    `Server: v${latestVersion || "-"}${
      latestVersion && appVersion
        ? isNewer(latestVersion, appVersion)
          ? " (update tersedia — ketuk Muat ulang)"
          : " (terbaru)"
        : ""
    }`,
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
  pickDirBtn.textContent = folderButtonLabel(!!folder, folderNeedsPermission);
  pickDirBtn.title =
    folderAction(!!folder, folderNeedsPermission) === "pick"
      ? "Pilih folder untuk auto-backup"
      : folderAction(!!folder, folderNeedsPermission) === "grant"
        ? "Minta izin akses folder (folder tetap sama)"
        : "Ganti folder auto-backup";
  const storageWarn = document.getElementById("storageWarn");
  if (storageWarn) storageWarn.hidden = !(folder && folderNeedsPermission);
  renderPinButtons();
}

function showInfoPane(pane: HTMLElement): void {
  for (const m of INFO_PANES) m.hidden = true;
  pane.hidden = false;
  renderInfo();
}

document.getElementById("info")!.onclick = async () => {
  await Promise.all([refreshStorageText(), refresh(), refreshAiHosts(), refreshLatestVersion()]);
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

// ---------- Modal Input Kustom (pengganti window.prompt) ----------
const promptModal = document.getElementById("promptModal")!;
const promptTitleEl = document.getElementById("promptTitle")!;
const promptHintEl = document.getElementById("promptHint")!;
const promptLabel1Text = document.getElementById("promptLabel1Text")!;
const promptInputEl = document.getElementById("promptInput") as HTMLInputElement;
const promptRow2El = document.getElementById("promptRow2")!;
const promptLabel2Text = document.getElementById("promptLabel2Text")!;
const promptInput2El = document.getElementById("promptInput2") as HTMLInputElement;
const promptAccWrap = document.getElementById("promptAccWrap")!;
const promptSyncAcc = document.getElementById("promptSyncAcc") as HTMLInputElement;
const promptSyncLabel = document.getElementById("promptSyncLabel")!;
const promptAccRow = document.getElementById("promptAccRow")!;
const promptAccSel = document.getElementById("promptAccSel") as HTMLSelectElement;
const promptMsgEl = document.getElementById("promptMsg")!;

interface PromptResult {
  value: string;
  value2?: string;
  account?: string;
}
let promptResolve: ((res: PromptResult | null) => void) | null = null;
let promptValidator: ((res: PromptResult) => string | null) | null = null;

function closePromptModal(res: PromptResult | null): void {
  promptModal.hidden = true;
  const resolve = promptResolve;
  promptResolve = null;
  promptValidator = null;
  resolve?.(res);
}

promptSyncAcc.onchange = () => {
  promptAccRow.hidden = !promptSyncAcc.checked;
};

document.getElementById("promptCancel")!.onclick = () => closePromptModal(null);

function submitPromptModal(): void {
  const res: PromptResult = {
    value: promptInputEl.value.trim(),
    value2: promptRow2El.hidden ? undefined : promptInput2El.value.trim(),
    account: !promptAccWrap.hidden && promptSyncAcc.checked ? promptAccSel.value : undefined,
  };
  if (promptValidator) {
    const err = promptValidator(res);
    if (err) {
      promptMsgEl.hidden = false;
      promptMsgEl.textContent = err;
      return;
    }
  }
  closePromptModal(res);
}

document.getElementById("promptOk")!.onclick = submitPromptModal;
promptInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    submitPromptModal();
  }
});
promptInput2El.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    submitPromptModal();
  }
});

async function askModalPrompt(opts: {
  title: string;
  hint?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  inputMode?: string;
  label2?: string;
  placeholder2?: string;
  defaultValue2?: string;
  inputMode2?: string;
  syncAccountLabel?: string;
  validate?: (res: PromptResult) => string | null;
}): Promise<PromptResult | null> {
  promptTitleEl.textContent = opts.title;
  promptHintEl.textContent = opts.hint ?? "";
  promptHintEl.hidden = !opts.hint;
  promptLabel1Text.textContent = opts.label ?? "Nilai";
  promptInputEl.placeholder = opts.placeholder ?? "";
  promptInputEl.value = opts.defaultValue ?? "";
  promptInputEl.inputMode = opts.inputMode ?? "text";

  if (opts.label2) {
    promptRow2El.hidden = false;
    promptLabel2Text.textContent = opts.label2;
    promptInput2El.placeholder = opts.placeholder2 ?? "";
    promptInput2El.value = opts.defaultValue2 ?? "";
    promptInput2El.inputMode = opts.inputMode2 ?? "text";
  } else {
    promptRow2El.hidden = true;
    promptInput2El.value = "";
  }

  if (opts.syncAccountLabel) {
    const r = await call({ type: "listacc" });
    const accs = (Array.isArray(r.accounts) ? r.accounts : []) as AccRow[];
    promptAccSel.replaceChildren();
    for (const a of accs) {
      const o = document.createElement("option");
      o.value = a.nama;
      o.textContent = a.nama;
      promptAccSel.appendChild(o);
    }
    promptSyncLabel.textContent = opts.syncAccountLabel;
    promptSyncAcc.checked = false;
    promptAccRow.hidden = true;
    promptAccWrap.hidden = accs.length === 0;
  } else {
    promptAccWrap.hidden = true;
    promptSyncAcc.checked = false;
    promptAccRow.hidden = true;
  }

  promptMsgEl.hidden = true;
  promptValidator = opts.validate ?? null;
  promptModal.hidden = false;
  promptInputEl.focus();
  promptInputEl.select();
  return new Promise((resolve) => {
    promptResolve = resolve;
  });
}

// Reset data (jalur utama lewat menu; chat `reset ...` tetap ada sebagai pintasan).
async function runReset(kind: "transaksi" | "kategori" | "akun" | "semua"): Promise<void> {
  if (!ready) return;
  if (kind === "semua") {
    if (pinSet) {
      if (!(await verifyPinForWipe())) return;
    } else {
      const typed = await askModalPrompt({
        title: "Konfirmasi reset total",
        hint: "Semua transaksi, akun, kategori, anggaran, utang, dan target akan dikembalikan ke awal.",
        label: "Ketik RESET untuk melanjutkan",
        placeholder: "RESET",
      });
      if ((typed?.value ?? "").toUpperCase() !== "RESET") return;
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
  ikon?: string | null;
}
let catNames = new Set<string>();

async function runCmd(text: string): Promise<Reply & Record<string, unknown>> {
  const res = await call({ type: "chat", text });
  void refresh();
  return res;
}

function populateCatIcons(): void {
  if (catIkonEl.options.length) return;
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "(otomatis dari nama)";
  catIkonEl.appendChild(none);
  for (const [id, label] of ICON_OPTIONS) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = label;
    catIkonEl.appendChild(o);
  }
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
    const left = document.createElement("span");
    left.className = "cat-left";
    const ico = document.createElement("span");
    ico.className = "cat-ico";
    ico.innerHTML = catIconSvg(c.nama, c.ikon ?? undefined);
    const nm = document.createElement("span");
    nm.className = "cat-name";
    nm.textContent = c.nama;
    left.append(ico, nm);
    const badge = document.createElement("span");
    badge.className = "cat-badge";
    badge.textContent = c.tipe;
    head.append(left, badge);
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
      catIkonEl.value = c.ikon ?? "";
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
  populateCatIcons();
  await refreshCatList();
};
document.getElementById("catBack")!.onclick = () => showInfoPane(infoModal);
document.getElementById("catReset")!.onclick = () => {
  catNameEl.value = "";
  catKwEl.value = "";
  catIkonEl.value = "";
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
  await runCmd(`kategori ikon ${nama} ${catIkonEl.value || "auto"}`);
  catNameEl.value = "";
  catKwEl.value = "";
  catIkonEl.value = "";
  catMsgEl.hidden = true;
  await refreshCatList();
};

// ---------- Manajemen anggaran (UI) ----------
function fmtRp(n: number): string {
  const v = Math.round(n);
  return (v < 0 ? "-" : "") + "Rp" + Math.abs(v).toLocaleString("id-ID");
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
const dashPrevBtn = document.getElementById("dashPrev") as HTMLButtonElement;
const dashNextBtn = document.getElementById("dashNext") as HTMLButtonElement;
const dashPeriodLabel = document.getElementById("dashPeriodLabel")!;
const currentYm = (): string => todayStr().slice(0, 7);
let dashYm = currentYm();

function shiftYm(ym: string, delta: number): string {
  const [y, mo] = ym.split("-").map(Number);
  const d = new Date(y, (mo || 1) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

dashPrevBtn.onclick = () => {
  dashYm = shiftYm(dashYm, -1);
  void renderDash();
};
dashNextBtn.onclick = () => {
  if (dashYm >= currentYm()) return;
  dashYm = shiftYm(dashYm, 1);
  void renderDash();
};

async function renderDash(): Promise<void> {
  const r = await call({ type: "dashboard", period: dashYm });
  if (typeof r.ym === "string" && r.ym) dashYm = r.ym;
  dashPeriodLabel.textContent = String(r.label ?? dashYm);
  dashNextBtn.disabled = dashYm >= currentYm();
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
  const hidden = hideSaldo && !saldoRevealed;
  const mask = (v: string): string => (hidden ? "••••" : v);
  const signed = (n: number): string => (n < 0 ? "-" : "+") + fmtRp(Math.abs(n));
  const netWorth = Number(r.netWorth ?? 0);
  const utang = Number(r.utang ?? 0);
  const piutang = Number(r.piutang ?? 0);
  const projNet = Number(r.projNet ?? 0);
  const avg3Net = Number(r.avg3Net ?? 0);
  const netWorthCard = card("Net worth", mask(signed(netWorth)), true);
  if (hideSaldo) {
    netWorthCard.style.cursor = "pointer";
    netWorthCard.onclick = () => {
      saldoRevealed = !saldoRevealed;
      renderSaldo();
      void renderDash();
    };
  }
  cards.append(
    saldoCard,
    netWorthCard,
    card(`Masuk · ${String(r.label ?? "")}`, fmtRp(Number(r.masuk ?? 0))),
    card("Keluar", fmtRp(Number(r.keluar ?? 0))),
    card("Net", signed(net), true),
    card("Utang", fmtRp(utang)),
    card("Piutang", fmtRp(piutang)),
    card("Proyeksi net bulan", signed(projNet), true),
    card("Rata-rata net 3 bln", signed(avg3Net), true),
    card(
      `Hari ini · ${todayCount} transaksi`,
      "-" + fmtRp(todayKeluar) + (todayMasuk > 0 ? ` · +${fmtRp(todayMasuk)}` : ""),
      true
    )
  );
  dashBodyEl.appendChild(cards);

  const health = (r.health ?? {}) as {
    score?: number;
    tier?: string;
    tip?: string;
    factors?: { label: string; score: number; detail: string }[];
  };
  if (typeof health.score === "number" && Array.isArray(health.factors)) {
    const hTitle = document.createElement("div");
    hTitle.className = "dash-title";
    hTitle.textContent = "Skor kesehatan finansial";
    const box = document.createElement("div");
    box.className = "health";
    const score = Number(health.score);
    const color =
      score >= 80
        ? "var(--accent)"
        : score >= 60
          ? "var(--accent-2)"
          : score >= 40
            ? "var(--warning)"
            : "var(--danger)";
    const ring = document.createElement("div");
    ring.className = "health-ring";
    ring.style.background = `conic-gradient(${color} 0 ${score}%, var(--surface-3) ${score}% 100%)`;
    const hole = document.createElement("div");
    hole.className = "health-hole";
    hole.textContent = String(score);
    ring.appendChild(hole);
    const meta = document.createElement("div");
    meta.className = "health-meta";
    const tier = document.createElement("div");
    tier.className = "health-tier";
    tier.textContent = String(health.tier ?? "");
    const tip = document.createElement("div");
    tip.className = "health-tip";
    tip.textContent = health.tip ? "Saran: " + String(health.tip) : "";
    meta.append(tier, tip);
    box.append(ring, meta);
    dashBodyEl.append(hTitle, box);
    const flist = document.createElement("div");
    flist.className = "dash-list";
    for (const f of health.factors) {
      const row = document.createElement("div");
      row.className = "dr";
      const a = document.createElement("span");
      a.textContent = f.label;
      const b = document.createElement("span");
      b.textContent = `${f.score}/100`;
      row.append(a, b);
      const bar = document.createElement("div");
      bar.className = "bar";
      const fill = document.createElement("span");
      fill.style.width = Math.max(0, Math.min(100, Number(f.score))) + "%";
      bar.appendChild(fill);
      flist.append(row, bar);
    }
    dashBodyEl.appendChild(flist);
  }

  const alloc = (r.alloc ?? {}) as {
    income?: number;
    needs?: number;
    wants?: number;
    savings?: number;
    targetNeeds?: number;
    targetWants?: number;
    targetSavings?: number;
  };
  const allocIncome = Number(alloc.income ?? 0);
  if (allocIncome > 0) {
    const title = document.createElement("div");
    title.className = "dash-title";
    title.textContent = "Alokasi 50/30/20";
    const list = document.createElement("div");
    list.className = "dash-list";
    const rows3: [string, number, number, boolean][] = [
      ["Kebutuhan (50%)", Number(alloc.needs ?? 0), Number(alloc.targetNeeds ?? 0), true],
      ["Keinginan (30%)", Number(alloc.wants ?? 0), Number(alloc.targetWants ?? 0), true],
      ["Tabungan (20%)", Number(alloc.savings ?? 0), Number(alloc.targetSavings ?? 0), false],
    ];
    for (const [label, v, t, isLimit] of rows3) {
      const row = document.createElement("div");
      row.className = "dr";
      const a = document.createElement("span");
      a.textContent = label;
      const b = document.createElement("span");
      const pctOf = allocIncome > 0 ? Math.round((v / allocIncome) * 100) : 0;
      b.textContent = `${fmtRp(v)} (${pctOf}%)`;
      row.append(a, b);
      const bar = document.createElement("div");
      bar.className =
        "bar" + (isLimit && t > 0 && v > t ? " over" : !isLimit && v >= t ? " done" : "");
      const fill = document.createElement("span");
      fill.style.width = (t > 0 ? Math.min(100, Math.max(0, (v / t) * 100)) : 0) + "%";
      bar.appendChild(fill);
      list.append(row, bar);
    }
    dashBodyEl.append(title, list);
  }

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
  if (typeof r.trendSvg === "string" && r.trendSvg) {
    const t = document.createElement("div");
    t.className = "dash-title";
    t.textContent = "Tren 6 bulan";
    const wrap = document.createElement("div");
    wrap.className = "chart";
    wrap.innerHTML = r.trendSvg;
    dashBodyEl.append(t, wrap);
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
  dashYm = currentYm();
  showInfoPane(dashModal);
  await renderDash();
};
document.getElementById("quickDash")?.addEventListener("click", () => {
  dashYm = currentYm();
  showInfoPane(dashModal);
  void renderDash();
});
document.getElementById("quickSearch")?.addEventListener("click", async () => {
  showInfoPane(searchModal);
  searchSummaryEl.hidden = true;
  searchListEl.replaceChildren();
  await refreshSearchOptions();
  searchQEl.focus();
});
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
      const ans = await askModalPrompt({
        title: `Ubah nama akun`,
        label: `Nama baru untuk "${a.nama}"`,
        defaultValue: a.nama,
        validate: (v) => (!v.value ? "Nama akun tidak boleh kosong." : null),
      });
      if (!ans || ans.value === a.nama) return;
      const res = await runCmd(`akun ubah ${a.nama} jadi ${ans.value}`);
      showToast(res.text || `Akun ${a.nama} → ${ans.value}.`);
      await refreshAccList();
    };
    const adj = document.createElement("button");
    adj.textContent = "Sesuaikan";
    adj.onclick = async () => {
      const ans = await askModalPrompt({
        title: `Sesuaikan saldo ${a.nama}`,
        hint: "Saldo awal akun akan dihitung ulang agar saldo saat ini cocok dengan nominal nyata.",
        label: "Saldo nyata (mis. 100jt atau 250000)",
        placeholder: "500rb",
        inputMode: "decimal",
        validate: (v) => (!v.value ? "Nominal wajib diisi." : null),
      });
      if (!ans) return;
      const res = await runCmd(`sesuaikan ${a.nama} ${ans.value}`);
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

// ---------- Transaksi berulang (UI) ----------
interface RecRow {
  id: number;
  catatan: string;
  jumlah: number;
  tipe: "masuk" | "keluar";
  kategori: string;
  account_id: number | null;
  hari: number;
  mulai: string;
  terakhir: string | null;
  aktif: number;
}

async function refreshRecList(): Promise<void> {
  const [r, a] = await Promise.all([call({ type: "listrecurring" }), call({ type: "listacc" })]);
  const rows = (Array.isArray(r.recurring) ? r.recurring : []) as RecRow[];
  const accs = (Array.isArray(a.accounts) ? a.accounts : []) as AccRow[];
  const nameById = new Map(accs.map((x) => [x.id, x.nama]));

  const prevAcc = recAccEl.value;
  recAccEl.replaceChildren();
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "(tanpa akun)";
  recAccEl.appendChild(none);
  for (const x of accs) {
    const o = document.createElement("option");
    o.value = x.nama;
    o.textContent = x.nama;
    recAccEl.appendChild(o);
  }
  if (prevAcc && accs.some((x) => x.nama === prevAcc)) recAccEl.value = prevAcc;

  recListEl.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "info-note";
    empty.textContent = "Belum ada transaksi berulang. Isi form di bawah.";
    recListEl.appendChild(empty);
    return;
  }
  for (const b of rows) {
    const item = document.createElement("div");
    item.className = "cat-item";
    const head = document.createElement("div");
    head.className = "cat-head";
    const nm = document.createElement("span");
    nm.className = "cat-name";
    nm.textContent = b.catatan;
    const badge = document.createElement("span");
    badge.className = "cat-badge";
    badge.textContent = b.aktif ? "aktif" : "nonaktif";
    head.append(nm, badge);
    const info = document.createElement("div");
    info.className = "cat-kw";
    const accName = b.account_id != null ? nameById.get(b.account_id) : undefined;
    info.textContent =
      `${b.tipe === "masuk" ? "+" : "−"}${fmtRp(b.jumlah)} · tiap tgl ${b.hari}` +
      (accName ? ` · ${accName}` : "") +
      (b.terakhir ? ` · terakhir ${b.terakhir}` : "");

    const actions = document.createElement("div");
    actions.className = "cat-actions";
    const tgl = document.createElement("button");
    tgl.textContent = b.aktif ? "Nonaktifkan" : "Aktifkan";
    tgl.onclick = async () => {
      const res = await runCmd(`berulang ${b.aktif ? "nonaktif" : "aktif"} ${b.id}`);
      showToast(res.text || "Status diubah.");
      await refreshRecList();
    };
    const ed = document.createElement("button");
    ed.textContent = "Ubah";
    ed.onclick = async () => {
      const ans = await askModalPrompt({
        title: `Ubah berulang: ${b.catatan}`,
        label: "Nominal baru (mis. 350rb)",
        defaultValue: String(b.jumlah),
        inputMode: "decimal",
        label2: "Tanggal tiap bulan (1-28)",
        defaultValue2: String(b.hari),
        inputMode2: "numeric",
        validate: (v) => {
          if (!v.value) return "Nominal wajib diisi.";
          const h = Number(v.value2 || String(b.hari));
          if (!Number.isInteger(h) || h < 1 || h > 28) return "Tanggal harus antara 1 sampai 28.";
          return null;
        },
      });
      if (!ans) return;
      const hari = Number(ans.value2 || String(b.hari));
      const res = await runCmd(`berulang ubah ${b.id} ${ans.value} tiap ${hari}`);
      showToast(res.text || "Berulang diubah.");
      await refreshRecList();
    };
    const del = document.createElement("button");
    del.textContent = "Hapus";
    del.onclick = async () => {
      if (!window.confirm(`Hapus transaksi berulang "${b.catatan}"?`)) return;
      const res = await runCmd(`berulang hapus ${b.id}`);
      showToast(res.text || "Berulang dihapus.");
      await refreshRecList();
    };
    actions.append(tgl, ed, del);

    item.append(head, info, actions);
    recListEl.appendChild(item);
  }
}

document.getElementById("openRec")!.onclick = async () => {
  showInfoPane(recModal);
  recMsgEl.hidden = true;
  await refreshRecList();
};
document.getElementById("recBack")!.onclick = () => showInfoPane(infoModal);
document.getElementById("recResetForm")!.onclick = () => {
  recNoteEl.value = "";
  recJumlahEl.value = "";
  recHariEl.value = "1";
  recAccEl.value = "";
  recMsgEl.hidden = true;
};
document.getElementById("recSave")!.onclick = async () => {
  const note = recNoteEl.value.trim();
  const jumlah = recJumlahEl.value.trim();
  const hari = Number(recHariEl.value);
  if (!note || !jumlah) {
    recMsgEl.hidden = false;
    recMsgEl.textContent = "Catatan dan nominal wajib diisi.";
    return;
  }
  if (!Number.isInteger(hari) || hari < 1 || hari > 28) {
    recMsgEl.hidden = false;
    recMsgEl.textContent = "Tanggal harus 1-28.";
    return;
  }
  const acc = recAccEl.value;
  const res = await runCmd(`berulang ${acc ? acc + " " : ""}${note} ${jumlah} tiap ${hari}`);
  showToast(res.text || "Transaksi berulang ditambah.");
  recNoteEl.value = "";
  recJumlahEl.value = "";
  recMsgEl.hidden = true;
  await refreshRecList();
};

// ---------- Utang / Piutang (UI) ----------
interface DebtRow {
  id: number;
  arah: "utang" | "piutang";
  nama: string;
  jumlah: number;
  sisa: number;
  catatan: string | null;
  tanggal: string;
}

async function refreshDebtList(): Promise<void> {
  const r = await call({ type: "listdebt" });
  const rows = (Array.isArray(r.debts) ? r.debts : []) as DebtRow[];
  const t = (r.totals ?? {}) as { utang?: number; piutang?: number };
  debtTotalsEl.textContent =
    `Utang saya: ${fmtRp(Number(t.utang ?? 0))} · Piutang saya: ${fmtRp(Number(t.piutang ?? 0))}`;
  debtListEl.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "info-note";
    empty.textContent = "Belum ada utang/piutang. Isi form di bawah.";
    debtListEl.appendChild(empty);
    return;
  }
  for (const d of rows) {
    const item = document.createElement("div");
    item.className = "cat-item";
    const head = document.createElement("div");
    head.className = "cat-head";
    const nm = document.createElement("span");
    nm.className = "cat-name";
    nm.textContent = d.nama;
    const badge = document.createElement("span");
    badge.className = "cat-badge";
    badge.textContent = d.arah;
    head.append(nm, badge);
    const info = document.createElement("div");
    info.className = "cat-kw";
    info.textContent =
      `#${d.id} · sisa ${fmtRp(d.sisa)}` +
      (d.sisa !== d.jumlah ? ` (dari ${fmtRp(d.jumlah)})` : "") +
      ` · ${d.tanggal}`;

    const actions = document.createElement("div");
    actions.className = "cat-actions";
    const pay = document.createElement("button");
    pay.textContent = "Bayar";
    pay.onclick = async () => {
      const ans = await askModalPrompt({
        title: `${d.arah === "utang" ? "Bayar utang" : "Terima piutang"}: ${d.nama}`,
        hint: `Sisa saat ini: ${fmtRp(d.sisa)}`,
        label: "Nominal (mis. 50rb)",
        placeholder: String(d.sisa),
        inputMode: "decimal",
        syncAccountLabel:
          d.arah === "utang" ? "Sekalian potong saldo akun" : "Sekalian tambah saldo akun",
        validate: (v) => (!v.value ? "Nominal wajib diisi." : null),
      });
      if (!ans) return;
      const accSuffix = ans.account ? ` @${ans.account}` : "";
      const res = await runCmd(`bayar ${d.arah} ${d.nama} ${ans.value}${accSuffix}`);
      showToast(res.text || "Pembayaran dicatat.");
      await refreshDebtList();
    };
    const del = document.createElement("button");
    del.textContent = "Hapus";
    del.onclick = async () => {
      if (!window.confirm(`Hapus ${d.arah} "${d.nama}" (#${d.id})?`)) return;
      const res = await runCmd(`${d.arah} hapus ${d.id}`);
      showToast(res.text || "Dihapus.");
      await refreshDebtList();
    };
    actions.append(pay, del);

    item.append(head, info, actions);
    debtListEl.appendChild(item);
  }
}

document.getElementById("openDebt")!.onclick = async () => {
  showInfoPane(debtModal);
  debtMsgEl.hidden = true;
  await refreshDebtList();
};
document.getElementById("debtBack")!.onclick = () => showInfoPane(infoModal);
document.getElementById("debtResetForm")!.onclick = () => {
  debtNamaEl.value = "";
  debtJumlahEl.value = "";
  debtMsgEl.hidden = true;
};
document.getElementById("debtSave")!.onclick = async () => {
  const arah = debtArahEl.value === "piutang" ? "piutang" : "utang";
  const nama = debtNamaEl.value.trim();
  const jumlah = debtJumlahEl.value.trim();
  if (!nama || !jumlah) {
    debtMsgEl.hidden = false;
    debtMsgEl.textContent = "Nama dan nominal wajib diisi.";
    return;
  }
  const prep = arah === "utang" ? "ke" : "dari";
  const res = await runCmd(`${arah} ${jumlah} ${prep} ${nama}`);
  showToast(res.text || "Dicatat.");
  debtNamaEl.value = "";
  debtJumlahEl.value = "";
  debtMsgEl.hidden = true;
  await refreshDebtList();
};

// ---------- Cari / filter (UI) ----------
interface SearchRow extends Tx {}

async function refreshSearchOptions(): Promise<void> {
  const [a, c] = await Promise.all([call({ type: "listacc" }), call({ type: "listcat" })]);
  const accs = (Array.isArray(a.accounts) ? a.accounts : []) as AccRow[];
  const cats = (Array.isArray(c.categories) ? c.categories : []) as CatRow[];

  const prevAcc = searchAccEl.value;
  searchAccEl.replaceChildren();
  const noneA = document.createElement("option");
  noneA.value = "";
  noneA.textContent = "(semua akun)";
  searchAccEl.appendChild(noneA);
  for (const x of accs) {
    const o = document.createElement("option");
    o.value = String(x.id);
    o.textContent = x.nama;
    searchAccEl.appendChild(o);
  }
  if (prevAcc) searchAccEl.value = prevAcc;

  const prevCat = searchCatEl.value;
  searchCatEl.replaceChildren();
  const noneC = document.createElement("option");
  noneC.value = "";
  noneC.textContent = "(semua kategori)";
  searchCatEl.appendChild(noneC);
  for (const x of cats) {
    const o = document.createElement("option");
    o.value = x.nama;
    o.textContent = x.nama;
    searchCatEl.appendChild(o);
  }
  if (prevCat) searchCatEl.value = prevCat;
}

async function runSearch(): Promise<void> {
  const r = await call({
    type: "search",
    q: searchQEl.value.trim(),
    accountId: searchAccEl.value ? Number(searchAccEl.value) : undefined,
    kategori: searchCatEl.value || undefined,
    from: searchFromEl.value || undefined,
    to: searchToEl.value || undefined,
    minRaw: searchMinEl.value.trim() || undefined,
    maxRaw: searchMaxEl.value.trim() || undefined,
  });
  const rows = (Array.isArray(r.results) ? r.results : []) as SearchRow[];
  searchSummaryEl.hidden = false;
  searchSummaryEl.textContent = `${rows.length} transaksi ditemukan.`;
  searchListEl.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "info-note";
    empty.textContent = "Tidak ada hasil. Longgarkan filter.";
    searchListEl.appendChild(empty);
    return;
  }
  for (const t of rows) {
    const item = document.createElement("div");
    item.className = "cat-item";
    const head = document.createElement("div");
    head.className = "cat-head";
    const nm = document.createElement("span");
    nm.className = "cat-name";
    nm.textContent = `#${t.id} · ${t.kategori}`;
    const badge = document.createElement("span");
    badge.className = "cat-badge";
    badge.textContent = t.tipe;
    head.append(nm, badge);
    const info = document.createElement("div");
    info.className = "cat-kw";
    info.textContent =
      `${t.tanggal} · ${t.tipe === "masuk" ? "+" : "−"}${fmtRp(t.jumlah)}` +
      (t.akun ? ` · ${t.akun}` : "") +
      (t.catatan ? ` · ${t.catatan}` : "");
    const actions = document.createElement("div");
    actions.className = "cat-actions";
    const ed = document.createElement("button");
    ed.type = "button";
    ed.textContent = "Ubah";
    ed.onclick = () => {
      void openEditTxModal(t, null, () => void runSearch());
    };
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = t.transfer_id ? "Hapus (2 baris)" : "Hapus";
    del.onclick = async () => {
      if (!window.confirm(`Hapus transaksi #${t.id} (${t.kategori} ${fmtRp(t.jumlah)})?`)) return;
      const res = await call({ type: "delete", txId: t.id });
      const ids = Array.isArray(res.ids) ? (res.ids as number[]) : [t.id];
      removeTxRows(ids);
      showToast(
        Number(res.removed ?? 0) > 1
          ? "Transfer (2 baris) dihapus. Ketik undo untuk batalkan."
          : `Transaksi #${t.id} dihapus.`
      );
      void refresh();
      await runSearch();
    };
    actions.append(ed, del);
    item.append(head, info, actions);
    searchListEl.appendChild(item);
  }
}

document.getElementById("openSearch")!.onclick = async () => {
  showInfoPane(searchModal);
  searchSummaryEl.hidden = true;
  searchListEl.replaceChildren();
  await refreshSearchOptions();
};
document.getElementById("searchBack")!.onclick = () => showInfoPane(infoModal);
document.getElementById("searchResetForm")!.onclick = () => {
  searchQEl.value = "";
  searchAccEl.value = "";
  searchCatEl.value = "";
  searchFromEl.value = "";
  searchToEl.value = "";
  searchMinEl.value = "";
  searchMaxEl.value = "";
  searchSummaryEl.hidden = true;
  searchListEl.replaceChildren();
};
document.getElementById("searchRun")!.onclick = () => void runSearch();
document.getElementById("searchExportCsv")!.onclick = async () => {
  const r = await call({
    type: "exportcsv",
    q: searchQEl.value.trim(),
    accountId: searchAccEl.value ? Number(searchAccEl.value) : undefined,
    kategori: searchCatEl.value || undefined,
    from: searchFromEl.value || undefined,
    to: searchToEl.value || undefined,
    minRaw: searchMinEl.value.trim() || undefined,
    maxRaw: searchMaxEl.value.trim() || undefined,
  });
  if (!r.ok || !r.file) {
    showToast(String(r.error ?? "Tidak ada transaksi untuk diekspor."));
    return;
  }
  const f = r.file as { name: string; content: string };
  saveFile(f.name, f.content);
  showToast(`CSV ${Number(r.count ?? 0)} transaksi siap diunduh.`);
};

// ---------- Edit Transaksi Cepat (UI) ----------
const editTxModal = document.getElementById("editTxModal")!;
const editTxTitle = document.getElementById("editTxTitle")!;
const editTxJumlah = document.getElementById("editTxJumlah") as HTMLInputElement;
const editTxTanggal = document.getElementById("editTxTanggal") as HTMLInputElement;
const editTxExtra = document.getElementById("editTxExtra")!;
const editTxCat = document.getElementById("editTxCat") as HTMLSelectElement;
const editTxAcc = document.getElementById("editTxAcc") as HTMLSelectElement;
const editTxNote = document.getElementById("editTxNote") as HTMLInputElement;
const editTxMsg = document.getElementById("editTxMsg")!;
let editingTx: { tx: Tx; card: HTMLElement | null; onSaved?: () => void } | null = null;

async function openEditTxModal(
  tx: Tx,
  card: HTMLElement | null,
  onSaved?: () => void
): Promise<void> {
  editingTx = { tx, card, onSaved };
  editTxTitle.textContent = tx.transfer_id ? `Ubah transfer #${tx.id}` : `Ubah transaksi #${tx.id}`;
  editTxJumlah.value = String(tx.jumlah);
  editTxTanggal.value = tx.tanggal;
  editTxNote.value = tx.catatan ?? "";
  editTxMsg.hidden = true;
  editTxExtra.hidden = !!tx.transfer_id;

  if (!tx.transfer_id) {
    const [cRes, aRes] = await Promise.all([call({ type: "listcat" }), call({ type: "listacc" })]);
    const cats = (Array.isArray(cRes.categories) ? cRes.categories : []) as CatRow[];
    const accs = (Array.isArray(aRes.accounts) ? aRes.accounts : []) as AccRow[];

    editTxCat.replaceChildren();
    const catOpts = [...cats.map((c) => c.nama)];
    if (!catOpts.includes("Lainnya")) catOpts.push("Lainnya");
    if (tx.kategori && !catOpts.includes(tx.kategori)) catOpts.unshift(tx.kategori);
    for (const nm of catOpts) {
      const o = document.createElement("option");
      o.value = nm;
      o.textContent = nm;
      editTxCat.appendChild(o);
    }
    editTxCat.value = tx.kategori;

    editTxAcc.replaceChildren();
    for (const a of accs) {
      const o = document.createElement("option");
      o.value = a.nama;
      o.textContent = a.nama;
      editTxAcc.appendChild(o);
    }
    if (tx.akun) editTxAcc.value = tx.akun;
  }

  editTxModal.hidden = false;
  editTxJumlah.focus();
}

document.getElementById("editTxCancel")!.onclick = () => {
  editingTx = null;
  editTxModal.hidden = true;
};

document.getElementById("editTxSave")!.onclick = async () => {
  if (!editingTx) return;
  const { tx, card, onSaved } = editingTx;
  const jmlRaw = editTxJumlah.value.trim();
  const tglRaw = editTxTanggal.value.trim();
  if (!jmlRaw) {
    editTxMsg.hidden = false;
    editTxMsg.textContent = "Nominal wajib diisi.";
    return;
  }

  let updatedTx: Tx = { ...tx };
  let changed = false;

  if (jmlRaw !== String(tx.jumlah)) {
    const r = await runCmd(`ubah #${tx.id} jadi ${jmlRaw}`);
    if (!r.ok || !Array.isArray(r.txs) || !r.txs.length) {
      editTxMsg.hidden = false;
      editTxMsg.textContent = String(r.text || r.error || "Nominal tidak valid.");
      return;
    }
    updatedTx = r.txs[0];
    changed = true;
  }

  if (tglRaw && tglRaw !== tx.tanggal) {
    const r = await runCmd(`ubah #${tx.id} tanggal ${tglRaw}`);
    if (Array.isArray(r.txs) && r.txs.length) updatedTx = r.txs[0];
    changed = true;
  }

  if (!tx.transfer_id) {
    const newCat = editTxCat.value;
    if (newCat && newCat !== tx.kategori) {
      const r = await runCmd(`ubah #${tx.id} kategori ${newCat}`);
      if (Array.isArray(r.txs) && r.txs.length) updatedTx = r.txs[0];
      changed = true;
    }
    const newAcc = editTxAcc.value;
    if (newAcc && newAcc !== (tx.akun ?? "")) {
      const r = await runCmd(`ubah #${tx.id} akun ${newAcc}`);
      if (Array.isArray(r.txs) && r.txs.length) updatedTx = r.txs[0];
      changed = true;
    }
    const newNote = editTxNote.value.trim();
    if (newNote && newNote !== (tx.catatan ?? "")) {
      const r = await runCmd(`ubah #${tx.id} catatan ${newNote}`);
      if (Array.isArray(r.txs) && r.txs.length) updatedTx = r.txs[0];
      changed = true;
    }
  }

  if (changed) {
    Object.assign(tx, updatedTx);
    const sign = tx.tipe === "masuk" ? "+" : "-";
    const full = sign + (tx.rupiah ?? fmtRp(tx.jumlah));
    const targets = card
      ? [card]
      : Array.from(chat.querySelectorAll<HTMLElement>(`.tx[data-tx-id="${tx.id}"]`));
    for (const el of targets) {
      const catEl = el.querySelector(".tx-cat");
      const amtEl = el.querySelector<HTMLElement>(".tx-amt");
      const metaEl = el.querySelector(".tx-meta");
      const iconEl = el.querySelector(".tx-icon");
      if (catEl) catEl.textContent = tx.kategori;
      if (amtEl) {
        amtEl.textContent = full;
        amtEl.dataset.full = full;
      }
      if (metaEl) metaEl.textContent = (tx.akun ? `${tx.akun} · ` : "") + `#${tx.id}`;
      if (iconEl) iconEl.innerHTML = catIconSvg(tx.kategori, tx.ikon ?? undefined);
    }
    showToast(`Transaksi #${tx.id} diperbarui.`);
    onSaved?.();
  }

  editingTx = null;
  editTxModal.hidden = true;
};

// ---------- Deteksi langganan (UI) ----------
interface SubRow {
  catatan: string;
  jumlah: number;
  kategori: string;
  count: number;
  hari: number;
  lastDate: string;
}

async function refreshSubsList(): Promise<void> {
  const r = await call({ type: "subscriptions" });
  const rows = (Array.isArray(r.subs) ? r.subs : []) as SubRow[];
  subsListEl.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "info-note";
    empty.textContent =
      "Belum ada pola langganan. Butuh ≥2 transaksi nominal sama yang berulang tiap bulan.";
    subsListEl.appendChild(empty);
    return;
  }
  for (const s of rows) {
    const item = document.createElement("div");
    item.className = "cat-item";
    const head = document.createElement("div");
    head.className = "cat-head";
    const nm = document.createElement("span");
    nm.className = "cat-name";
    nm.textContent = s.catatan;
    const badge = document.createElement("span");
    badge.className = "cat-badge";
    badge.textContent = `${s.count}×`;
    head.append(nm, badge);
    const info = document.createElement("div");
    info.className = "cat-kw";
    info.textContent =
      `${fmtRp(s.jumlah)} / bulan · tiap tgl ${s.hari} · ${s.kategori} · terakhir ${s.lastDate}`;
    const actions = document.createElement("div");
    actions.className = "cat-actions";
    const mk = document.createElement("button");
    mk.textContent = "Jadikan berulang";
    mk.onclick = async () => {
      const res = await runCmd(`berulang ${s.catatan} ${s.jumlah} tiap ${s.hari}`);
      showToast(res.text || "Dijadikan berulang.");
      await refreshSubsList();
    };
    actions.append(mk);
    item.append(head, info, actions);
    subsListEl.appendChild(item);
  }
}

document.getElementById("openSubs")!.onclick = async () => {
  showInfoPane(subsModal);
  await refreshSubsList();
};
document.getElementById("subsBack")!.onclick = () => showInfoPane(infoModal);

// ---------- Target / sinking fund (UI) ----------
interface GoalRow {
  id: number;
  nama: string;
  target: number;
  terkumpul: number;
  tenggat: string | null;
}

async function refreshGoalList(): Promise<void> {
  const r = await call({ type: "listgoals" });
  const rows = (Array.isArray(r.goals) ? r.goals : []) as GoalRow[];
  goalListEl.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "info-note";
    empty.textContent = "Belum ada target. Isi form di bawah (mis. Liburan 5jt).";
    goalListEl.appendChild(empty);
    return;
  }
  for (const g of rows) {
    const item = document.createElement("div");
    item.className = "cat-item";
    const head = document.createElement("div");
    head.className = "cat-head";
    const nm = document.createElement("span");
    nm.className = "cat-name";
    nm.textContent = g.nama;
    const badge = document.createElement("span");
    badge.className = "cat-badge";
    const pct = g.target > 0 ? Math.min(100, Math.floor((g.terkumpul / g.target) * 100)) : 0;
    badge.textContent = `${pct}%`;
    head.append(nm, badge);
    const sisa = Math.max(0, g.target - g.terkumpul);
    const info = document.createElement("div");
    info.className = "cat-kw";
    let line = `${fmtRp(g.terkumpul)} / ${fmtRp(g.target)} · sisa ${fmtRp(sisa)}`;
    if (g.tenggat) {
      const months = Math.ceil((new Date(g.tenggat).getTime() - Date.now()) / (30 * 86_400_000));
      line += ` · tempo ${g.tenggat}`;
      if (months > 0 && sisa > 0) line += ` · saran ${fmtRp(Math.ceil(sisa / months))}/bln`;
    }
    info.textContent = line;
    const bar = document.createElement("div");
    bar.className = "bar" + (g.terkumpul >= g.target ? " done" : "");
    const fill = document.createElement("span");
    fill.style.width = Math.min(100, Math.max(0, pct)) + "%";
    bar.appendChild(fill);
    const actions = document.createElement("div");
    actions.className = "cat-actions";
    const isi = document.createElement("button");
    isi.textContent = "Isi";
    isi.onclick = async () => {
      const sisaGoal = Math.max(0, g.target - g.terkumpul);
      const ans = await askModalPrompt({
        title: `Isi target: ${g.nama}`,
        hint: `Terkumpul ${fmtRp(g.terkumpul)} / ${fmtRp(g.target)} (sisa ${fmtRp(sisaGoal)})`,
        label: "Nominal tabungan (mis. 500rb)",
        placeholder: "500rb",
        inputMode: "decimal",
        syncAccountLabel: "Sekalian potong saldo akun",
        validate: (v) => (!v.value ? "Nominal wajib diisi." : null),
      });
      if (!ans) return;
      const accSuffix = ans.account ? ` @${ans.account}` : "";
      const res = await runCmd(`target isi ${g.nama} ${ans.value}${accSuffix}`);
      showToast(res.text || "Tersimpan.");
      await refreshGoalList();
    };
    const del = document.createElement("button");
    del.textContent = "Hapus";
    del.onclick = async () => {
      if (!window.confirm(`Hapus target "${g.nama}"?`)) return;
      const res = await runCmd(`target hapus ${g.nama}`);
      showToast(res.text || "Dihapus.");
      await refreshGoalList();
    };
    actions.append(isi, del);
    item.append(head, info, bar, actions);
    goalListEl.appendChild(item);
  }
}

document.getElementById("openGoal")!.onclick = async () => {
  showInfoPane(goalModal);
  goalMsgEl.hidden = true;
  await refreshGoalList();
};
document.getElementById("goalBack")!.onclick = () => showInfoPane(infoModal);
document.getElementById("goalResetForm")!.onclick = () => {
  goalNamaEl.value = "";
  goalTargetEl.value = "";
  goalTempoEl.value = "";
  goalMsgEl.hidden = true;
};
document.getElementById("goalSave")!.onclick = async () => {
  const nama = goalNamaEl.value.trim();
  const target = goalTargetEl.value.trim();
  if (!nama || !target) {
    goalMsgEl.hidden = false;
    goalMsgEl.textContent = "Nama dan target wajib diisi.";
    return;
  }
  const tempo = goalTempoEl.value;
  const res = await runCmd(`target ${nama} ${target}${tempo ? ` tempo ${tempo}` : ""}`);
  showToast(res.text || "Target dibuat.");
  goalNamaEl.value = "";
  goalTargetEl.value = "";
  goalTempoEl.value = "";
  goalMsgEl.hidden = true;
  await refreshGoalList();
};

document.getElementById("updateReload")!.onclick = async () => {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.waiting) {
      // Aktifkan SW baru, lalu reload saat controllerchange.
      swReloading = true;
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
      window.setTimeout(() => window.location.reload(), 2500);
      return;
    }
  } catch {
    // fallback reload biasa
  }
  window.location.reload();
};

document.getElementById("checkUpdate")!.onclick = () => void forceUpdate();

pickDirBtn.onclick = async () => {
  if (!supportsFolderBackup()) {
    showToast("Browser ini tak mendukung auto-backup folder. Pakai Backup JSON di Info → Backup & penyimpanan.");
    return;
  }
  if (folder && folderNeedsPermission) {
    const ok = await folderPermission(folder, true);
    if (!ok) {
      folderNeedsPermission = true;
      renderInfo();
      showToast("Izin folder ditolak. Ulangi, atau Matikan auto-backup untuk memilih folder lain.");
      return;
    }
    folderNeedsPermission = false;
    backupPermWarned = false;
    await autoBackup(true);
    renderInfo();
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
    showToast("Izin folder ditolak. Coba lagi lewat ℹ → Backup & penyimpanan.");
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


