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
      void refresh();
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
      await call({ type: "delete", txId: tx.id });
      d.remove();
      void refresh();
    };
    d.appendChild(document.createElement("br"));
    d.appendChild(btn);
    b.appendChild(d);
  }
  if (file) {
    const url = URL.createObjectURL(new Blob(["\ufeff" + file.content], { type: "text/csv" }));
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

async function refresh(): Promise<void> {
  const r = await call({ type: "state" });
  saldoEl.textContent = "Saldo: " + r.saldoRupiah;
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
  a.download = `duit-backup-${new Date().toISOString().slice(0, 10)}.json`;
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

addBubble(
  "Halo! Catat transaksi tinggal ketik.\nContoh: `makan siang 50rb` / `gaji 5jt`\nKetik `help` buat perintah.",
  "bot"
);
void refresh();
