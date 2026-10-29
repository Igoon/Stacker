// main.ts — UI chat di main thread. Semua logika + DB berjalan di worker.
import "./style.css";
import type { Tx } from "./db";

interface Reply {
  id: number;
  ok: boolean;
  text?: string;
  txs?: Tx[];
  file?: { name: string; content: string };
  pre?: boolean;
  error?: string;
}

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

if ("serviceWorker" in navigator) {
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
      setSub(`v${m.version}`);
      void refresh().then((s) => {
        // Chat ephemeral: jangan render riwayat, cukup hint sekali di awal.
        const n = Number(s.txCount ?? 0);
        if (n > 0) {
          addBubble(
            `${n} transaksi tersimpan di perangkat ini.\n` +
              "Ketik `riwayat` untuk melihat, `help` untuk daftar perintah.",
            "bot"
          );
        }
      });
    } else if (m.type === "error") {
      setSub("gagal inisialisasi DB");
      addBubble("Gagal buka database: " + (m.message ?? "tidak diketahui"), "bot");
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

function addBubble(text: string, side: "me" | "bot", txs?: Tx[], file?: { name: string; content: string }) {
  const row = document.createElement("div");
  row.className = "row " + side;
  const b = document.createElement("div");
  b.className = "bubble";
  b.textContent = text;
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
    const isJson = /\.json$/i.test(file.name);
    const body = isJson ? file.content : "\ufeff" + file.content;
    const url = URL.createObjectURL(
      new Blob([body], { type: isJson ? "application/json" : "text/csv" })
    );
    const a = document.createElement("a");
    a.className = "dl";
    a.href = url;
    a.download = file.name;
    a.textContent = "⬇ " + file.name;
    b.appendChild(document.createElement("br"));
    b.appendChild(a);
  }
  row.appendChild(b);
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

async function refresh(): Promise<Record<string, unknown>> {
  const r = await call({ type: "state" });
  saldoEl.textContent = "Saldo: " + r.saldoRupiah;
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
    addBubble(r.text ?? "", "bot", r.txs, r.file);
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
  const url = URL.createObjectURL(new Blob([r.json as string], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `stacker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

document.getElementById("import")!.onclick = () => {
  document.getElementById("importFile")!.click();
};

document.getElementById("importFile")!.addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const text = await file.text();
  const r = await call({ type: "import", json: text });
  addBubble(r.ok ? "Backup dimuat." : "Gagal impor: " + (r.error ?? "format salah"), "bot");
  void refresh();
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

addBubble(
  "Halo! Catat transaksi tinggal ketik.\nContoh: `makan siang 50rb` / `gaji 5jt`\nKetik `help` buat perintah.",
  "bot"
);
void refresh();
